export type ClientDeliveryRole = "client" | "guardian";

export type ClientDeliveryContact = {
  value: string;
  role: ClientDeliveryRole;
};

type ClientContactFields = {
  phone?: string | null;
  email?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
};

function contact(value: string | null | undefined, role: ClientDeliveryRole): ClientDeliveryContact | null {
  const trimmed = value?.trim();
  return trimmed ? { value: trimmed, role } : null;
}

export function clientDeliveryContacts(client: ClientContactFields): {
  phone: ClientDeliveryContact | null;
  email: ClientDeliveryContact | null;
} {
  return {
    phone: contact(client.phone, "client") || contact(client.guardianPhone, "guardian"),
    email: contact(client.email, "client") || contact(client.guardianEmail, "guardian"),
  };
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
  const guardianPreferred = answers.is_minor_or_incompetent === true
    || answers.is_minor_or_incompetent === "Yes";
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
