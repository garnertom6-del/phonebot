/**
 * Email/SMS adapters. In local demo mode (no credentials) these log to the
 * console. Production adapters for SendGrid/Twilio are wired but inactive
 * until env vars are set - see COWORKER_HANDOFF.md.
 */

export interface NotifyResult {
  channel: "email" | "sms";
  to: string;
  ok: boolean;
  demo: boolean;
  detail: string;
}

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

export async function sendClientLinkEmail(to: string, clientName: string, link: string): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const subject = "Moore Divine Care, Inc. - Your intake questions";
  const body =
    `Hello ${clientName},\n\nPlease complete your intake for Moore Divine Care, Inc. ` +
    `using this secure link (expires in ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days):\n\n${link}\n\n` +
    `You can answer by typing or speaking, and sign right on your phone.\n\nQuestions? Call 336-285-5204.`;
  if (!key) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}\n${body}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM || "intake@example.com" },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "queued by SendGrid" : await responseText(res),
  };
}

export async function sendClientLinkSms(to: string, link: string): Promise<NotifyResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = `Moore Divine Care: complete your intake here (secure link): ${link}`;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !process.env.TWILIO_AUTH_TOKEN || !from) {
    console.log(`[DEMO SMS to ${to}] ${body}`);
    return { channel: "sms", to, ok: false, demo: true, detail: "SMS is not configured in Render" };
  }
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: normalizeUsPhone(to), From: normalizeUsPhone(from), Body: body }),
  });
  const detail = res.ok ? "queued by Twilio" : await responseText(res);
  return { channel: "sms", to, ok: res.ok, demo: false, detail };
}

export async function sendCopiesLinkEmail(to: string, clientName: string, link: string): Promise<NotifyResult> {
  const key = process.env.SENDGRID_API_KEY;
  const subject = "Moore Divine Care, Inc. - Copies from your intake";
  const body =
    `Hello ${clientName},\n\nHere is your copy link for the intake materials Moore Divine Care provided: ` +
    `Client Rights, Client Orientation, Consent for Treatment, Welcome Letter, and review acknowledgments.\n\n` +
    `${link}\n\nQuestions? Call 336-285-5204.`;
  if (!key) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}\n${body}`);
    return { channel: "email", to, ok: false, demo: true, detail: "Email is not configured in Render" };
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.EMAIL_FROM || "intake@example.com" },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });
  return {
    channel: "email",
    to,
    ok: res.ok,
    demo: false,
    detail: res.ok ? "queued by SendGrid" : await responseText(res),
  };
}

export async function sendCopiesLinkSms(to: string, link: string): Promise<NotifyResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = `Moore Divine Care: copies from your intake are here: ${link}`;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !process.env.TWILIO_AUTH_TOKEN || !from) {
    console.log(`[DEMO SMS to ${to}] ${body}`);
    return { channel: "sms", to, ok: false, demo: true, detail: "SMS is not configured in Render" };
  }
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: normalizeUsPhone(to), From: normalizeUsPhone(from), Body: body }),
  });
  const detail = res.ok ? "queued by Twilio" : await responseText(res);
  return { channel: "sms", to, ok: res.ok, demo: false, detail };
}
