export const CONTACT_REQUIRED_MESSAGE =
  "Enter a phone number or email so the client can receive the intake link.";
export const INVALID_PHONE_MESSAGE =
  "Enter a valid phone number with at least 10 digits. Cell is used for the secure-link text.";
export const INVALID_CONTACT_MESSAGE =
  "Enter a valid phone number or email. Cell is used for SMS; values like a fake email cannot be used as the text destination.";

const PHONE_CHARS = /^[+\d\s().-]+$/;

export function contactDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@@") || /\s/.test(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(trimmed);
}

export function isPlausiblePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("@")) return false;
  if (!PHONE_CHARS.test(trimmed)) return false;
  const digits = contactDigits(trimmed);
  if (digits.length === 11 && digits.startsWith("1")) return true;
  return digits.length >= 10 && digits.length <= 15;
}

export function classifyContact(value: string): "empty" | "phone" | "email" | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (isPlausiblePhone(trimmed)) return "phone";
  if (isPlausibleEmail(trimmed)) return "email";
  return "invalid";
}

export function formatUsPhoneDisplay(value: string): string {
  const digits = contactDigits(value);
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return value.trim();
}

export type AssignedIntakeContacts = {
  email: string;
  phone: string;
  error?: string;
  field?: "email" | "phone" | "contact";
};

/**
 * Staff may type a cell number in either contact box. Phones are preferred for
 * SMS; a value is never treated as a phone unless it is actually a phone.
 */
export function assignIntakeContacts(emailField: string, phoneField: string): AssignedIntakeContacts {
  const emailKind = classifyContact(emailField);
  const phoneKind = classifyContact(phoneField);

  if (emailKind === "invalid") {
    return { email: "", phone: phoneKind === "phone" ? phoneField.trim() : "", error: INVALID_CONTACT_MESSAGE, field: "contact" };
  }
  if (phoneKind === "invalid") {
    return { email: emailKind === "email" ? emailField.trim() : "", phone: "", error: INVALID_PHONE_MESSAGE, field: "phone" };
  }

  let email = "";
  let phone = "";

  if (phoneKind === "phone") phone = phoneField.trim();
  else if (phoneKind === "email") email = phoneField.trim();

  if (emailKind === "email") {
    if (email && email.toLowerCase() !== emailField.trim().toLowerCase()) {
      return { email, phone, error: INVALID_CONTACT_MESSAGE, field: "contact" };
    }
    email = emailField.trim();
  } else if (emailKind === "phone" && !phone) {
    phone = emailField.trim();
  }

  if (!phone && !email) {
    return { email: "", phone: "", error: CONTACT_REQUIRED_MESSAGE, field: "contact" };
  }

  return { email, phone };
}
