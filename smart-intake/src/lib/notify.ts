/**
 * Email/SMS adapters. In local demo mode (no credentials) these log to the
 * console. Production adapters for SendGrid/Twilio are wired but inactive
 * until env vars are set - see COWORKER_HANDOFF.md.
 */
import { appBaseUrl } from "./baseUrl";
import { prisma } from "./prisma";
import { intakeProcessExplanation, providerDisplayName, providerPhone } from "./providerBranding";
import { intakeOrientationAudioLine } from "./intakeOrientation";
import { followUpShareMessage, intakeShareMessage, signatureShareMessage } from "./shareLinks";

export interface NotifyResult {
  channel: "email" | "sms";
  to: string;
  ok: boolean;
  demo: boolean;
  detail: string;
  deliveryStatus?: "pending" | "delivered" | "failed";
  messageSid?: string;
}

export async function captureNotifyResult(
  channel: NotifyResult["channel"],
  to: string,
  send: () => Promise<NotifyResult>,
): Promise<NotifyResult> {
  try {
    return await send();
  } catch {
    return {
      channel,
      to,
      ok: false,
      demo: false,
      detail: "The delivery provider could not be reached. Try again shortly.",
      deliveryStatus: "failed",
    };
  }
}

type TwilioMessage = {
  sid?: string;
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
  message?: string;
  code?: number;
};

type ClientLinkPurpose = "intake" | "signature";

type SmsPurpose = "intake_link" | "signature_reminder" | "follow_up" | "provider_portal" | "completed_copies";

type SmsDeliveryContext = {
  intakeId?: string;
  providerId?: string;
  purpose: SmsPurpose;
};

const MAX_PROVIDER_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 5_000;
const FINAL_TWILIO_STATUSES = new Set(["delivered", "read", "failed", "undelivered", "canceled"]);

function normalizeUsPhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

async function responseText(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; error_message?: string; code?: number };
    return json.message || json.error_message || json.error || (json.code ? `Provider error ${json.code}` : text);
  } catch {
    return text.slice(0, 300);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskedSmsRecipient(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits ? `ending ${digits.slice(-4)}` : "masked";
}

function retryAfterMs(res: Response): number | null {
  const value = res.headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function fetchWithBackoff(
  input: string,
  init: RequestInit,
  opts: { retryServerErrors?: boolean } = {},
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetch(input, init);
    const retryable = response.status === 429
      || (opts.retryServerErrors === true && response.status >= 500 && response.status <= 599);
    if (!retryable || attempt === MAX_PROVIDER_ATTEMPTS - 1) return response;
    await response.arrayBuffer().catch(() => undefined);
    const exponential = Math.min(300 * (2 ** attempt), 2_400);
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential / 3)));
    const delay = Math.min(retryAfterMs(response) ?? exponential + jitter, MAX_RETRY_DELAY_MS);
    await wait(delay);
  }
  throw new Error("Delivery provider retry loop ended unexpectedly.");
}

function twilioFailureDetail(message: TwilioMessage): string {
  if ((message.error_code || message.code) === 30034) {
    return "Twilio blocked this SMS: the phone number needs A2P 10DLC registration before US carriers will deliver it (30034). Use an approved registered sender or a verified toll-free sender in a Messaging Service. Until sender approval is complete, use email or the secure QR link; retrying the same sender will not fix registration.";
  }
  const status = message.status ? `Twilio status ${message.status}` : "Twilio failed";
  const code = message.error_code ? ` (${message.error_code})` : "";
  const text = message.error_message ? `: ${message.error_message}` : "";
  return `${status}${code}${text}`;
}

