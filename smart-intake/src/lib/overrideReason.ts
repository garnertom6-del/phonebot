const PLACEHOLDER_REASONS = new Set([
  "test",
  "testing",
  "override",
  "n/a",
  "na",
  "none",
  "unknown",
  "skip",
  "continue",
]);

export function acceptableOverrideReason(value: string): boolean {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 12) return false;
  const normalized = reason.toLowerCase().replace(/[^a-z0-9/ ]/g, "").trim();
  if (PLACEHOLDER_REASONS.has(normalized)) return false;
  if (/^(.)\1+$/.test(normalized.replace(/\s/g, ""))) return false;
  if (!/[a-z]{3}/i.test(reason)) return false;
  return true;
}
