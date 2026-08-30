import { prisma } from "./prisma";
import { appBaseUrl } from "./baseUrl";
import { audit } from "./auditLog";
import { loadAnswers } from "./intakeData";
import {
  AUTO_SEND_COMPLETED_COPIES_KEY,
  AUTO_EMAIL_PROVIDER_PACKET_KEY,
  COPY_ALLOWED_STATUSES,
  autoEmailProviderPacketEnabled,
  autoSendCompletedCopiesEnabled,
} from "./completedCopies";
import {
  captureNotifyResult,
  sendCompletedPacketEmail,
  sendCopiesLinkEmail,
  sendCopiesLinkSms,
  type NotifyResult,
} from "./notify";
import { answeredClientFields } from "./clientAnswerSync";
import { clientFollowUpDeliveryContacts } from "./clientDeliveryContacts";
import { completedCopyDeliveryChannels } from "./clientCopyDelivery";
import { fileExists, readFile } from "./storage";
import { packetFreshnessForIntake } from "./packetFreshness";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "./providerPacketTemplates";

function sentLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
}

function failedLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
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
      signatures: { select: { role: true } },
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
        error: "The intake must be active, submitted, and completed before sending client copies.",
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
  const deliveryClient = {
    ...intake.client,
    fullName: intake.client.fullName || answeredClient.fullName,
    email: intake.client.email || answeredClient.email,
    phone: intake.client.phone || answeredClient.phone,
    guardianName: intake.client.guardianName || answeredClient.guardianName,
    guardianEmail: intake.client.guardianEmail || answeredClient.guardianEmail,
    guardianPhone: intake.client.guardianPhone || answeredClient.guardianPhone,
  };
  const contacts = clientFollowUpDeliveryContacts(deliveryClient, answers, intake.signatures);
  const deliveryChoice = completedCopyDeliveryChannels(answers);
  const unavailable: string[] = [];
  if (deliveryChoice.email && contacts.email) {
    const recipientName = contacts.email.role === "guardian"
      ? deliveryClient.guardianName || "Parent or guardian"
      : deliveryClient.fullName;
    attempts.push(await captureNotifyResult("email", contacts.email.value, () => (
      sendCopiesLinkEmail(
        contacts.email!.value,
        recipientName,
        link,
        intake.provider?.name,
        intake.provider?.phone,
      )
    )));
  } else if (deliveryChoice.email) {
    unavailable.push("Email was selected, but no client or guardian email is saved.");
  }
  if (deliveryChoice.sms && contacts.phone) {
    attempts.push(await captureNotifyResult("sms", contacts.phone.value, () => (
      sendCopiesLinkSms(
        contacts.phone!.value,
        link,
        intake.provider?.name,
        intake.provider?.phone,
        { intakeId: intake.id, providerId: opts.providerId },
      )
    )));
  } else if (deliveryChoice.sms) {
    unavailable.push("Text message was selected, but no client or guardian mobile number is saved.");
  }

  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  const pending = attempts.filter((r) => r.ok && r.deliveryStatus === "pending").map(sentLabel);
  const confirmed = attempts.filter((r) => r.ok && r.deliveryStatus === "delivered").map(sentLabel);
  const acceptedEmail = attempts.some((r) => r.ok && r.channel === "email");
  const confirmedSms = attempts.some((r) => r.ok && r.channel === "sms" && r.deliveryStatus === "delivered");
  await audit(
    acceptedEmail || confirmedSms
      ? "copies_link_sent"
      : sent.length
        ? "sms_status_updated"
        : "copies_link_failed",
    {
    providerId: opts.providerId,
    intakeId: intake.id,
    userId: opts.userId,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      pending.length ? `pending confirmation ${pending.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
      unavailable.length ? unavailable.join(" ") : "",
    ].filter(Boolean).join("; ") || "no selected client delivery channel is available",
    },
  );

  return {
    status: sent.length ? 200 : attempts.length ? 502 : 422,
    body: {
      ok: sent.length > 0,
      link,
      sent,
      pending,
      confirmed,
      failed,
      unavailable,
      preference: deliveryChoice.label,
      error: sent.length ? undefined : unavailable.join(" ") || "No selected delivery channel accepted the completed-copy link.",
      demo: attempts.some((r) => r.demo),
    },
  };
}

export async function autoSendCompletedCopiesIfEnabled(opts: SendCompletedCopiesOptions) {
  const answers = await loadAnswers(opts.intakeId);
  const results: Record<string, unknown> = {};
  if (autoSendCompletedCopiesEnabled(answers)) {
    const alreadySent = await prisma.auditLog.findFirst({
      where: { providerId: opts.providerId, intakeId: opts.intakeId, event: "copies_delivery_confirmed" },
    });
    const pendingDelivery = await prisma.messageDelivery.findFirst({
      where: {
        providerId: opts.providerId,
        intakeId: opts.intakeId,
        purpose: "completed_copies",
        isFinal: false,
      },
    });
    results.clientCopies = alreadySent
      ? { skipped: true, reason: "Completed-copy delivery was already confirmed" }
      : pendingDelivery
        ? { skipped: true, reason: "Completed-copy delivery is awaiting confirmation" }
        : await sendCompletedCopiesLink(opts);
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
