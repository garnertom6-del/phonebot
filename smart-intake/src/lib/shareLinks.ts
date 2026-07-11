function providerLabel(providerName?: string | null): string {
  return providerName?.trim() || "Moore Divine Care";
}

export function intakeShareMessage(link: string, providerName?: string | null): string {
  return `${providerLabel(providerName)}: please answer your new-client questions here (secure link): ${link}`;
}

export function copiesShareMessage(link: string, providerName?: string | null): string {
  return `${providerLabel(providerName)}: here are your copies from your visit (Your Rights, How Our Program Works, Consent for Treatment, and our Welcome Letter): ${link}`;
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

export function intakeMailtoHref(email: string | null | undefined, link: string, providerName?: string | null): string {
  const provider = providerLabel(providerName);
  const subject = encodeURIComponent(`${provider} intake link`);
  const body = encodeURIComponent(`${intakeShareMessage(link, provider)}\n\nQuestions? Call 336-285-5204.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}

export function copiesSmsHref(phone: string | null | undefined, link: string, providerName?: string | null): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(copiesShareMessage(link, providerName))}`;
}

export function copiesMailtoHref(email: string | null | undefined, link: string, providerName?: string | null): string {
  const provider = providerLabel(providerName);
  const subject = encodeURIComponent(`${provider} intake copies`);
  const body = encodeURIComponent(`${copiesShareMessage(link, provider)}\n\nQuestions? Call 336-285-5204.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}
