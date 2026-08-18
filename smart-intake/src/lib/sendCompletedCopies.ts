import { prisma } from "./prisma";
import { appBaseUrl } from "./baseUrl";
import { audit } from "./auditLog";
import { loadAnswers } from "./intakeData";
import {
  AUTO_SEND_COMPLETED_COPIES_KEY,
  AUTO_EMAIL_PROVIDER_PACKET_KEY,
  COPY_RECEIPT_ANSWER_DEFAULTS,
  COPY_ALLOWED_STATUSES,
  autoEmailProviderPacketEnabled,
  autoSendCompletedCopiesEnabled,
} from "./completedCopies";
import { sendCompletedPacketEmail, sendCopiesLinkEmail, sendCopiesLinkSms, type NotifyResult } from "./notify";
import { answeredClientFields } from "./clientAnswerSync";
import { fileExists, readFile } from "./storage";
import { packetFreshnessForIntake } from "./packetFreshness";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "./providerPacketTemplates";

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
  allowResend?: boolean;
}

export async function sendCompletedCopiesLink(opts: SendCompletedCopiesOptions) {
  const intake = await prisma.intake.findFirst({
    where: { id: opts.intakeId, providerId: opts.providerId },
    include: {
      client: true,
      provider: { select: { name: true, phone: true, status: true } },
    },
  });
  if (!intake) {
    return { status: 404, body: { ok: false, error: "Not found", sent: [], failed: [] } };
  }
  if (intake.tokenExpiresAt < new Date()) {
    return {
      status: 410,
      body: {
        ok: false,
        error: "The secure link expired. Extend it before sending client copies.",
        sent: [],
        failed: [],
      },
    };
  }
  if (
    intake.archived
    || !intake.submittedAt
    || intake.provider?.status !== "ACTIVE"
    || !COPY_ALLOWED_STATUSES.includes(intake.status)
  ) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "The intake must be active, submitted, and signed before sending client copies.",
        sent: [],
        failed: [],
      },
    };
  }

  try {
    await requireProviderPacketForCompletion(opts.providerId);
  } catch (error) {
    if (error instanceof ProviderPacketNotReadyError) {
      return {
        status: 409,
        body: {
          ok: false,
          code: error.code,
          error: error.message,
          sent: [],
          failed: [],
        },
      };
    }
    throw error;
  }

  const link = `${appBaseUrl(opts.req)}/copies/${intake.token}`;
  const attempts: NotifyResult[] = [];
  const answers = await loadAnswers(intake.id);
  const answeredClient = answeredClientFields(answers);
  const clientName = intake.client.fullName || answeredClient.fullName;
  const email = intake.client.email || answeredClient.email;
  const phone = intake.client.phone || answeredClient.phone;
  if (email) {
    attempts.push(await sendCopiesLinkEmail(email, clientName, link, intake.provider?.name, intake.provider?.phone));
  }
  if (phone) {
    attempts.push(await sendCopiesLinkSms(phone, link, intake.provider?.name, intake.provider?.phone));
  }

  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  if (sent.length) {
    await markCopiesDelivered(intake.id);
  }
  await audit(sent.length ? "copies_link_sent" : "copies_link_failed", {
    providerId: opts.providerId,
    intakeId: intake.id,
    userId: opts.userId,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no client email or phone on file",
  });

  return {
    status: sent.length ? 200 : attempts.length ? 502 : 422,
    body: { ok: sent.length > 0, link, sent, failed, demo: attempts.some((r) => r.demo) },
  };
}

export async function autoSendCompletedCopiesIfEnabled(opts: SendCompletedCopiesOptions) {
  const answers = await loadAnswers(opts.intakeId);
  const results: Record<string, unknown> = {};
  if (autoSendCompletedCopiesEnabled(answers)) {
    const alreadySent = await prisma.auditLog.findFirst({
      where: { providerId: opts.providerId, intakeId: opts.intakeId, event: "copies_link_sent" },
    });
    results.clientCopies = alreadySent ? { skipped: true, reason: "Completed copies were already sent" } : await sendCompletedCopiesLink(opts);
  } else {
    results.clientCopies = { skipped: true, reason: "Client copy auto-send is off" };
  }
  if (autoEmailProviderPacketEnabled(answers)) {
    results.providerPacket = await sendCompletedPacketToProvider(opts);
  } else {
    results.providerPacket = { skipped: true, reason: "Provider packet email is off" };
  }
  return results;
}

