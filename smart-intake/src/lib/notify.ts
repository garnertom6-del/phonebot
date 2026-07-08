/**
 * Email/SMS adapters. In local demo mode (no credentials) these log to the
 * console. Production adapters for SendGrid/Twilio are wired but inactive
 * until env vars are set - see COWORKER_HANDOFF.md.
 */

export async function sendClientLinkEmail(to: string, clientName: string, link: string) {
  const key = process.env.SENDGRID_API_KEY;
  const subject = "Moore Divine Care, Inc. - Your intake questions";
  const body =
    `Hello ${clientName},\n\nPlease complete your intake for Moore Divine Care, Inc. ` +
    `using this secure link (expires in ${process.env.CLIENT_LINK_EXPIRY_DAYS || 7} days):\n\n${link}\n\n` +
    `You can answer by typing or speaking, and sign right on your phone.\n\nQuestions? Call 336-285-5204.`;
  if (!key) {
    console.log(`[DEMO EMAIL to ${to}]\nSubject: ${subject}\n${body}`);
    return { demo: true };
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
  return { demo: false, ok: res.ok };
}

export async function sendClientLinkSms(to: string, link: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = `Moore Divine Care: complete your intake here (secure link): ${link}`;
  if (!sid) {
    console.log(`[DEMO SMS to ${to}] ${body}`);
    return { demo: true };
  }
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER || "", Body: body }),
  });
  return { demo: false, ok: res.ok };
}
