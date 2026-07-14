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
    throw new Error("NC Tracks EDI is not connected yet. Enroll as a Trading Partner (see README_NCTRACKS_EDI.md).");
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
    return { result, mapped: toMapped(result) };
  } finally {
    clearTimeout(timer);
  }
}
