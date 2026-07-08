import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { sendCopiesLinkEmail, sendCopiesLinkSms } from "@/lib/notify";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const link = `${appBaseUrl()}/copies/${intake.token}`;
  const results: string[] = [];
  if (intake.client.email) {
    await sendCopiesLinkEmail(intake.client.email, intake.client.fullName, link);
    results.push(`email to ${intake.client.email}`);
  }
  if (intake.client.phone) {
    await sendCopiesLinkSms(intake.client.phone, link);
    results.push(`sms to ${intake.client.phone}`);
  }
  await audit("copies_link_sent", {
    intakeId: intake.id,
    userId: user!.id,
    detail: results.join(", ") || "no contact info",
  });
  return NextResponse.json({ ok: true, link, sent: results, demo: !process.env.TWILIO_ACCOUNT_SID });
}

