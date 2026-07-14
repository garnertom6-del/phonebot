/**
 * Parses an X12 271 eligibility RESPONSE (005010X279A1) from NC Tracks into a
 * simple result the app can act on. Robust to the common shapes; exact plan
 * naming can be refined against real 271s once the connection is live.
 */

export interface Edi271Result {
  active: boolean;            // any active health-benefit coverage found
  planName?: string;          // plan / MCO / product description (EB05)
  memberId?: string;          // member ID echoed by the payer (NM1*IL)
  effectiveDate?: string;     // MM/DD/YYYY plan-begin, if present
  rejectReason?: string;      // AAA reject description, if the inquiry failed
  raw: string;                // the original 271 (for audit/debugging)
}

// EB01 eligibility/benefit codes we care about
const ACTIVE = new Set(["1"]); // Active Coverage
const INACTIVE = new Set(["6", "7", "8"]); // Inactive / Inactive-Pending / etc.

// A few common AAA reject reason codes -> plain text
const AAA_REASON: Record<string, string> = {
  "42": "Unable to respond at this time - try again later.",
  "43": "Invalid or missing provider identification.",
  "72": "Invalid or missing subscriber/insured ID.",
  "73": "Invalid or missing subscriber/insured name.",
  "74": "Invalid or missing subscriber/insured birth date.",
  "75": "Subscriber/insured not found.",
  "76": "Duplicate subscriber/insured ID number.",
};

function d8ToUs(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v || "").trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

export function parseEdi271(payload: string): Edi271Result {
  const raw = payload || "";
  // segments end in ~ (tolerate CRLF); elements split on *
  const segments = raw
    .replace(/\r?\n/g, "")
    .split("~")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("*"));

  const result: Edi271Result = { active: false, raw };

  let inSubscriberLoop = false;
  for (const el of segments) {
    const tag = el[0];

    if (tag === "NM1" && el[1] === "IL") {
      inSubscriberLoop = true;
      // member id is element 9 when the id qualifier (el 8) is MI/etc.
      if (el[8] && el[9]) result.memberId = el[9];
      continue;
    }
    if (tag === "HL") inSubscriberLoop = false; // a new loop started

    if (tag === "AAA") {
      // AAA*Y**<reason>*<followup>  (reject) - only record real rejects
      const reason = el[3];
      if (reason && AAA_REASON[reason]) {
        result.rejectReason = AAA_REASON[reason];
      } else if (reason) {
        result.rejectReason = `Payer could not process the request (code ${reason}).`;
      }
      continue;
    }

    if (tag === "EB") {
      const code = el[1];
      if (ACTIVE.has(code)) {
        result.active = true;
        // EB05 = plan coverage description (product/MCO name)
        if (el[5] && !result.planName) result.planName = el[5];
      } else if (INACTIVE.has(code) && !result.active) {
        // leave active=false; note the plan if named
        if (el[5] && !result.planName) result.planName = el[5];
      }
      continue;
    }

    if (tag === "DTP" && inSubscriberLoop) {
      // 346 = plan begin, 356 = eligibility begin
      if ((el[1] === "346" || el[1] === "356") && el[3] && !result.effectiveDate) {
        result.effectiveDate = d8ToUs(el[3].split("-")[0]);
      }
      continue;
    }
  }

  return result;
}
