import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { sendClientLinkEmail, sendClientLinkSms } from "@/lib/notify";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const base = appBaseUrl();
  const link = `${base}/intake/${intake.token}`;
  const results: string[] = [];
  if (intake.client.email) {
    await sendClientLinkEmail(intake.client.email, intake.client.fullName, link);
    results.push(`email to ${intake.client.email}`);
  }
  if (intake.client.phone) {
    await sendClientLinkSms(intake.client.phone, link);
    results.push(`sms to ${intake.client.phone}`);
  }
  await prisma.intake.update({ where: { id: intake.id }, data: { linkSentAt: new Date() } });
  await audit("link_reminder_sent", { intakeId: intake.id, userId: user!.id, detail: results.join(", ") || "no contact info" });
  return NextResponse.json({ ok: true, sent: results, demo: !process.env.SENDGRID_API_KEY });
}
