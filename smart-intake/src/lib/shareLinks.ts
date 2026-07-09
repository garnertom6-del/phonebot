export function intakeShareMessage(link: string): string {
  return `Moore Divine Care: please answer your new-client questions here (secure link): ${link}`;
}

export function copiesShareMessage(link: string): string {
  return `Moore Divine Care: here are your copies from your visit (Your Rights, How Our Program Works, Consent for Treatment, and our Welcome Letter): ${link}`;
}

function smsRecipient(phone?: string | null): string {
  const text = (phone || "").trim();
  if (!text) return "";
  const leadingPlus = text.startsWith("+") ? "+" : "";
  return leadingPlus + text.replace(/\D/g, "");
}

export function intakeSmsHref(phone: string | null | undefined, link: string): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(intakeShareMessage(link))}`;
}

export function intakeMailtoHref(email: string | null | undefined, link: string): string {
  const subject = encodeURIComponent("Moore Divine Care intake link");
  const body = encodeURIComponent(`${intakeShareMessage(link)}\n\nQuestions? Call 336-285-5204.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}

export function copiesSmsHref(phone: string | null | undefined, link: string): string {
  return `sms:${smsRecipient(phone)}?&body=${encodeURIComponent(copiesShareMessage(link))}`;
}

export function copiesMailtoHref(email: string | null | undefined, link: string): string {
  const subject = encodeURIComponent("Moore Divine Care intake copies");
  const body = encodeURIComponent(`${copiesShareMessage(link)}\n\nQuestions? Call 336-285-5204.`);
  return `mailto:${(email || "").trim()}?subject=${subject}&body=${body}`;
}
