import type { Answers } from "./fillPdf";

const MISSING_TEXT = "None reported by client";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v).trim();
}

function isBlank(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

function setDefault(a: Answers, key: string, value: unknown) {
  if (!isBlank(value) && isBlank(a[key])) a[key] = value;
}

function parseDateParts(v: string): { y: number; m: number; d: number } | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
  return null;
}

function addOneYear(v: string): string {
  const parts = parseDateParts(v);
  if (!parts) return "";
  const dt = new Date(parts.y + 1, parts.m - 1, parts.d);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function diagnosisList(a: Answers): string[] {
  const raw = [
    s(a.sa_primary_diagnosis),
    s(a.sa_secondary_diagnosis),
    s(a.current_diagnosis_known),
    s(a.diagnosis_list),
  ].filter(Boolean).join("; ");
  const seen = new Set<string>();
  return raw
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x) && seen.add(x))
    .slice(0, 5);
}

function applyDiagnosisDefaults(a: Answers) {
  const dx = diagnosisList(a);
  if (!dx.length) return;
  setDefault(a, "sa_primary_diagnosis", dx[0]);
  setDefault(a, "sa_secondary_diagnosis", dx[1]);
  setDefault(a, "c_axis1", dx[0]);
  setDefault(a, "c_axis2", dx[1] || MISSING_TEXT);
  setDefault(a, "c_axis3", s(a.medical_diagnoses) || MISSING_TEXT);
  setDefault(a, "c_axis4", s(a.social_family_medical_history) || s(a.presenting_problem) || MISSING_TEXT);
  setDefault(a, "c_axis5", MISSING_TEXT);
  for (let i = 1; i <= 5; i++) setDefault(a, `dis_adm_axis${i}`, dx[i - 1] || (i > 2 ? MISSING_TEXT : ""));
}

function applyDischargeDefaults(a: Answers) {
  setDefault(a, "dis_programs", s(a.services_requested) || s(a.referred_for));
  setDefault(a, "dis_summary", s(a.presenting_problem) || s(a.mh_history));
  setDefault(a, "dis_pcp_plan", s(a.needs) || s(a.treatments));
  setDefault(a, "dis_strengths", s(a.strengths));
  setDefault(a, "dis_needs", s(a.needs));
  setDefault(a, "dis_abilities", s(a.abilities));
  setDefault(a, "dis_preferences", s(a.preferences));
  setDefault(a, "dis_medications", [s(a.medications), s(a.otc_medications)].filter(Boolean).join("; "));
  setDefault(a, "dis_residence_type", "Private Home");
  setDefault(a, "dis_residence_detail", s(a.living_arrangement) || s(a.lives_with_whom));
  setDefault(a, "dis_reason", "Discharge summary prepared for future transition/discharge planning.");
  setDefault(a, "dis_continuing_care", s(a.needs) || "Continue clinically recommended services.");
  setDefault(a, "dis_comments", s(a.preferences) || s(a.presenting_problem));
  setDefault(a, "dis_crisis_contact", "911 or Moore Divine Care crisis line");
  setDefault(a, "dis_crisis_phone", "911 / 336-285-5204");
  setDefault(a, "dis_prepared_by", s(a.clinician_name) || s(a.staff_receiving_intake) || s(a.qp_referred_to));
}

function applyNoneReportedPdfFallbacks(a: Answers) {
  [
    "medical_diagnoses", "treatments", "hospitalizations", "medical_alerts",
    "drug_allergies", "environmental_allergies", "allergies",
    "mh_history", "current_diagnosis_known", "therapist_name",
    "therapist_agency_phone", "mh_service_provider", "mh_services_desc",
    "court_case_desc", "social_family_medical_history", "additional_evals",
    "severity_explanation", "ace_events", "placement_considerations",
  ].forEach((key) => setDefault(a, key, MISSING_TEXT));
  setDefault(a, "ec1_name", "No personal emergency contact reported by client");
  setDefault(a, "ec1_cell_phone", "911 / Moore Divine Care 336-285-5204");
  setDefault(a, "ec1_home_phone", s(a.ec1_cell_phone));
}

export function applyOperationalDefaults(input: Answers, opts: { forPdf?: boolean } = {}): Answers {
  const a: Answers = { ...input };
  const intakeDate = s(a.intake_date) || new Date().toISOString().slice(0, 10);

  setDefault(a, "intake_date", intakeDate);
  setDefault(a, "referral_date", intakeDate);
  setDefault(a, "screening_date", intakeDate);
  setDefault(a, "admission_date", intakeDate);
  setDefault(a, "initial_screening_date", intakeDate);
  setDefault(a, "initial_assessment_date", intakeDate);
  setDefault(a, "official_admission_date", intakeDate);
  setDefault(a, "dis_admission_date", intakeDate);
  setDefault(a, "c_date_sent", intakeDate);

  setDefault(a, "has_medicaid", "Yes");
  setDefault(a, "provider_choice_plan", "Medicaid");
  setDefault(a, "has_nchc", "No");
  setDefault(a, "funding_other", "Medicaid");
  setDefault(a, "program_can_meet_needs", "Yes");
  setDefault(a, "ability_to_provide", "Yes");
  setDefault(a, "severity_of_need", "Routine");
  if (opts.forPdf) {
    setDefault(a, "hipaa_understood", "Yes");
    setDefault(a, "hipaa_copy", "Yes");
  }

  setDefault(a, "client_phone_home", s(a.client_phone_cell));
  setDefault(a, "ec1_home_phone", s(a.ec1_cell_phone));
  setDefault(a, "ec2_home_phone", s(a.ec2_cell_phone));

  const sharedStaffName =
    s(a.staff_receiving_intake) || s(a.qp_referred_to) || s(a.clinician_name) ||
    s(a.c_clinician) || s(a.dis_prepared_by);
  setDefault(a, "staff_receiving_intake", sharedStaffName);
  setDefault(a, "qp_referred_to", sharedStaffName);
  setDefault(a, "clinician_name", sharedStaffName);
  setDefault(a, "c_clinician", sharedStaffName);
  setDefault(a, "dis_prepared_by", sharedStaffName);

  setDefault(a, "transport_destination", "Services / treatment plan activities");
  setDefault(a, "transport_purposes", [
    "Mental Health Services",
    "Developmental Services",
    "Substance Abuse Services",
    "Activities associated with treatment plan",
  ]);

  for (const i of [1, 2, 3]) {
    setDefault(a, `roi${i}_items`, ["Service Notes", "Medication history/ physician orders", "Service Plan"]);
    setDefault(a, `roi${i}_purpose`, "Continuity of Care");
    setDefault(a, `roi${i}_thru_date`, addOneYear(intakeDate));
  }

  setDefault(a, "c_reason", ["Coordination of care", "Annual Notification"]);
  setDefault(a, "c_requested", ["Medical Diagnosis", "List of all medications", "Behavioral Health Assessment", "Individual Service Plan", "Clinical Impression"]);
  setDefault(a, "c_clinician", s(a.clinician_name) || s(a.staff_receiving_intake) || s(a.qp_referred_to));
  setDefault(a, "c_clinician_title", "QP / Clinician");

  applyDiagnosisDefaults(a);
  applyDischargeDefaults(a);
  if (opts.forPdf) applyNoneReportedPdfFallbacks(a);
  return a;
}
