import { createHash } from "node:crypto";
import { normalizeDateInput } from "./normalizeDateInput";

export interface EligibilityIdentity {
  fullName: string;
  dob: string;
  midNumber?: string | null;
}

/** Bind a saved inquiry to its subject without duplicating identity fields. */
export function eligibilityIdentityFingerprint(subject: EligibilityIdentity): string {
  return createHash("sha256").update(JSON.stringify([
    subject.fullName.trim().replace(/\s+/g, " ").toLowerCase(),
    normalizeDateInput(subject.dob) || subject.dob.trim(),
    (subject.midNumber || "").replace(/\s+/g, "").toUpperCase(),
  ])).digest("hex");
}
