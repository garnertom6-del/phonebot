/**
 * Staff intake DETAIL page helpers. Keep identity, housing, MID/Record, and
 * the next action honest so staff are not told the packet is complete while
 * CCA or signatures are still missing, and never invent a city like Greensboro.
 */

export const GENERATED_RECORD_NUMBER_RE = /^[A-Z]{2,8}-\d{4,6}$/i;

export type StaffIntakeActionId =
  | "send_link"
  | "add_cca"
  | "review_signatures"
  | "generate_packet"
  | "send_records"
  | "review_answers";

export type StaffIntakeWorkflowStep = {
  id: string;
  label: string;
  done: boolean;
};

export function firstFilledText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (text) return text;
  }
  return "";
}

export function displayIntakeLocation(stored?: string | null): string {
  return (stored || "").trim();
}

export function providerDisplayName(
  providerName?: string | null,
  packageName?: string | null,
): string {
  const fromProvider = (providerName || "").trim();
  if (fromProvider) return fromProvider;
  const fromPackage = (packageName || "").replace(/\s*Client Intake Package\s*$/i, "").trim();
  if (fromPackage) return fromPackage;
  return "This provider";
}

export function packetPackageTitle(
  providerName?: string | null,
  packageName?: string | null,
): string {
  const pkg = (packageName || "").trim();
  if (pkg && !/^client intake package$/i.test(pkg)) return pkg;
  return `${providerDisplayName(providerName, packageName)} Client Intake Package`;
}

export function looksLikeGeneratedRecordNumber(value?: string | null): boolean {
  return GENERATED_RECORD_NUMBER_RE.test((value || "").trim());
}

export function detectMidRecordMixup(mid?: string | null, record?: string | null): {
  mixed: boolean;
  reason: string;
} {
  const midVal = (mid || "").trim();
  const recordVal = (record || "").trim();
  if (!midVal) return { mixed: false, reason: "" };
  if (looksLikeGeneratedRecordNumber(midVal) && !looksLikeGeneratedRecordNumber(recordVal)) {
    return {
      mixed: true,
      reason: `MID# looks like a generated Record# (${midVal}). Record# is ${recordVal || "blank"}. Swap them if the Record# generator was saved in the wrong box.`,
    };
  }
  return { mixed: false, reason: "" };
}

export function housingNeedsAttention(input: {
  addressStreet?: string | null;
  livingArrangement?: string | null;
}): boolean {
  const street = (input.addressStreet || "").trim();
  const living = (input.livingArrangement || "").trim().toLowerCase();
  return !street && living !== "homeless";
}

export function staffIntakeAnswerCompleteLabel(input: {
  missingRequiredCount: number;
  percentComplete: number;
  expectCca: boolean;
  hasCca: boolean;
  hasStaffSignature: boolean;
  hasGeneratedPdf: boolean;
}): string {
  if (input.missingRequiredCount > 0) {
    return `${input.percentComplete}% of answers filled`;
  }
  if (input.expectCca && !input.hasCca) {
    return "Required answers complete · CCA still needed";
  }
  if (!input.hasStaffSignature) {
    return "Required answers complete · Staff / QP signature still needed";
  }
  if (!input.hasGeneratedPdf) {
    return "Ready to generate packet";
  }
  return "Packet generated";
}

export function staffIntakeWorkflowSteps(input: {
  status: string;
  hasCca: boolean;
  expectCca: boolean;
  hasClientSignature: boolean;
  hasStaffSignature: boolean;
  hasGeneratedPdf: boolean;
  copiesSent: boolean;
}): StaffIntakeWorkflowStep[] {
  const clientFinished = ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(input.status);
  return [
    { id: "send_link", label: "Send link", done: input.status !== "NOT_STARTED" },
    { id: "client_answers", label: "Client answers", done: clientFinished },
    { id: "add_cca", label: "Add CCA", done: !input.expectCca || input.hasCca },
    { id: "staff_signature", label: "Staff / QP signature", done: input.hasStaffSignature },
    { id: "generate_packet", label: "Generate packet", done: input.hasGeneratedPdf },
    { id: "send_records", label: "Send records", done: input.copiesSent },
  ];
}

export function staffIntakePrimaryAction(input: {
  status: string;
  expectCca: boolean;
  hasCca: boolean;
  hasStaffSignature: boolean;
  hasGeneratedPdf: boolean;
  packetReady: boolean;
  copiesSent: boolean;
}): { id: StaffIntakeActionId; label: string; hint: string } {
  if (input.status === "NOT_STARTED") {
    return { id: "send_link", label: "Send the secure link", hint: "The client has not started yet." };
  }
  if (input.expectCca && !input.hasCca) {
    return { id: "add_cca", label: "Add CCA", hint: "Upload the clinician assessment to auto-fill the packet." };
  }
  if (!input.hasStaffSignature) {
    return {
      id: "review_signatures",
      label: "Add Staff / QP signature",
      hint: "Client signature is on file. Capture the qualified professional signature on Review.",
    };
  }
  if (input.packetReady && !input.hasGeneratedPdf) {
    return { id: "generate_packet", label: "Generate completed packet", hint: "Required answers and staff signature are in. Generate the PDF next." };
  }
  if (input.hasGeneratedPdf && !input.copiesSent && ["SIGNED", "COMPLETED"].includes(input.status)) {
    return { id: "send_records", label: "Send client copies", hint: "Packet is generated. Send the records link when review is done." };
  }
  return { id: "review_answers", label: "Review / edit answers", hint: "Open the full answer review." };
}

export const ASSIST_IDENTITY_KEYS = ["location", "intake_date", "mid_number", "record_number"] as const;