async function fetchTwilioMessage(
  messageSid: string,
  accountSid: string,
  auth: string,
): Promise<TwilioMessage | null> {
  const response = await fetchWithBackoff(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}.json`,
    { headers: { Authorization: `Basic ${auth}` } },
    { retryServerErrors: true },
  );
  if (!response.ok) return null;
  return await response.json().catch(() => null) as TwilioMessage | null;
}

function tokenFromLink(link: string, segment: string): string | null {
  try {
    const parts = new URL(link).pathname.split("/").filter(Boolean);
    const index = parts.indexOf(segment);
    return index >= 0 ? parts[index + 1] || null : null;
  } catch {
    return null;
  }
}

async function smsContextForLink(link: string, purpose: SmsPurpose): Promise<SmsDeliveryContext> {
  const followUpToken = tokenFromLink(link, "follow-up");
  if (followUpToken) {
    const followUp = await prisma.intakeFollowUp.findUnique({
      where: { token: followUpToken },
      select: { intake: { select: { id: true, providerId: true } } },
    });
    if (followUp) {
      return {
        purpose,
        intakeId: followUp.intake.id,
        providerId: followUp.intake.providerId || undefined,
      };
    }
  }
  const intakeToken = tokenFromLink(link, "intake") || tokenFromLink(link, "copies");
  if (intakeToken) {
    const intake = await prisma.intake.findUnique({
      where: { token: intakeToken },
      select: { id: true, providerId: true },
    });
    if (intake) {
      return { purpose, intakeId: intake.id, providerId: intake.providerId || undefined };
    }
  }
  return { purpose };
}

async function sendTwilioSms(to: string, body: string, context: SmsDeliveryContext): Promise<NotifyResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!accountSid || !token || (!from && !messagingServiceSid)) {
    console.log(`[DEMO SMS to ${to}] (message not sent - SMS not configured)`);
    return {
      channel: "sms",
      to,
      ok: false,
      demo: true,
      detail: "SMS is not configured in Render",
      deliveryStatus: "failed",
    };
  }

  const normalizedTo = normalizeUsPhone(to);
  const delivery = await prisma.messageDelivery.create({
    data: {
      intakeId: context.intakeId,
      providerId: context.providerId,
      purpose: context.purpose,
      recipient: maskedSmsRecipient(normalizedTo),
      status: "pending",
    },
  });
  const callbackUrl = new URL("/api/webhooks/twilio-status", `${appBaseUrl().replace(/\/$/, "")}/`);
  callbackUrl.searchParams.set("deliveryId", delivery.id);
  const auth = Buffer.from(`${accountSid}:${token}`).toString("base64");
  let response: Response;
  try {
    // A 429 means Twilio rejected the attempt before accepting a message, so it
    // is safe to retry. Twilio documents message-creation POSTs as
    // non-idempotent after 5xx; retrying those can send duplicate texts.
    response = await fetchWithBackoff(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          To: normalizedTo,
          ...(messagingServiceSid
            ? { MessagingServiceSid: messagingServiceSid }
            : { From: normalizeUsPhone(from!) }),
          Body: body,
          StatusCallback: callbackUrl.toString(),
        }),
      },
      { retryServerErrors: false },
    );
  } catch (error) {
    await prisma.messageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Twilio request failed",
        isFinal: true,
        finalAt: new Date(),
        lastStatusAt: new Date(),
      },
    });
    throw error;
  }

  const message = await response.json().catch(() => null) as TwilioMessage | null;
  if (!response.ok || !message) {
    const detail = message && (message.error_code || message.code) === 30034
      ? twilioFailureDetail(message)
      : message?.message || message?.error_message || `Twilio returned ${response.status}`;
    await prisma.messageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "failed",
        errorCode: message?.code ? String(message.code) : String(response.status),
        errorMessage: detail.slice(0, 500),
        isFinal: true,
        finalAt: new Date(),
        lastStatusAt: new Date(),
      },
    });
    return { channel: "sms", to, ok: false, demo: false, detail, deliveryStatus: "failed" };
  }

  if (!message.sid) {
    await prisma.messageDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "failed",
        errorMessage: "Twilio accepted the request without returning a message SID.",
        isFinal: true,
        finalAt: new Date(),
        lastStatusAt: new Date(),
      },
    });
    return {
      channel: "sms",
      to,
      ok: false,
      demo: false,
      detail: "Twilio did not return a trackable message ID.",
      deliveryStatus: "failed",
    };
  }
  const latest = FINAL_TWILIO_STATUSES.has((message.status || "").toLowerCase())
    ? message
    : await fetchTwilioMessage(message.sid, accountSid, auth).catch(() => null) || message;
  const status = (latest.status || "queued").toLowerCase();
  const failed = status === "failed" || status === "undelivered" || status === "canceled";
  const delivered = status === "delivered" || status === "read";
  const final = FINAL_TWILIO_STATUSES.has(status);
  await prisma.messageDelivery.updateMany({
    where: { id: delivery.id, isFinal: false },
    data: {
      messageSid: message.sid,
      status,
      errorCode: latest.error_code ? String(latest.error_code) : null,
      errorMessage: latest.error_message?.slice(0, 500) || null,
      isFinal: final,
      deliveredAt: delivered ? new Date() : null,
      finalAt: final ? new Date() : null,
      lastStatusAt: new Date(),
    },
  });
  if (failed) {
    return {
      channel: "sms",
      to,
      ok: false,
      demo: false,
      detail: twilioFailureDetail(latest),
      deliveryStatus: "failed",
      messageSid: message.sid,
    };
  }
  return {
    channel: "sms",
    to,
    ok: true,
    demo: false,
    detail: delivered ? "delivery confirmed by Twilio" : `pending Twilio delivery confirmation (${status})`,
    deliveryStatus: delivered ? "delivered" : "pending",
    messageSid: message.sid,
  };
}

export async function sendClientLinkEmail(
  to: string,
  clientName: string,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
  purpose: ClientLinkPurpose = "intake",
): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const provider = providerDisplayName(providerName);
  const signatureReminder = purpose === "signature";
  const subject = signatureReminder
    ? `${provider} - Signature needed to finish your intake`
    : `${provider} - Your new-client questions`;
  const body = signatureReminder
    ? `Hello ${clientName},\n\nYour answers are saved, but we still need the client or guardian signature. ` +
      `Open the same secure link below, review the saved answers, and sign at the end:\n\n${link}\n\n` +
      `This private link works for ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days. Please do not forward it. ` +
      `If you already signed, no action is needed.\n\nQuestions? Call ${providerPhone(supportPhone, providerName)}.`
    : `Hello ${clientName},\n\n${intakeProcessExplanation(providerName)} ` +
      `Most people can complete the secure form on a phone. Your progress saves as you go, so you can leave and return before submitting.\n\n` +
      `Open your private link (works for ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days):\n${link}\n\n` +
      `You can type or speak your answers and sign on your phone. Please do not forward this link.` +
      `${intakeOrientationAudioLine()}\n\nQuestions? Call ${providerPhone(supportPhone, providerName)}.`;
  if (!key || !process.env.EMAIL_FROM) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM as string },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "accepted by SendGrid" : await responseText(res),
  };
}

export async function sendClientLinkSms(
  to: string,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
  purpose: ClientLinkPurpose = "intake",
): Promise<NotifyResult> {
  const body = purpose === "signature"
    ? signatureShareMessage(link, providerName, supportPhone)
    : intakeShareMessage(link, providerName, supportPhone);
  const context = await smsContextForLink(
    link,
    purpose === "signature" ? "signature_reminder" : "intake_link",
  );
  return sendTwilioSms(to, body, context);
}

export async function sendFollowUpEmail(
  to: string,
  recipientName: string,
  link: string,
  questionCount: number,
  providerName?: string | null,
  supportPhone?: string | null,
): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const provider = providerDisplayName(providerName);
  const subject = `${provider} - A few more intake details`;
  const body =
    `Hello ${recipientName},\n\nWe need ${questionCount} more ${questionCount === 1 ? "answer" : "answers"} ` +
    `to finish your intake. This link shows only the requested questions:\n\n${link}\n\n` +
    `The private link works for ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days and closes after you submit it. ` +
    `Please do not forward it.\n\nQuestions? Call ${providerPhone(supportPhone, providerName)}.`;
  if (!key || !process.env.EMAIL_FROM) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM as string },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "accepted by SendGrid" : await responseText(res),
  };
}

export async function sendFollowUpSms(
  to: string,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): Promise<NotifyResult> {
  const context = await smsContextForLink(link, "follow_up");
  return sendTwilioSms(to, followUpShareMessage(link, providerName, supportPhone), context);
}

export async function sendProviderPortalEmail(to: string, providerName: string, link: string): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const subject = `${providerName} - Secure provider workspace`;
  const body = `Hello,\n\nYour secure provider workspace is ready. Sign in to review and manage your assigned client intakes:\n\n${link}\n\nThis message does not include client information. Keep your provider login private.`;
  if (!key || !process.env.EMAIL_FROM) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM as string },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return { channel: "email", to, ok: res.ok, demo: false, detail: res.ok ? "accepted by SendGrid" : await responseText(res) };
}

export async function sendProviderPortalSms(to: string, providerName: string, link: string): Promise<NotifyResult> {
  const body = `${providerName}: your secure provider workspace is ready. Sign in to review assigned client intakes: ${link}`;
  return sendTwilioSms(to, body, { purpose: "provider_portal" });
}

export async function sendCopiesLinkEmail(
  to: string,
  clientName: string,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const provider = providerDisplayName(providerName);
  const subject = `${provider} - Your completed intake copies`;
  const body =
    `Hello ${clientName},\n\nYour completed ${provider} intake copies are ready. ` +
    `This includes the full wording for your client orientation, consent for treatment, ` +
    `rights and responsibilities, privacy/confidentiality notices, emergency care consents, ` +
    `and the other sections you reviewed and completed.\n\n` +
    `View or save your completed copies here:\n\n${link}\n\nQuestions? Call ${providerPhone(supportPhone, providerName)}.`;
  if (!key || !process.env.EMAIL_FROM) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM as string },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "accepted by SendGrid" : await responseText(res),
  };
}

export async function sendCopiesLinkSms(
  to: string,
  link: string,
  providerName?: string | null,
  _supportPhone?: string | null,
  deliveryContext?: { intakeId: string; providerId: string },
): Promise<NotifyResult> {
  const body = `${providerDisplayName(providerName)}: your completed intake copies are ready. View or save them here: ${link}\nSTOP to opt out.`;
  const context = deliveryContext
    ? { ...deliveryContext, purpose: "completed_copies" as const }
    : await smsContextForLink(link, "completed_copies");
  return sendTwilioSms(to, body, context);
}

export async function sendCompletedPacketEmail(
  to: string,
  clientName: string,
  providerName: string,
  pdfBytes: Buffer,
  fileName: string,
): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const subject = `${providerName} - Completed smart intake packet for ${clientName}`;
  const body =
    `The completed smart intake packet for ${clientName} is attached. ` +
    `Keep this message and attachment in the provider's approved secure records system. ` +
    `Questions? Contact ${providerName}.`;
  if (!key || !process.env.EMAIL_FROM) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}\nAttachment: ${fileName}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM as string },
      subject,
      content: [{ type: "text/plain", value: body }],
      attachments: [{
        content: pdfBytes.toString("base64"),
        type: "application/pdf",
        filename: fileName,
        disposition: "attachment",
      }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "completed packet attachment accepted by SendGrid" : await responseText(res),
  };
}
