import { questionByKey } from "@/config/mooreDivineQuestions";

const EXTRA_LABELS: Record<string, string> = {
  cca: "Clinician CCA",
  signature: "Client / guardian signature",
  signature_staff_qp: "Staff / QP signature",
  signature_witness: "Witness signature",
  signature_medical_director: "Medical Director signature",
  survey_q3: "The staff explained orientation, my rights, and how to ask questions",
  client_phone_cell: "Cell phone",
  client_phone_home: "Home phone",
  ec1_cell_phone: "Emergency contact cell phone",
  ec1_home_phone: "Emergency contact home phone",
  provider_choice_plan: "Insurance type / plan",
  services_requested: "Services requested",
  diagnosis_list: "Current diagnosis",
  sa_primary_diagnosis: "Primary diagnosis",
  sa_secondary_diagnosis: "Secondary diagnosis",
  c_axis1: "Axis I (on file)",
};

/** True when a string is a raw packet/database key rather than a staff-facing label. */
export function looksLikeFieldKey(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.includes(" ")) return false;
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(trimmed);
}

function titleFromKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (/^q\d+$/i.test(part)) return `question ${part.slice(1)}`;
      if (/^ec\d+$/i.test(part)) return `Emergency contact ${part.slice(2)}`;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/** Staff- and client-facing label for a packet field. Never returns snake_case. */
export function humanFieldLabel(key: string, providedLabel?: string | null): string {
  const provided = (providedLabel || "").trim();
  if (provided && !looksLikeFieldKey(provided)) return provided;
  const question = questionByKey(key);
  if (question?.label && !looksLikeFieldKey(question.label)) return question.label;
  const extra = EXTRA_LABELS[key];
  if (extra) return extra;
  return titleFromKey(key);
}

export function displayClientName(name?: string | null): string {
  const trimmed = String(name || "").trim();
  if (!trimmed || /^\[?missing\]?$/i.test(trimmed) || trimmed === "-") {
    return "No name on file";
  }
  return trimmed;
}

export function displayRecordNumber(value?: string | null): string {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^\[?missing\]?$/i.test(trimmed) || trimmed === "-") {
    return "No record #";
  }
  return trimmed;
}
