/**
 * Dates arrive from many places - the CCA reader, pasted notes, staff typing -
 * in shapes such as 10.21.2026, 10/21/26, 2026-10-21, "Oct 21, 2026" or
 * "21 October 2026". Date boxes in the app are <input type="date">, which only
 * shows a value written as YYYY-MM-DD; anything else looks blank on screen
 * while still printing raw on the packet. These helpers turn every known
 * shape into YYYY-MM-DD and treat words such as "none" or "verify" as empty.
 */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const NOT_A_DATE = new Set([
  "none", "n/a", "na", "unknown", "unk", "pending", "verify", "tbd", "not stated",
  "not documented", "not provided", "not listed", "not applicable", "blank", "null", "-", "--",
]);

function validDate(year: number, month: number, day: number): string {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fullYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  // two-digit years: 00-29 -> 2000s, 30-99 -> 1900s (client DOBs are often 19xx)
  return n <= 29 ? 2000 + n : 1900 + n;
}

/** Returns YYYY-MM-DD for any recognizable date, otherwise "". */
export function normalizeDateInput(value: unknown): string {
  // "10/21/2026." and "10/21/2026 (verify)" still hold a usable date; the
  // sentence period and the note are dropped before matching
  const text = String(value ?? "").trim().replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[.]+$/, "")
    .trim();
  if (!text) return "";
  if (NOT_A_DATE.has(text.toLowerCase())) return "";

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(text);
  if (m) return validDate(fullYear(m[3]), Number(m[1]), Number(m[2]));

  m = /^(\d{2})(\d{2})(\d{4})$/.exec(text); // 10212026 (exactly MMDDYYYY; shorter forms are ambiguous)
  if (m) return validDate(Number(m[3]), Number(m[1]), Number(m[2]));

  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(text); // Oct 21, 2026
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));

  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,? (\d{4})$/i.exec(text); // 21 October 2026
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));

  return "";
}

/** True when the text is a date word-form the app should not keep ("none", "verify"). */
export function isDatePlaceholder(value: unknown): boolean {
  const lower = String(value ?? "").trim().toLowerCase().replace(/[.]+$/, "");
  return !!lower && NOT_A_DATE.has(lower);
}

/** MM/DD/YYYY for people-facing text; the input is anything normalizeDateInput accepts. */
export function formatDateForPeople(value: unknown): string {
  const iso = normalizeDateInput(value);
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
