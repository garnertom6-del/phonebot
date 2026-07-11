/**
 * Email/SMS adapters. In local demo mode (no credentials) these log to the
 * console. Production adapters for SendGrid/Twilio are wired but inactive
 * until env vars are set - see COWORKER_HANDOFF.md.
 */
import { providerDisplayName, providerPhone } from "./providerBranding";

export interface NotifyResult {
  channel: "email" | "sms";
  to: string;
  ok: boolean;
  demo: boolean;
  detail: string;
}

type TwilioMessage = {
  sid?: string;
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
  message?: string;
  code?: number;
};

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

function twilioFailureDetail(message: TwilioMessage): string {
  if (message.error_code === 30034) {
    return "Twilio blocked this SMS: the phone number needs A2P 10DLC registration before US carriers will deliver it (30034).";
  }
  const status = message.status ? `Twilio status ${message.status}` : "Twilio failed";
  const code = message.error_code ? ` (${message.error_code})` : "";
  const text = message.error_message ? `: ${message.error_message}` : "";
  return `${status}${code}${text}`;
}

async function fetchTwilioMessage(sid: string, accountSid: string, auth: string): Promise<TwilioMessage | null> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null) as TwilioMessage | null;
}

async function twilioSmsResult(res: Response, accountSid: string, auth: string): Promise<{ ok: boolean; detail: string }> {
  const message = await res.json().catch(() => null) as TwilioMessage | null;
  if (!res.ok || !message) {
    return { ok: false, detail: message?.message || message?.error_message || `Twilio returned ${res.status}` };
  }
  if (message.status === "failed" || message.status === "undelivered") {
    return { ok: false, detail: twilioFailureDetail(message) };
  }
  if (message.sid) {
    for (const delay of [800, 1200, 2000]) {
      await wait(delay);
      const latest = await fetchTwilioMessage(message.sid, accountSid, auth);
      if (!latest) continue;
      if (latest.status === "failed" || latest.status === "undelivered") {
        return { ok: false, detail: twilioFailureDetail(latest) };
      }
      if (latest.status === "delivered") {
        return { ok: true, detail: "delivered by Twilio" };
      }
    }
  }
  return { ok: true, detail: "queued by Twilio" };
}

export async function sendClientLinkEmail(
  to: string,
  clientName: string,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const provider = providerDisplayName(providerName);
  const subject = `${provider} - Your new-client questions`;
  const body =
    `Hello ${clientName},\n\nPlease answer your new-client questions for ${provider} ` +
    `using this secure link (it works for ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days):\n\n${link}\n\n` +
    `You can answer by typing or speaking, and sign right on your phone.\n\nQuestions? Call ${providerPhone(supportPhone)}.`;
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
  _supportPhone?: string | null,
): Promise<NotifyResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const body = `${providerDisplayName(providerName)}: please answer your new-client questions here (secure link): ${link}`;
  if (!sid || !token || !from) {
    console.log(`[DEMO SMS to ${to}] (message not sent - SMS not configured)`);
    return { channel: "sms", to, ok: false, demo: true, detail: "SMS is not configured in Render" };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: normalizeUsPhone(to), From: normalizeUsPhone(from), Body: body }),
  });
  const result = res.ok ? await twilioSmsResult(res, sid, auth) : { ok: false, detail: await responseText(res) };
  return { channel: "sms", to, ok: result.ok, demo: false, detail: result.detail };
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
    `View or save your completed copies here:\n\n${link}\n\nQuestions? Call ${providerPhone(supportPhone)}.`;
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
): Promise<NotifyResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const body = `${providerDisplayName(providerName)}: your completed intake copies are ready. View or save them here: ${link}`;
  if (!sid || !token || !from) {
    console.log(`[DEMO SMS to ${to}] (message not sent - SMS not configured)`);
    return { channel: "sms", to, ok: false, demo: true, detail: "SMS is not configured in Render" };
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: normalizeUsPhone(to), From: normalizeUsPhone(from), Body: body }),
  });
  const result = res.ok ? await twilioSmsResult(res, sid, auth) : { ok: false, detail: await responseText(res) };
  return { channel: "sms", to, ok: result.ok, demo: false, detail: result.detail };
}
