import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { sendClientLinkEmail, sendClientLinkSms, type NotifyResult } from "@/lib/notify";
import { tokenExpiry } from "@/lib/tokens";

function sentLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}`;
}

function failedLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  let intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // never remind with a dead link - renew the expiry first if needed
  if (intake.tokenExpiresAt < new Date()) {
    intake = await prisma.intake.update({
      where: { id: intake.id }, data: { tokenExpiresAt: tokenExpiry() }, include: { client: true },
    });
  }
  const base = appBaseUrl(req);
  const link = `${base}/intake/${intake.token}`;
  const attempts: NotifyResult[] = [];
  if (intake.client.email) {
    attempts.push(await sendClientLinkEmail(intake.client.email, intake.client.fullName, link, provider!.name));
  }
  if (intake.client.phone) {
    attempts.push(await sendClientLinkSms(intake.client.phone, link, provider!.name));
  }
  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  if (sent.length) await prisma.intake.update({ where: { id: intake.id }, data: { linkSentAt: new Date() } });
  await audit("link_reminder_sent", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no contact info",
  });
  return NextResponse.json(
    { ok: sent.length > 0, sent, failed, demo: attempts.some((r) => r.demo) },
    { status: sent.length || !attempts.length ? 200 : 502 },
  );
}
