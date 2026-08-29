import { isPlausiblePhone } from "@/lib/intakeContacts";
import { parseHelperNotes } from "@/lib/parseIntakeNotes";
import { humanFieldLabel } from "@/lib/fieldLabels";
import type { Answers } from "@/lib/fillPdf";

export type ClientIdentity = {
  fullName: string;
  dob: string;
  midNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  guardianName?: string | null;
};

export type IntegritySignature = {
  role: string;
  printedName: string;
  relationship?: string | null;
  contentRevision?: number | null;
  subjectNameSnapshot?: string | null;
  subjectDobSnapshot?: string | null;
  invalidatedAt?: Date | string | null;
  invalidatedReason?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type SignatureIntegrity = {
  valid: boolean;
  reason: string;
};

export type RecordConflict = {
  key: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
  fieldKeys: string[];
};

const LEGACY_EDIT_TOLERANCE_MS = 5 * 60 * 1000;

export function normalizeIdentityName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

function normalizeDate(value: unknown): string {
  const raw = String(value || "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) return `${iso[1]}${iso[2].padStart(2, "0")}${iso[3].padStart(2, "0")}`;
  const us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}${us[1].padStart(2, "0")}${us[2].padStart(2, "0")}`;
  return raw.replace(/\D/g, "");
}

function normalizeLoose(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizePhone(value: unknown): string {
  return String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function time(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function signatureIntegrity(
  signature: IntegritySignature,
  client: ClientIdentity,
  currentContentRevision: number,
  latestMaterialUpdatedAt?: Date | string | null,
): SignatureIntegrity {
  if (signature.invalidatedAt) {
    return { valid: false, reason: signature.invalidatedReason || "The intake changed after this signature was captured." };
  }
  if (signature.contentRevision != null && signature.contentRevision !== currentContentRevision) {
    return { valid: false, reason: `Signed revision ${signature.contentRevision}; current revision is ${currentContentRevision}.` };
  }
  if (signature.contentRevision == null) {
    const changedAt = time(latestMaterialUpdatedAt);
    // Existing rows gain updatedAt during migration, so createdAt is the only
    // trustworthy capture time for a legacy unversioned signature.
    const signedAt = time(signature.createdAt) ?? time(signature.updatedAt);
    if (changedAt != null && signedAt != null && changedAt - signedAt > LEGACY_EDIT_TOLERANCE_MS) {
      return { valid: false, reason: "Answers changed after this legacy signature was captured." };
    }
  }

  const expectedName = signature.role === "client"
    ? client.fullName
    : signature.role === "guardian"
      ? client.guardianName || signature.subjectNameSnapshot || ""
      : "";
  if (expectedName && normalizeIdentityName(signature.printedName) !== normalizeIdentityName(expectedName)) {
    return { valid: false, reason: `Signer identity does not match the current ${signature.role === "client" ? "client" : "guardian"} record.` };
  }
  if (signature.role === "client" && signature.relationship && signature.relationship !== "client") {
    return { valid: false, reason: "A client signature is labeled with a non-client relationship." };
  }
  if (signature.role === "guardian" && signature.relationship === "client") {
    return { valid: false, reason: "A guardian signature cannot use the client relationship." };
  }
  if (
    signature.subjectNameSnapshot
    && expectedName
    && normalizeIdentityName(signature.subjectNameSnapshot) !== normalizeIdentityName(expectedName)
  ) {
    return { valid: false, reason: "The identity record changed after this signature was captured." };
  }
  if (signature.subjectDobSnapshot && normalizeDate(signature.subjectDobSnapshot) !== normalizeDate(client.dob)) {
    return { valid: false, reason: "The client DOB changed after this signature was captured." };
  }
  return { valid: true, reason: "" };
}

function addConflict(
  conflicts: RecordConflict[],
  key: string,
  severity: RecordConflict["severity"],
  title: string,
  detail: string,
  fieldKeys: string[],
) {
  if (!conflicts.some((conflict) => conflict.key === key)) {
    conflicts.push({ key, severity, title, detail, fieldKeys });
  }
}

/** Cross-screen and record-vs-answer checks used by both the API gate and dashboard. */
export function buildRecordConflicts(answers: Answers, client: ClientIdentity): RecordConflict[] {
  const conflicts: RecordConflict[] = [];
  const compare = (
    key: string,
    recordValue: unknown,
    answerValue: unknown,
    normalizer: (value: unknown) => string,
    title: string,
    severity: RecordConflict["severity"] = "error",
  ) => {
    if (!recordValue || !answerValue || normalizer(recordValue) === normalizer(answerValue)) return;
    addConflict(conflicts, key, severity, title, "The client record and packet answer disagree. Choose and save one verified value before continuing.", [key]);
  };

  compare("client_full_name", client.fullName, answers.client_full_name, normalizeIdentityName, "Client names conflict");
  compare("dob", client.dob, answers.dob, normalizeDate, "Dates of birth conflict");
  compare("mid_number", client.midNumber, answers.mid_number, normalizeLoose, "Medicaid IDs conflict");
  compare("client_email", client.email, answers.client_email, normalizeLoose, "Client emails conflict", "warning");
  compare("client_phone_cell", client.phone, answers.client_phone_cell || answers.client_phone_home, normalizePhone, "Client phone numbers conflict", "warning");
  compare("guardian_name", client.guardianName, answers.guardian_name, normalizeIdentityName, "Guardian names conflict");

  const emergencyName = String(answers.ec1_name || "").trim();
  if (emergencyName && isPlausiblePhone(emergencyName)) {
    addConflict(
      conflicts,
      "emergency_name_is_phone",
      "error",
      "Emergency-contact name contains a phone number",
      "Move the number to an emergency-phone field and enter the verified contact name.",
      ["ec1_name", "ec1_cell_phone"],
    );
  }
  if (emergencyName && !String(answers.ec1_cell_phone || answers.ec1_home_phone || answers.ec1_work_phone || "").trim()) {
    addConflict(conflicts, "emergency_phone_missing", "warning", "Emergency contact has no phone", "Add at least one verified emergency-contact phone number or document why it is unavailable.", ["ec1_name", "ec1_cell_phone"]);
  }

  const noteText = typeof answers.staff_helper_notes === "string" ? answers.staff_helper_notes : "";
  if (noteText) {
    const parsed = parseHelperNotes(noteText);
    for (const key of ["employment_status", "pcp_name", "pcp_phone", "provider_choice_plan", "ec1_name", "ec1_cell_phone"] as const) {
      const noteValue = parsed[key];
      const savedValue = answers[key];
      if (!noteValue || !savedValue || normalizeLoose(noteValue) === normalizeLoose(savedValue)) continue;
      addConflict(
        conflicts,
        `helper_${key}_conflict`,
        "warning",
        `${humanFieldLabel(key)} conflicts with Quick Notes`,
        "Quick Notes and the saved answer disagree. Confirm the source and keep one verified value.",
        [key, "staff_helper_notes"],
      );
    }
  }

  if (answers.has_medicaid === "Yes" && !String(answers.mid_number || client.midNumber || "").trim()) {
    addConflict(conflicts, "medicaid_id_missing", "error", "Medicaid is marked Yes but MID is blank", "Add the verified MID or correct the coverage answer.", ["has_medicaid", "mid_number"]);
  }
  if (answers.has_current_therapist === "Yes" && !String(answers.therapist_name || "").trim()) {
    addConflict(conflicts, "therapist_name_missing", "warning", "Current therapist is marked Yes but the therapist is blank", "Add the verified therapist or correct the yes/no answer.", ["has_current_therapist", "therapist_name"]);
  }
  if (answers.has_current_diagnosis === "Yes" && !String(answers.diagnosis_list || "").trim()) {
    addConflict(conflicts, "diagnosis_detail_missing", "warning", "Current diagnosis is marked Yes but details are blank", "Add only the verified diagnosis source or correct the yes/no answer.", ["has_current_diagnosis", "diagnosis_list"]);
  }
  return conflicts;
}

export function buildPlanCompleteness(answers: Answers) {
  const pcpKeys = ["pcp_name", "pcp_phone", "pcp_address", "preferred_emergency_facility", "dis_pcp_plan"];
  const crisisKeys = ["crisis_warning_signs", "crisis_steps", "crisis_supports", "dis_crisis_contact", "dis_crisis_phone"];
  const summary = (keys: string[]) => {
    const missing = keys.filter((key) => !String(answers[key] ?? "").trim());
    return { total: keys.length, completed: keys.length - missing.length, missing, state: missing.length === keys.length ? "not_started" : missing.length ? "incomplete" : "complete" } as const;
  };
  return { pcp: summary(pcpKeys), crisis: summary(crisisKeys) };
}
