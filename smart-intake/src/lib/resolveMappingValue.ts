/**
 * Shared mapping-source resolver used by PDF fill and the mapper test-fill
 * overlay. Radio / yes-no checkboxes must match `key=Value` (or `key~Value`
 * for multi-select). A truthy answer on the bare key must not paint every box
 * that shares that key.
 */
export type Answers = Record<string, unknown>;

const FREQ_CODES: Record<string, string> = {
  "Not used past month": "0", "1-3x past month": "1", "1-2x per week": "2",
  "3-6x per week": "3", "Daily": "4",
};
const ROUTE_CODES: Record<string, string> = {
  Oral: "1", Smoking: "2", Inhalation: "3", Injection: "4", Other: "5",
};

const YES_TOKENS = new Set(["yes", "y", "true"]);
const NO_TOKENS = new Set(["no", "n", "false"]);

export function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "";
  return String(v);
}

export function formatDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

function splitOnce(source: string, sep: "=" | "~"): [string, string] | null {
  const index = source.indexOf(sep);
  if (index <= 0) return null;
  return [source.slice(0, index), source.slice(index + 1)];
}

function optionMatches(actual: unknown, expected: string): boolean {
  if (expected === "true") {
    return actual === true || actual === "true" || actual === "Yes" || actual === "yes";
  }
  if (actual === true && YES_TOKENS.has(expected.trim().toLowerCase())) return true;
  const a = str(actual).trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  if (!a || !e) return false;
  if (a === e) return true;
  if (YES_TOKENS.has(a) && YES_TOKENS.has(e)) return true;
  if (NO_TOKENS.has(a) && NO_TOKENS.has(e)) return true;
  return false;
}

/** Resolve a mapping's `source` expression against the answers. */
export function resolveValue(source: string, answers: Answers): { text?: string; checked?: boolean } {
  const eq = splitOnce(source, "=");
  if (eq) {
    const [key, expected] = eq;
    return { checked: optionMatches(answers[key], expected) };
  }
  const tilde = splitOnce(source, "~");
  if (tilde) {
    const [key, expected] = tilde;
    const v = answers[key];
    return { checked: Array.isArray(v) ? v.includes(expected) : str(v).includes(expected) };
  }
  let v = str(answers[source]);
  if (/^sub\d_freq$/.test(source) && FREQ_CODES[v]) v = `${FREQ_CODES[v]} (${v})`;
  if (/^sub\d_route$/.test(source) && ROUTE_CODES[v]) v = `${ROUTE_CODES[v]} (${v})`;
  if (
    source === "dob" ||
    /_date$/.test(source) ||
    /(^|_)date_(sent|adjudicated)$/.test(source) ||
    source === "intervention_valid_until"
  ) v = formatDate(v);
  const raw = answers[source];
  // Bare consent keys still check when the consent is true. Do not treat "Yes"
  // as checked: that would mark every yes/no box sharing the same source.
  const checked = raw === true || raw === "true";
  return { text: v, checked };
}
