import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appBaseUrl } from "@/lib/baseUrl";
import { audit } from "@/lib/auditLog";
import { clientFollowUpQuestions } from "@/lib/clientFollowUp";
import { clientFollowUpDeliveryContacts } from "@/lib/clientDeliveryContacts";
import {
  clientSubmissionFinished,
  hasClientOrGuardianSignature,
} from "@/lib/clientSubmissionState";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import {
  captureNotifyResult,
  sendFollowUpEmail,
  sendFollowUpSms,
  type NotifyResult,
} from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { requireWritableStaff } from "@/lib/staffGuard";
import { newIntakeToken, tokenExpiry } from "@/lib/tokens";

const requestSchema = z.object({
  fieldKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(25),
});

class FollowUpCreateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function answersFromRows(rows: Array<{ key: string; value: string }>): Record<string, unknown> {
  return Object.fromEntries(rows.map((row) => {
    try {
      return [row.key, JSON.parse(row.value)];
    } catch {
      return [row.key, row.value];
    }
  }));
}

function sentLabel(result: NotifyResult): string {
  return `${result.channel.toUpperCase()} to ${result.to}: ${result.detail}`;
}

function failedLabel(result: NotifyResult): string {
  return `${result.channel} to ${result.to}: ${result.detail}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireWritableStaff();
  if (deny) return deny;
  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose at least one missing client question." }, { status: 400 });
  }

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      client: true,
      signatures: { select: { role: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (intake.archived || intake.status === "COMPLETED") {
    return NextResponse.json({
      error: "This intake is archived or completed. Reopen the staff workflow before requesting more client answers.",
    }, { status: 409 });
  }
  if (!clientSubmissionFinished(intake) || !hasClientOrGuardianSignature(intake.signatures)) {
    return NextResponse.json({
      error: "Finish and sign the original client intake before sending follow-up questions.",
    }, { status: 409 });
  }
  if (intake.docusignEnvelopeId) {
    return NextResponse.json({
      error: "This packet was already sent to DocuSign. Complete corrections in staff review, then create a new envelope.",
    }, { status: 409 });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const locked = await tx.intake.updateMany({
        where: {
          id: intake.id,
          providerId: provider!.id,
          archived: false,
          status: { not: "COMPLETED" },
          docusignEnvelopeId: null,
        },
        data: { lastActivityAt: new Date() },
      });
      if (locked.count !== 1) {
        throw new FollowUpCreateError(
          "This chart is closed, archived, or already in DocuSign.",
          409,
        );
      }
      const currentIntake = await tx.intake.findUnique({
        where: { id: intake.id },
        include: {
          client: true,
          signatures: { select: { role: true } },
        },
      });
      if (
        !currentIntake
        || !clientSubmissionFinished(currentIntake)
        || !hasClientOrGuardianSignature(currentIntake.signatures)
      ) {
        throw new FollowUpCreateError(
          "Finish and sign the original client intake before sending follow-up questions.",
          409,
        );
      }
      const processing = await tx.intakeFollowUp.findFirst({
        where: { intakeId: intake.id, status: "PROCESSING" },
        select: { id: true },
      });
      if (processing) {
        throw new FollowUpCreateError(
          "The client is submitting a follow-up right now. Refresh the intake in a moment.",
          409,
        );
      }
      const recent = await tx.intakeFollowUp.findFirst({
        where: { intakeId: intake.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
        select: { id: true },
      });
      if (recent) {
        throw new FollowUpCreateError(
          "A follow-up link was just created. Wait one minute before sending another.",
          429,
          60,
        );
      }
      const answerRows = await tx.intakeAnswer.findMany({
        where: { intakeId: intake.id },
        select: { key: true, value: true },
      });
      const answers = applyOperationalDefaults(answersFromRows(answerRows));
      const questions = clientFollowUpQuestions(parsed.data.fieldKeys, answers);
      if (!questions.length) {
        throw new FollowUpCreateError(
          "Those items are already answered or must be completed by staff. Refresh and run preflight again.",
          409,
        );
      }
      const contacts = clientFollowUpDeliveryContacts(
        currentIntake.client,
        answers,
        currentIntake.signatures,
      );
      await tx.intakeFollowUp.updateMany({
        where: { intakeId: intake.id, status: "OPEN" },
        data: { status: "SUPERSEDED" },
      });
      const followUp = await tx.intakeFollowUp.create({
        data: {
          intakeId: intake.id,
          token: newIntakeToken(),
          fieldKeys: JSON.stringify(questions.map((question) => question.key)),
          tokenExpiresAt: tokenExpiry(),
          recipientRole: contacts.role,
        },
      });
      return {
        followUp,
        questions,
        contacts,
        client: currentIntake.client,
      };
    });
  } catch (error) {
    if (error instanceof FollowUpCreateError) {
      return NextResponse.json({
        error: error.message,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      }, {
        status: error.status,
        ...(error.retryAfterSeconds
          ? { headers: { "Retry-After": String(error.retryAfterSeconds) } }
          : {}),
      });
    }
    throw error;
  }
  const { followUp, questions, contacts, client } = created;
  const link = `${appBaseUrl(req)}/follow-up/${followUp.token}`;
  await audit("follow_up_created", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `${questions.length} client-answerable field${questions.length === 1 ? "" : "s"} requested`,
  });

  const attempts: NotifyResult[] = [];
  if (contacts.email) {
    const recipientName = contacts.email.role === "guardian"
      ? client.guardianName || "Parent or guardian"
      : client.fullName;
    attempts.push(await captureNotifyResult("email", contacts.email.value, () => (
      sendFollowUpEmail(
        contacts.email!.value,
        recipientName,
        link,
        questions.length,
        provider!.name,
        provider!.phone,
      )
    )));
  }
  if (contacts.phone) {
    attempts.push(await captureNotifyResult("sms", contacts.phone.value, () => (
      sendFollowUpSms(contacts.phone!.value, link, provider!.name, provider!.phone)
    )));
  }

  const sent = attempts.filter((result) => result.ok).map(sentLabel);
  const failed = attempts.filter((result) => !result.ok).map(failedLabel);
  if (!contacts.phone && !contacts.email) {
    failed.push("No client or guardian phone or email is saved.");
  }
  if (sent.length) {
    await prisma.intakeFollowUp.update({
      where: { id: followUp.id },
      data: { sentAt: new Date() },
    });
  }
  await audit(sent.length ? "follow_up_sent" : "follow_up_delivery_failed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: sent.length
      ? `${questions.length} questions; ${contacts.role} recipient; accepted channels: ${attempts.filter((result) => result.ok).map((result) => result.channel).join(", ")}`
      : `${questions.length} questions; ${contacts.role} recipient; no delivery channel accepted`,
  });

  const deliveryState = sent.length && failed.length
    ? "partial"
    : sent.length
      ? "sent"
      : "failed";
  return NextResponse.json({
    ok: true,
    deliveryOk: sent.length > 0,
    deliveryState,
    recipientRole: contacts.role,
    sent,
    failed,
    demo: attempts.some((result) => result.demo),
    link,
    expiresAt: followUp.tokenExpiresAt,
    fields: questions.map((question) => ({ key: question.key, label: question.label })),
  });
}
