export const DEFAULT_PROVIDER_NAME = "Moore Divine Care";
export const DEFAULT_PROVIDER_LEGAL_NAME = "Moore Divine Care, Inc.";
export const DEFAULT_PROVIDER_PHONE = "336-285-5204";

export interface ProviderBranding {
  name?: string | null;
  phone?: string | null;
}

export function providerDisplayName(name?: string | null): string {
  const value = name?.trim();
  return value || DEFAULT_PROVIDER_NAME;
}

export function providerLegalName(name?: string | null): string {
  const value = name?.trim();
  return value || DEFAULT_PROVIDER_LEGAL_NAME;
}

export function providerPhone(phone?: string | null, name?: string | null): string {
  const value = phone?.trim();
  if (value) return value;
  const provider = name?.trim().toLowerCase() || "";
  return provider.includes("moore divine") || !provider
    ? DEFAULT_PROVIDER_PHONE
    : "the number provided by your care team";
}

export function intakeProcessExplanation(name?: string | null): string {
  const provider = providerDisplayName(name);
  return `You are completing your intake for services with ${provider}. After this intake, a clinical assessor will follow up with you to complete an assessment. That assessment helps determine what type of services and support you will receive.`;
}

export function brandText(text: string | null | undefined, branding?: ProviderBranding): string {
  if (!text) return "";
  const displayName = providerDisplayName(branding?.name);
  const legalName = providerLegalName(branding?.name);
  const phone = providerPhone(branding?.phone, branding?.name);
  if (text.includes("Karen Jones") && text.includes("Tonya Jones")) {
    return `Welcome to ${displayName}. Our team will explain available services, office hours, how to reach us, and what happens after your clinical assessment. Questions? Call ${phone}.`;
  }
  return text
    .replace(/Moore Divine Care, Inc\./g, legalName)
    .replace(/Moore Divine Care, Inc/g, legalName)
    .replace(/Moore Divine Care/g, displayName)
    .replace(/336-285-5204/g, phone);
}
