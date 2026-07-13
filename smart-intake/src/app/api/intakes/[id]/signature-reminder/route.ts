import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { sendClientLinkEmail, sendClientLinkSms, type NotifyResult } from "@/lib/notify";
import { tokenExpiry } from "@/lib/tokens";
import { buildSignatureStatuses } from "@/lib/signatureStatus";

function sentLabel(result: NotifyResult): string {
  return `${result.channel} to ${result.to}`;
}

function failedLabel(result: NotifyResult): string {
  return `${result.channel} to ${result.to}: ${result.detail}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;

  let intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      client: true,
      signatures: { select: { role: true, printedName: true, signedDate: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const statuses = buildSignatureStatuses(intake.signatures);
  const clientStatus = statuses.find((status) => status.key === "client_guardian");
  if (clientStatus?.state === "captured") {
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      missing: [],
      message: "The client or guardian signature is already saved. No reminder was sent.",
    });
  }

  // Renew the same secure link before sending so a client never receives an expired reminder.
  if (intake.tokenExpiresAt < new Date()) {
    intake = await prisma.intake.update({
      where: { id: intake.id },
      data: { tokenExpiresAt: tokenExpiry() },
      include: {
        client: true,
        signatures: { select: { role: true, printedName: true, signedDate: true } },
      },
    });
  }

  const link = `${appBaseUrl(req)}/intake/${intake.token}`;
  const attempts: NotifyResult[] = [];
  if (intake.client.email) {
    attempts.push(await sendClientLinkEmail(
      intake.client.email,
      intake.client.fullName,
      link,
      provider!.name,
      provider!.phone,
      "signature",
    ));
  }
  if (intake.client.phone) {
    attempts.push(await sendClientLinkSms(
      intake.client.phone,
      link,
      provider!.name,
      provider!.phone,
      "signature",
    ));
  }

  const sent = attempts.filter((result) => result.ok).map(sentLabel);
  const failed = attempts.filter((result) => !result.ok).map(failedLabel);
  if (sent.length) {
    await prisma.intake.update({ where: { id: intake.id }, data: { linkSentAt: new Date() } });
  }
  await audit("signature_reminder_sent", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: [
      "client/guardian signature missing",
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no contact info",
  });

  return NextResponse.json(
    {
      ok: sent.length > 0,
      alreadySigned: false,
      missing: [clientStatus?.label || "Client / guardian"],
      sent,
      failed,
      demo: attempts.some((result) => result.demo),
    },
    { status: sent.length || !attempts.length ? 200 : 502 },
  );
}