export async function autoEmailProviderPacketIfEnabled(opts: SendCompletedCopiesOptions) {
  const answers = await loadAnswers(opts.intakeId);
  if (!autoEmailProviderPacketEnabled(answers)) {
    return { skipped: true, reason: "Provider packet email is off" };
  }
  return sendCompletedPacketToProvider(opts);
}

export async function setAutoSendCompletedCopies(intakeId: string, enabled: boolean): Promise<void> {
  await prisma.intakeAnswer.upsert({
    where: { intakeId_key: { intakeId, key: AUTO_SEND_COMPLETED_COPIES_KEY } },
    create: { intakeId, key: AUTO_SEND_COMPLETED_COPIES_KEY, value: JSON.stringify(enabled) },
    update: { value: JSON.stringify(enabled) },
  });
  await prisma.intake.update({ where: { id: intakeId }, data: { lastActivityAt: new Date() } });
}

export async function setAutoEmailProviderPacket(intakeId: string, enabled: boolean): Promise<void> {
  await prisma.intakeAnswer.upsert({
    where: { intakeId_key: { intakeId, key: AUTO_EMAIL_PROVIDER_PACKET_KEY } },
    create: { intakeId, key: AUTO_EMAIL_PROVIDER_PACKET_KEY, value: JSON.stringify(enabled) },
    update: { value: JSON.stringify(enabled) },
  });
  await prisma.intake.update({ where: { id: intakeId }, data: { lastActivityAt: new Date() } });
}

export async function sendCompletedPacketToProvider(opts: SendCompletedCopiesOptions) {
  const intake = await prisma.intake.findFirst({
    where: { id: opts.intakeId, providerId: opts.providerId },
    include: {
      client: true,
      provider: { select: { name: true, email: true } },
    },
  });
  if (!intake) return { skipped: true, reason: "Intake not found" };
  if (intake.archived || intake.status !== "COMPLETED") {
    return { skipped: true, reason: "Provider packet email waits until the intake is marked completed" };
  }
  try {
    await requireProviderPacketForCompletion(opts.providerId);
  } catch (error) {
    if (error instanceof ProviderPacketNotReadyError) {
      return { skipped: true, reason: error.message, code: error.code };
    }
    throw error;
  }
  if (!intake.provider?.email) return { skipped: true, reason: "Provider email is not configured" };
  const packet = await packetFreshnessForIntake(intake.id);
  if (packet.state !== "current" || !packet.pdfId || !packet.filePath || !fileExists(packet.filePath)) {
    return { skipped: true, reason: "The packet is outdated. Generate it again before emailing it." };
  }
  if (!opts.allowResend) {
    const alreadySent = await prisma.auditLog.findFirst({
      where: {
        providerId: opts.providerId,
        intakeId: opts.intakeId,
        event: "provider_packet_email_sent",
        detail: { startsWith: `pdfId:${packet.pdfId};` },
      },
    });
    if (alreadySent) return { skipped: true, reason: "This version of the provider packet was already sent" };
  }

  const fileName = `${intake.provider.name}-${intake.client.fullName}-completed-intake.pdf`
    .replace(/[^a-z0-9._-]+/gi, "-");
  const result = await sendCompletedPacketEmail(
    intake.provider.email,
    intake.client.fullName,
    intake.provider.name,
    readFile(packet.filePath),
    fileName,
  );
  if (result.ok) {
    await audit("provider_packet_email_sent", {
      providerId: opts.providerId,
      intakeId: opts.intakeId,
      userId: opts.userId,
      detail: `pdfId:${packet.pdfId}; sent to ${intake.provider.email}: ${result.detail}`,
    });
  }
  return { sent: result.ok, to: intake.provider.email, demo: result.demo, detail: result.detail };
}
