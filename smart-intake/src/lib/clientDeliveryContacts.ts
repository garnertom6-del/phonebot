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
