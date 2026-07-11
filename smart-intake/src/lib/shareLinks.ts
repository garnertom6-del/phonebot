import { intakeProcessExplanation, providerDisplayName, providerPhone } from "./providerBranding";

export function intakeShareMessage(link: string, providerName?: string | null): string {
  return `${intakeProcessExplanation(providerName)} Secure link: ${link}`;
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

export function intakeSmsHref(phone: string | null | undefined, link: string, providerName?: string | null): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(intakeShareMessage(link, providerName))}`;
}

export function intakeMailtoHref(
  email: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  const subject = encodeURIComponent(`${provider} intake link`);
  const body = encodeURIComponent(`${intakeShareMessage(link, provider)}\n\nQuestions? Call ${providerPhone(supportPhone)}.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}

export function copiesSmsHref(phone: string | null | undefined, link: string, providerName?: string | null): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(copiesShareMessage(link, providerName))}`;
}

export function copiesMailtoHref(
  email: string | null | undefined,
  link: string,
  providerName?: string | null,
  supportPhone?: string | null,
): string {
  const provider = providerDisplayName(providerName);
  const subject = encodeURIComponent(`${provider} intake copies`);
  const body = encodeURIComponent(`${copiesShareMessage(link, provider)}\n\nQuestions? Call ${providerPhone(supportPhone)}.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}
