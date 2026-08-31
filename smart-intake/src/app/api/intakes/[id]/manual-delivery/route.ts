import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit, type AuditEvent } from "@/lib/auditLog";
import { loadAnswers } from "@/lib/intakeData";
import { FILL_INSURANCE_NEXT_STEP, insuranceSmsBlockReason } from "@/lib/insurancePlans";
import { formatUsPhoneDisplay } from "@/lib/intakeContacts";
import {
  clientDeliveryContacts,
  clientFollowUpDeliveryContacts,
} from "@/lib/clientDeliveryContacts";

const requestSchema = z.object({
  purpose: z.enum(["intake", "signature", "copies", "follow-up"]),
  channel: z.enum(["sms"]).default("sms"),
});

const PURPOSE_EVENT: Record<z.infer<typeof requestSchema>["purpose"], AuditEvent> = {
  intake: "link_reminder_sent",
  signature: "signature_reminder_sent",
  copies: "copies_link_sent",
  "follow-up": "follow_up_sent",
};

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a delivery method to record." }, { status: 400 });
  }

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      client: true,
      signatures: { select: { role: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const answers = await loadAnswers(intake.id);
  if (parsed.data.purpose === "intake" || parsed.data.purpose === "signature") {
    const insuranceBlock = insuranceSmsBlockReason(answers);
    if (insuranceBlock) {
      return NextResponse.json({
        error: insuranceBlock,
        nextStep: FILL_INSURANCE_NEXT_STEP,
      }, { status: 409 });
    }
  }
  const contacts = parsed.data.purpose === "follow-up" || parsed.data.purpose === "copies"
    ? clientFollowUpDeliveryContacts(intake.client, answers, intake.signatures)
    : clientDeliveryContacts(intake.client, answers);
  if (!contacts.phone) {
    return NextResponse.json({
      error: "No phone number is saved for this recipient. Add a cell number before recording an SMS.",
    }, { status: 422 });
  }

  const displayPhone = formatUsPhoneDisplay(contacts.phone.value);
  const detail = `sent SMS from this computer to ${contacts.phone.role} at ${displayPhone}`;
  await audit(PURPOSE_EVENT[parsed.data.purpose], {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail,
  });

  return NextResponse.json({
    ok: true,
    message: `Recorded SMS from this computer to ${contacts.phone.role} at ${displayPhone}.`,
  });
}
