import type { Answers } from "./fillPdf";

export interface NcTracksLookupPayload {
  intakeId: string;
  client: {
    fullName: string;
    dob: string;
    midNumber?: string | null;
    recordNumber?: string | null;
    phone?: string | null;
  };
  answers: Record<string, unknown>;
}

export interface NcTracksLookupResult {
  mid_number?: string;
  pcp_name?: string;
  pcp_phone?: string;
  pcp_address?: string;
  preferred_emergency_facility?: string;
  mco?: string;
  medicaid_effective_date?: string;
  has_medicaid?: string;
  has_nchc?: string;
  nchc_policy?: string;
}

export const NC_TRACKS_FIELD_LABELS: Record<keyof NcTracksLookupResult, string> = {
  mid_number: "MID #",
  pcp_name: "Primary care doctor",
  pcp_phone: "PCP phone",
  pcp_address: "PCP address / practice",
  preferred_emergency_facility: "Local hospital / ER",
  mco: "Medicaid plan (MCO)",
  medicaid_effective_date: "Medicaid effective date",
  has_medicaid: "Medicaid",
  has_nchc: "NC Health Choice",
  nchc_policy: "NC Health Choice policy",
};

const ALLOWED_KEYS = new Set<keyof NcTracksLookupResult>([
  "mid_number",
  "pcp_name",
  "pcp_phone",
  "pcp_address",
  "preferred_emergency_facility",
  "mco",
  "medicaid_effective_date",
  "has_medicaid",
  "has_nchc",
  "nchc_policy",
]);

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function ncTracksConfigured(): boolean {
  return !!process.env.NC_TRACKS_LOOKUP_URL;
}

export function applyNcTracksResult(answers: Answers, result: NcTracksLookupResult): { next: Answers; filled: string[] } {
  const next: Answers = { ...answers };
  const filled: string[] = [];
  for (const [key, value] of Object.entries(result) as Array<[keyof NcTracksLookupResult, unknown]>) {
    if (!ALLOWED_KEYS.has(key)) continue;
    const text = clean(value);
    if (!text) continue;
    next[key] = text;
    filled.push(key);
  }
  if (next.pcp_name && !next.c_practice) next.c_practice = next.pcp_name;
  return { next, filled };
}

export function describeNcTracksFields(
  answers: Record<string, unknown>,
  keys: string[],
): Array<{ key: string; label: string; value: string }> {
  return keys
    .filter((key): key is keyof NcTracksLookupResult => key in NC_TRACKS_FIELD_LABELS)
    .map((key) => ({
      key,
      label: NC_TRACKS_FIELD_LABELS[key],
      value: clean(answers[key]),
    }))
    .filter((item) => item.value);
}

export async function lookupNcTracks(payload: NcTracksLookupPayload): Promise<NcTracksLookupResult> {
  const url = process.env.NC_TRACKS_LOOKUP_URL;
  if (!url) throw new Error("NC Tracks automatic lookup is not connected yet.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.NC_TRACKS_LOOKUP_SECRET
          ? { Authorization: `Bearer ${process.env.NC_TRACKS_LOOKUP_SECRET}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(clean(body.error) || `NC Tracks lookup failed (${res.status})`);
    }
    return body as NcTracksLookupResult;
  } finally {
    clearTimeout(timer);
  }
}
