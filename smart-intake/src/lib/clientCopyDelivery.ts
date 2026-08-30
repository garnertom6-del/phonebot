export const COMPLETED_COPY_DELIVERY_KEY = "completed_copy_delivery";

export const COMPLETED_COPY_DELIVERY_OPTIONS = [
  "Text message",
  "Email",
  "Text message and email",
] as const;

export type CompletedCopyDeliveryOption = typeof COMPLETED_COPY_DELIVERY_OPTIONS[number];

export function completedCopyDeliveryChannels(answers: Record<string, unknown>): {
  sms: boolean;
  email: boolean;
  label: string;
} {
  const selected = answers[COMPLETED_COPY_DELIVERY_KEY];
  if (selected === "Text message") return { sms: true, email: false, label: "text message" };
  if (selected === "Email") return { sms: false, email: true, label: "email" };
  return { sms: true, email: true, label: "text message and email" };
}
