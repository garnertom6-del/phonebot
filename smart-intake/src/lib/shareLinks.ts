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
  return `${provider}: Secure form: ${link}\nSave and return while this link is active.${smsHelpLine(supportPhone, providerName)} STOP to opt out.`;
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

function smsRecipient(phone?: string | null): string {
  const text = (phone || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  // Normalize US numbers to E.164 so the sms: link works when it is scanned
  // from a QR code on a phone whose default region is not set.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  const leadingPlus = text.startsWith("+") ? "+" : "";
  return leadingPlus + digits;
}

/**
 * sms: links differ by platform: iOS wants `sms:number&body=`, Android wants
 * `sms:number?body=`. The `?&body=` form is read correctly by both.
 */
function smsHref(phone: string | null | undefined, body: string): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(body)}`;
}

export function intakeSmsHref(
  phone: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  return smsHref(phone, intakeShareMessage(link, providerName, supportPhone));
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

export function copiesSmsHref(phone: string | null | undefined, link: string, providerName?: string | null): string {
  return smsHref(phone, `${copiesShareMessage(link, providerName)} STOP to opt out.`);
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
): string {
  return smsHref(phone, followUpShareMessage(link, providerName, supportPhone));
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
