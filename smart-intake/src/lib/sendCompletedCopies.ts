import { prisma } from "./prisma";
import { appBaseUrl } from "./baseUrl";
import { audit } from "./auditLog";
import { loadAnswers } from "./intakeData";
import {
  AUTO_SEND_COMPLETED_COPIES_KEY,
  COPY_RECEIPT_ANSWER_DEFAULTS,
  COPY_ALLOWED_STATUSES,
  autoSendCompletedCopiesEnabled,
} from "./completedCopies";
import { sendCopiesLinkEmail, sendCopiesLinkSms, type NotifyResult } from "./notify";
import { answeredClientFields } from "./clientAnswerSync";

function sentLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}`;
}

function failedLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
}

async function markCopiesDelivered(intakeId: string): Promise<void> {
  await prisma.$transaction(
    Object.entries(COPY_RECEIPT_ANSWER_DEFAULTS).map(([key, value]) =>
      prisma.intakeAnswer.upsert({
        where: { intakeId_key: { intakeId, key } },
        create: { intakeId, key, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      })),
  );
}

export interface SendCompletedCopiesOptions {
  intakeId: string;
  providerId: string;
  userId?: string;
  req?: Request;
}

export async function sendCompletedCopiesLink(opts: SendCompletedCopiesOptions) {
  const intake = await prisma.intake.findFirst({
    where: { id: opts.intakeId, providerId: opts.providerId },
    include: { client: true },
  });
  if (!intake) {
    return { status: 404, body: { ok: false, error: "Not found", sent: [], failed: [] } };
  }
  if (!COPY_ALLOWED_STATUSES.includes(intake.status)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "The intake must be submitted, signed, or completed before sending completed copies.",
        sent: [],
        failed: [],
      },
    };
  }

  const link = `${appBaseUrl(opts.req)}/copies/${intake.token}`;
  const attempts: NotifyResult[] = [];
  const answers = await loadAnswers(intake.id);
  const answeredClient = answeredClientFields(answers);
  const clientName = intake.client.fullName || answeredClient.fullName;
  const email = intake.client.email || answeredClient.email;
  const phone = intake.client.phone || answeredClient.phone;
  const provider = await prisma.provider.findUnique({
    where: { id: opts.providerId },
    select: { name: true, phone: true },
  });
  if (email) {
    attempts.push(await sendCopiesLinkEmail(email, clientName, link, provider?.name, provider?.phone));
  }
  if (phone) {
    attempts.push(await sendCopiesLinkSms(phone, link, provider?.name, provider?.phone));
  }

  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  if (sent.length) {
    await markCopiesDelivered(intake.id);
  }
  await audit("copies_link_sent", {
    providerId: opts.providerId,
    intakeId: intake.id,
    userId: opts.userId,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no client email or phone on file",
  });

  return {
    status: sent.length || !attempts.length ? 200 : 502,
    body: { ok: sent.length > 0, link, sent, failed, demo: attempts.some((r) => r.demo) },
  };
}

export async function autoSendCompletedCopiesIfEnabled(opts: SendCompletedCopiesOptions) {
  const answers = await loadAnswers(opts.intakeId);
  if (!autoSendCompletedCopiesEnabled(answers)) {
    return { skipped: true, reason: "Auto-send is off" };
  }

  const alreadySent = await prisma.auditLog.findFirst({
    where: { providerId: opts.providerId, intakeId: opts.intakeId, event: "copies_link_sent" },
  });
  if (alreadySent) {
    return { skipped: true, reason: "Completed copies were already sent" };
  }

  return sendCompletedCopiesLink(opts);
}

export async function setAutoSendCompletedCopies(intakeId: string, enabled: boolean): Promise<void> {
  await prisma.intakeAnswer.upsert({
    where: { intakeId_key: { intakeId, key: AUTO_SEND_COMPLETED_COPIES_KEY } },
    create: { intakeId, key: AUTO_SEND_COMPLETED_COPIES_KEY, value: JSON.stringify(enabled) },
    update: { value: JSON.stringify(enabled) },
  });
  await prisma.intake.update({ where: { id: intakeId }, data: { lastActivityAt: new Date() } });
}
