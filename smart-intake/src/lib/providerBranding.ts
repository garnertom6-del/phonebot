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

export function providerPhone(phone?: string | null): string {
  const value = phone?.trim();
  return value || DEFAULT_PROVIDER_PHONE;
}

export function intakeProcessExplanation(name?: string | null): string {
  const provider = providerDisplayName(name);
  return `You are completing your intake for services with ${provider}. After this intake, a clinical assessor will follow up with you to complete an assessment. That assessment helps determine what type of services and support you will receive.`;
}

export function brandText(text: string | null | undefined, branding?: ProviderBranding): string {
  if (!text) return "";
  const displayName = providerDisplayName(branding?.name);
  const legalName = providerLegalName(branding?.name);
  const phone = providerPhone(branding?.phone);
  return text
    .replace(/Moore Divine Care, Inc\./g, legalName)
    .replace(/Moore Divine Care, Inc/g, legalName)
    .replace(/Moore Divine Care/g, displayName)
    .replace(/336-285-5204/g, phone);
}
