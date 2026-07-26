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

function smsRecipient(phone?: string | null): string {
  const text = (phone || "").trim();
  if (!text) return "";
  const leadingPlus = text.startsWith("+") ? "+" : "";
  return leadingPlus + text.replace(/\D/g, "");
}

export function intakeSmsHref(
  phone: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  return `sms:${smsRecipient(phone)}?body=${encodeURIComponent(intakeShareMessage(link, providerName, supportPhone))}`;
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
  return `sms:${smsRecipient(phone)}?body=${encodeURIComponent(`${copiesShareMessage(link, providerName)} STOP to opt out.`)}`;
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
