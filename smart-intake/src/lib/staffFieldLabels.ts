import { questionByKey } from "@/config/mooreDivineQuestions";

/** Prefer these over catalog labels when staff copy should stay short or distinct. */
const LABEL_OVERRIDES: Record<string, string> = {
  signature: "Client or guardian signature",
  cca: "CCA upload",
  pcp_plan_client_name: "PCP plan client name",
};

const RAW_KEY = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** Staff-facing label for a catalog key. Never returns a raw snake_case key. */
export function staffFacingFieldLabel(key: string): string {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  const catalog = questionByKey(key)?.label?.trim();
  if (catalog) return catalog;
  const words = key.replaceAll("_", " ").trim();
  return words.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()) || "This field";
}

export function textContainsRawFieldKey(text: string): boolean {
  return /(?:^|[^a-z0-9])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:[^a-z0-9]|$)/.test(text);
}

/** Replace snake_case field keys in staff-facing copy with labels. */
export function replaceRawFieldKeys(text: string): string {
  if (!text) return text;
  return text.replace(RAW_KEY, (key) => staffFacingFieldLabel(key));
}
