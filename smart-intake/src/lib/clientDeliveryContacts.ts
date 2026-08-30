import { formatUsPhoneDisplay } from "./intakeContacts";

export type ClientDeliveryRole = "client" | "guardian";

export type ClientDeliveryContact = {
  value: string;
  role: ClientDeliveryRole;
};

export type ClientContactFields = {
  phone?: string | null;
  email?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
};

function contact(value: string | null | undefined, role: ClientDeliveryRole): ClientDeliveryContact | null {
  const trimmed = value?.trim();
  return trimmed ? { value: trimmed, role } : null;
}

function isYes(value: unknown): boolean {
  return value === true || value === "Yes";
}

function isNo(value: unknown): boolean {
  return value === false || value === "No";
}

/**
 * Youth / guardian intakes should text the guardian when that number exists.
 * Adults keep the client cell first. Missing preferred contact falls back so
 * a youth with only a client cell still gets the link.
 */
export function preferredIntakeDeliveryRole(
  client: ClientContactFields,
  answers: Record<string, unknown> = {},
): ClientDeliveryRole {
  if (isYes(answers.is_minor_or_incompetent)) return "guardian";
  if (isNo(answers.is_minor_or_incompetent)) return "client";
  if (client.guardianName?.trim()) return "guardian";
  return "client";
}

export function clientDeliveryContacts(client: ClientContactFields, answers: Record<string, unknown> = {}): {
  phone: ClientDeliveryContact | null;
  email: ClientDeliveryContact | null;
} {
  const preferred = preferredIntakeDeliveryRole(client, answers);
  if (preferred === "guardian") {
    return {
      phone: contact(client.guardianPhone, "guardian") || contact(client.phone, "client"),
      email: contact(client.guardianEmail, "guardian") || contact(client.email, "client"),
    };
  }
  return {
    phone: contact(client.phone, "client") || contact(client.guardianPhone, "guardian"),
    email: contact(client.email, "client") || contact(client.guardianEmail, "guardian"),
  };
}

export function deliveryContactsSummary(contacts: {
  phone: ClientDeliveryContact | null;
  email: ClientDeliveryContact | null;
}): string {
  return [
    contacts.phone ? `SMS to ${contacts.phone.role} at ${formatUsPhoneDisplay(contacts.phone.value)}` : "",
    contacts.email ? `email to ${contacts.email.role} at ${contacts.email.value}` : "",
  ].filter(Boolean).join(" and ");
}

export function clientFollowUpDeliveryContacts(
  client: ClientContactFields,
  answers: Record<string, unknown> = {},
  signatures: Array<{ role: string }> = [],
): {
  role: ClientDeliveryRole;
  phone: ClientDeliveryContact | null;
  email: ClientDeliveryContact | null;
} {
  const guardianPreferred = isYes(answers.is_minor_or_incompetent);
  const guardianSigned = signatures.some((signature) => signature.role === "guardian");
  const clientSigned = signatures.some((signature) => signature.role === "client");
  const role: ClientDeliveryRole = guardianSigned && !clientSigned
    ? "guardian"
    : clientSigned && !guardianSigned
      ? "client"
      : guardianSigned && clientSigned
        ? (guardianPreferred ? "guardian" : "client")
        : guardianPreferred
          ? "guardian"
          : "client";

  return clientDeliveryContactsForRole(client, role);
}

export function clientDeliveryContactsForRole(
  client: ClientContactFields,
  role: ClientDeliveryRole,
): {
  role: ClientDeliveryRole;
  phone: ClientDeliveryContact | null;
  email: ClientDeliveryContact | null;
} {
  return role === "guardian"
    ? {
        role,
        phone: contact(client.guardianPhone, role),
        email: contact(client.guardianEmail, role),
      }
    : {
        role,
        phone: contact(client.phone, role),
        email: contact(client.email, role),
      };
}
