import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { sendCopiesLinkEmail, sendCopiesLinkSms, type NotifyResult } from "@/lib/notify";

function sentLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}`;
}

function failedLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const link = `${appBaseUrl(req)}/copies/${intake.token}`;
  const attempts: NotifyResult[] = [];
  if (intake.client.email) {
    attempts.push(await sendCopiesLinkEmail(intake.client.email, intake.client.fullName, link));
  }
  if (intake.client.phone) {
    attempts.push(await sendCopiesLinkSms(intake.client.phone, link));
  }
  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  await audit("copies_link_sent", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no contact info",
  });
  return NextResponse.json(
    { ok: sent.length > 0, link, sent, failed, demo: attempts.some((r) => r.demo) },
    { status: sent.length || !attempts.length ? 200 : 502 },
  );
}
