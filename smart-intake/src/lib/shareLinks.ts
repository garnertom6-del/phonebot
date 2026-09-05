import { intakeProcessExplanation, providerDisplayName, providerPhone } from "./providerBranding";
import { intakeOrientationAudioLine } from "./intakeOrientation";

function smsHelpLine(supportPhone?: string | null, providerName?: string | null): string {
  const phone = supportPhone?.trim();
  return phone ? ` Help ${providerPhone(phone, providerName)}.` : "";
}

export function intakeShareMessage(
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  return `${provider}: Tap your private intake link to answer questions, review rights and consents, and sign: ${link}\nSave and return anytime; your answers are saved as you go. Do not forward.${smsHelpLine(supportPhone, providerName)} STOP to opt out.`;
}

export function signatureShareMessage(
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  return `${provider}: Signature needed to finish your secure form: ${link}\nYour answers are saved.${smsHelpLine(supportPhone, providerName)} STOP to opt out.`;
}

export function copiesShareMessage(link: string, providerName?: string | null): string {
  return `${providerDisplayName(providerName)}: here are your copies from your visit (Your Rights, How Our Program Works, Consent for Treatment, and our Welcome Letter): ${link}`;
}

export function followUpShareMessage(
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  return `${provider}: We need a few more details to finish your intake. Use this private one-time link: ${link}${smsHelpLine(supportPhone, providerName)} STOP to opt out.`;
}

export type SmsPlatform = "ios" | "android" | "unknown";

/** Normalize a staff-entered number for sms: URLs. 10-digit US numbers get +1, matching Twilio. */
export function smsRecipient(phone?: string | null): string {
  const text = (phone || "").trim();
  if (!text) return "";
  if (text.startsWith("+")) {
    const digits = text.replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }
  const digits = text.replace(/\D/g, "");
  // Normalize US numbers to E.164 so the sms: link works when it is scanned
  // from a QR code on a phone whose default region is not set.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function detectSmsPlatform(userAgent = ""): SmsPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "unknown";
}

/** Phones (and some tablets) usually handle sms: links. Office PCs usually do not. */
export function deviceLikelyOpensSms(userAgent = ""): boolean {
  return detectSmsPlatform(userAgent) !== "unknown";
}

/**
 * Build an sms: href. iOS wants &body=; Android wants ?body=.
 * Unknown platforms (QR scans, desktops) use ?&body=, which both families typically accept.
 */
export function smsHref(
  phone: string | null | undefined,
  body: string,
  platform: SmsPlatform = "unknown",
): string {
  const to = smsRecipient(phone);
  if (!to) return "";
  const encoded = encodeURIComponent(body);
  if (platform === "ios") return `sms:${to}&body=${encoded}`;
  if (platform === "android") return `sms:${to}?body=${encoded}`;
  return `sms:${to}?&body=${encoded}`;
}

export function isUnreachableClientLink(link: string): boolean {
  try {
    const hostname = new URL(link).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function intakeSmsHref(
  phone: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
  platform: SmsPlatform = "unknown",
): string {
  return smsHref(phone, intakeShareMessage(link, providerName, supportPhone), platform);
}

export function intakeMailtoHref(
  email: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  const subject = encodeURIComponent(`${provider} intake link`);
  const body = encodeURIComponent(
    `${intakeProcessExplanation(provider)}\n\n` +
    `Open your secure intake form here:\n${link}\n\n` +
    `You can answer by typing or speaking, save your progress, and sign on your phone. ` +
    `Please do not forward this private link.${intakeOrientationAudioLine()}\n\n` +
    `Questions? Call ${providerPhone(supportPhone, providerName)}.`,
  );
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}

export function copiesSmsHref(
  phone: string | null | undefined,
  link: string,
  providerName?: string | null,
  platform: SmsPlatform = "unknown",
): string {
  return smsHref(phone, `${copiesShareMessage(link, providerName)} STOP to opt out.`, platform);
}

export function copiesMailtoHref(
  email: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  const subject = encodeURIComponent(`${provider} intake copies`);
  const body = encodeURIComponent(`${copiesShareMessage(link, provider)}\n\nQuestions? Call ${providerPhone(supportPhone, providerName)}.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}

export function followUpSmsHref(
  phone: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
  platform: SmsPlatform = "unknown",
): string {
  return smsHref(phone, followUpShareMessage(link, providerName, supportPhone), platform);
}

export function followUpMailtoHref(
  email: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  const subject = encodeURIComponent(`${provider} - a few more intake details`);
  const body = encodeURIComponent(
    `We need a few more details to finish your intake. Open this private one-time link:\n\n${link}\n\n` +
    `Please do not forward this link. Questions? Call ${providerPhone(supportPhone, providerName)}.`,
  );
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}
