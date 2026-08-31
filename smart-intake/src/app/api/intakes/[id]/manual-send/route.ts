import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { clientDeliveryContacts } from "@/lib/clientDeliveryContacts";
import { loadAnswers } from "@/lib/intakeData";
import { FILL_INSURANCE_NEXT_STEP, insuranceSmsBlockReason } from "@/lib/insurancePlans";

type ManualSendMethod = "sms" | "in_person" | "email";

function parseMethod(value: unknown): ManualSendMethod {
  return value === "in_person" || value === "email" ? value : "sms";
}

function maskedPhone(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 4 ? ` ending ${digits.slice(-4)}` : "";
}

/**
 * Staff sent the secure link outside the app (own phone, QR code on screen,
 * email). Record it so the dashboard stops showing "Not sent yet" and the
 * audit log shows who delivered the link and how. Nothing is sent from here.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { method?: unknown };
  const method = parseMethod(body?.method);
  const answers = await loadAnswers(intake.id);
  const insuranceBlock = insuranceSmsBlockReason(answers);
  if (insuranceBlock) {
    return NextResponse.json({
      error: insuranceBlock,
      nextStep: FILL_INSURANCE_NEXT_STEP,
    }, { status: 409 });
  }
  const contacts = clientDeliveryContacts(intake.client, answers);
  const detail = method === "in_person"
    ? "client opened the secure link in person (QR code on the staff screen)"
    : method === "email"
      ? `staff emailed the secure link by hand${contacts.email ? ` to ${contacts.email.role}` : ""}`
      : `staff texted the secure link by hand from a personal phone${contacts.phone ? ` to ${contacts.phone.role}${maskedPhone(contacts.phone.value)}` : ""}`;

  const linkSentAt = new Date();
  await prisma.intake.update({ where: { id: intake.id }, data: { linkSentAt } });
  await audit("link_sent_manually", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail,
  });
  return NextResponse.json({ ok: true, method, linkSentAt: linkSentAt.toISOString() });
}
