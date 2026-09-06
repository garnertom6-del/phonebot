/**
 * Shared coverage-state snapshot for the NC Tracks direct-eligibility feature.
 * The snapshot is stored as plain intake answers (non-packet keys, so it never
 * prints on the PDF) so the coverage badge survives page reloads without a
 * schema change. One definition used by the API route, the UI, and tests.
 */
import type { Edi271Result } from "./edi271";

export type CoverageStatus = "active" | "inactive" | "needs_review" | "not_checked";

export interface CoverageSnapshot {
  status: CoverageStatus;
  planName?: string;
  memberId?: string;
  effectiveDate?: string;
  rejectReason?: string;
  checkedAt?: string;   // ISO
  identityFingerprint?: string;
  source: "nctracks_edi";
}

// answer keys that hold the snapshot (never in the packet map -> never printed)
export const ELIGIBILITY_KEYS = {
  status: "eligibility_status",
  plan: "eligibility_plan",
  memberId: "eligibility_member_id",
  effectiveDate: "eligibility_effective_date",
  reject: "eligibility_reject",
  checkedAt: "eligibility_checked_at",
  identityFingerprint: "eligibility_subject_fingerprint",
} as const;

/** Turn a parsed 271 into the coverage snapshot the UI shows. */
export function snapshotFrom271(r: Edi271Result, now: Date): CoverageSnapshot {
  const status: CoverageStatus = r.rejectReason
    ? "needs_review"
    : r.active
      ? "active"
      : "inactive";
  return {
    status,
    planName: r.planName,
    memberId: r.memberId,
    effectiveDate: r.effectiveDate,
    rejectReason: r.rejectReason,
    checkedAt: now.toISOString(),
    source: "nctracks_edi",
  };
}

/** Persist the snapshot into the answer map (returns keys touched). */
export function snapshotToAnswers(s: CoverageSnapshot): Record<string, string> {
  return {
    [ELIGIBILITY_KEYS.status]: s.status,
    [ELIGIBILITY_KEYS.plan]: s.planName || "",
    [ELIGIBILITY_KEYS.memberId]: s.memberId || "",
    [ELIGIBILITY_KEYS.effectiveDate]: s.effectiveDate || "",
    [ELIGIBILITY_KEYS.reject]: s.rejectReason || "",
    [ELIGIBILITY_KEYS.checkedAt]: s.checkedAt || "",
    [ELIGIBILITY_KEYS.identityFingerprint]: s.identityFingerprint || "",
  };
}

/** Read a snapshot back out of an answer map (for the UI / status endpoint). */
export function snapshotFromAnswers(a: Record<string, unknown>, currentIdentityFingerprint?: string): CoverageSnapshot {
  const raw = String(a[ELIGIBILITY_KEYS.status] || "").trim();
  const status: CoverageStatus =
    raw === "active" || raw === "inactive" || raw === "needs_review" ? raw : "not_checked";
  const savedFingerprint = str(a[ELIGIBILITY_KEYS.identityFingerprint]);
  const identityChanged = status !== "not_checked" && currentIdentityFingerprint !== undefined
    && savedFingerprint !== currentIdentityFingerprint;
  return {
    status: identityChanged ? "needs_review" : status,
    planName: str(a[ELIGIBILITY_KEYS.plan]),
    memberId: str(a[ELIGIBILITY_KEYS.memberId]),
    effectiveDate: str(a[ELIGIBILITY_KEYS.effectiveDate]),
    rejectReason: identityChanged
      ? savedFingerprint
        ? "The client's name, date of birth or MID changed after this check. Re-check coverage for the current details."
        : "This saved result is not linked to the current client details. Re-check coverage."
      : str(a[ELIGIBILITY_KEYS.reject]),
    checkedAt: str(a[ELIGIBILITY_KEYS.checkedAt]),
    identityFingerprint: savedFingerprint,
    source: "nctracks_edi",
  };
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

/** Plain-language one-liner for a snapshot (shared by API + UI + audit). */
export function coverageMessage(s: CoverageSnapshot): string {
  switch (s.status) {
    case "active":
      return `Coverage active${s.planName ? ` — ${s.planName}` : ""}${s.effectiveDate ? ` (since ${s.effectiveDate})` : ""}.`;
    case "inactive":
      return "No active NC Medicaid coverage found — verify by hand.";
    case "needs_review":
      return s.rejectReason
        ? `Needs review — ${s.rejectReason}`
        : "Needs review — NC Tracks could not confirm coverage.";
    default:
      return "Not checked yet.";
  }
}
