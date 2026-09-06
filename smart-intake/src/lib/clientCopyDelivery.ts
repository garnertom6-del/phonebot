import type { ClientDeliveryContact } from "./clientDeliveryContacts";

export const COMPLETED_COPY_DELIVERY_KEY = "completed_copy_delivery";

export const COMPLETED_COPY_DELIVERY_OPTIONS = [
  "Text message",
  "Email",
  "Text message and email",
] as const;

export type CompletedCopyDeliveryOption = typeof COMPLETED_COPY_DELIVERY_OPTIONS[number];

export function hasUsableClientEmail(answers: Record<string, unknown>): boolean {
  const email = String(answers.client_email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && ![
    "none reported by client",
    "none reported",
    "not reported",
    "n/a",
  ].includes(email);
}

/** Use the intended signer's email when offering completed-copy channels. */
export function hasUsableCompletedCopyEmail(
  answers: Record<string, unknown>,
  recipient?: ClientDeliveryContact | null,
): boolean {
  const guardianPreferred = answers.is_minor_or_incompetent === true
    || answers.is_minor_or_incompetent === "Yes";
  const role = recipient?.role || (guardianPreferred ? "guardian" : "client");
  const answerKey = role === "guardian" ? "guardian_email" : "client_email";
  // An explicit blank answer means the email was removed. Do not revive it
  // from a stale client record while resolving the actual signer.
  const email = recipient === null
    ? null
    : Object.prototype.hasOwnProperty.call(answers, answerKey)
      ? answers[answerKey]
      : recipient?.value;
  return hasUsableClientEmail({ client_email: email });
}

export function completedCopyDeliveryOptions(answers: Record<string, unknown>): CompletedCopyDeliveryOption[] {
  return hasUsableCompletedCopyEmail(answers)
    ? [...COMPLETED_COPY_DELIVERY_OPTIONS]
    : ["Text message"];
}

export function completedCopyDeliveryChannels(answers: Record<string, unknown>, recipient?: ClientDeliveryContact | null): {
  sms: boolean;
  email: boolean;
  label: string;
} {
  const selected = answers[COMPLETED_COPY_DELIVERY_KEY];
  if (selected === "Text message") return { sms: true, email: false, label: "text message" };
  if (selected === "Email") return { sms: false, email: true, label: "email" };
  if (selected === "Text message and email") return { sms: true, email: true, label: "text message and email" };
  if (!hasUsableCompletedCopyEmail(answers, recipient)) return { sms: true, email: false, label: "text message" };
  return { sms: true, email: true, label: "text message and email" };
}
