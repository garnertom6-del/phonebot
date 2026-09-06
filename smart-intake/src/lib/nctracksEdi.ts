/**
 * NC Tracks direct eligibility via the Trading Partner / EDI channel.
 *
 * Sends an X12 270 to the configured NC Tracks real-time endpoint and parses
 * the 271 into a result the app already knows how to apply (reuses
 * applyNcTracksResult from ncTracksLookup.ts). Dormant until the NCTRACKS_EDI_*
 * credentials are set - see README_NCTRACKS_EDI.md.
 *
 * No portal login, no password storage, no 2FA. This is NC Tracks' own
 * machine-to-machine door.
 */
import { buildEdi270, type Edi270Config, type Edi270Member } from "./edi270";
import { parseEdi271, type Edi271Result } from "./edi271";
import type { NcTracksLookupResult } from "./ncTracksLookup";
import { normalizeDateInput } from "./normalizeDateInput";

export function nctracksEdiConfigured(): boolean {
  return !!(process.env.NCTRACKS_EDI_URL && process.env.NCTRACKS_SUBMITTER_ID &&
    process.env.NCTRACKS_PROVIDER_NPI);
}

function config(): Edi270Config {
  return {
    submitterId: process.env.NCTRACKS_SUBMITTER_ID as string,
    receiverId: process.env.NCTRACKS_RECEIVER_ID || "NCTRACKS",
    providerNpi: process.env.NCTRACKS_PROVIDER_NPI as string,
    providerName: process.env.NCTRACKS_PROVIDER_NAME || "PROVIDER",
    interchangeSenderQualifier: process.env.NCTRACKS_ISA_SENDER_QUALIFIER,
    interchangeReceiverQualifier: process.env.NCTRACKS_ISA_RECEIVER_QUALIFIER,
  };
}

export interface EligibilityCheck {
  result: Edi271Result;
  mapped: NcTracksLookupResult;
}

/** Split a full name into last/first for the 270 subscriber loop. */
function splitName(full: string): { lastName: string; firstName?: string } {
  const parts = (full || "").trim().split(/\s+/);
  if (parts.length <= 1) return { lastName: parts[0] || "" };
  return { lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(" ") };
}

function toMapped(r: Edi271Result): NcTracksLookupResult {
  const mapped: NcTracksLookupResult = {};
  // An unsuccessful inquiry is not evidence that the client has no Medicaid.
  // Keep existing packet answers intact while the snapshot requests review.
  if (r.rejectReason) return mapped;
  mapped.has_medicaid = r.active ? "Yes" : "No";
  if (r.memberId) mapped.mid_number = r.memberId;
  if (r.planName) mapped.mco = r.planName;
  if (r.effectiveDate) mapped.medicaid_effective_date = r.effectiveDate;
  return mapped;
}

export interface CheckInput {
  fullName: string;
  dob?: string;
  gender?: string;
  medicaidId?: string;
  controlNumber: number;
  traceNumber: string;
  now: Date;
}

export async function checkNcTracksEligibility(input: CheckInput): Promise<EligibilityCheck> {
  if (!nctracksEdiConfigured()) {
    throw new Error("NC Tracks EDI is not connected yet. Enroll as a Trading Partner, or enter coverage by hand.");
  }
  const { lastName, firstName } = splitName(input.fullName);
  const member: Edi270Member = {
    lastName, firstName, dob: input.dob, gender: input.gender, medicaidId: input.medicaidId,
  };
  const x12 = buildEdi270(member, config(), {
    controlNumber: input.controlNumber, traceNumber: input.traceNumber, now: input.now,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(process.env.NCTRACKS_EDI_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/edi-x12",
        ...(process.env.NCTRACKS_EDI_SECRET ? { Authorization: `Bearer ${process.env.NCTRACKS_EDI_SECRET}` } : {}),
      },
      body: x12,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`NC Tracks EDI returned ${res.status}`);
    const result = parseEdi271(text);
    const rejected = (rejectReason: string): EligibilityCheck => ({ result: { active: false, raw: "", rejectReason }, mapped: {} });
    if (!result.rejectReason) {
      const requestedMid = (input.medicaidId || "").replace(/\s+/g, "").toUpperCase();
      const returnedMid = (result.memberId || "").replace(/\s+/g, "").toUpperCase();
      const requestedDob = normalizeDateInput(input.dob);
      if (requestedMid && requestedMid !== returnedMid) {
        return rejected("The returned MID does not match the requested client. Verify the client details and check again.");
      }
      if (result.subscriberDob && (!requestedDob || result.subscriberDob !== requestedDob)) {
        return rejected("The returned date of birth does not match the requested client. Verify the client details and check again.");
      }
      if (!requestedMid) {
        const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toUpperCase();
        const requestedName = normalizeName(input.fullName);
        const echoedName = normalizeName(result.subscriberFullName || "");
        if (!requestedName || !result.subscriberFirstName || !result.subscriberLastName || echoedName !== requestedName
          || !requestedDob || !result.subscriberDob || result.subscriberDob !== requestedDob) {
          return rejected("The returned subscriber name and date of birth could not be matched to this client. Verify the client details and check again.");
        }
      }
    }
    return { result, mapped: toMapped(result) };
  } finally {
    clearTimeout(timer);
  }
}
