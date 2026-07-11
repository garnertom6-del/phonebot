import type { Answers } from "./fillPdf";

/**
 * Operational defaults policy: a default may COPY a real answer somewhere
 * else (same fact, different blank), but must never INVENT an answer nobody
 * gave. Payer status, clinical severity, consent/acknowledgment boxes and
 * "None reported" clinical negatives are deliberately NOT defaulted unless a
 * verified source already proves the answer (for example, a real MID means
 * Medicaid has already been confirmed).
 */

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

function splitDiagnosis(value: unknown): { code: string; description: string } {
  const text = s(value);
  const match = /^([A-Z]\d{2}(?:\.\d+)?)\s*[-:)]?\s*(.*)$/i.exec(text);
  if (!match) return { code: "", description: text };
  return { code: match[1].toUpperCase(), description: match[2].trim() };
}

/** Copy real, already-given diagnoses into the axis/discharge slots. */
function applyDiagnosisDefaults(a: Answers) {
  const dx = diagnosisList(a);
  if (dx.length) {
    setDefault(a, "sa_primary_diagnosis", dx[0]);
    setDefault(a, "sa_secondary_diagnosis", dx[1]);
    setDefault(a, "c_axis1", dx[0]);
    setDefault(a, "c_axis2", dx[1]);
  }
  setDefault(a, "c_axis3", s(a.medical_diagnoses));
  setDefault(a, "c_axis4", s(a.social_family_medical_history) || s(a.presenting_problem));
  for (let i = 1; i <= 5; i++) {
    const { code, description } = splitDiagnosis(a[`c_axis${i}`]);
    setDefault(a, `c_axis${i}_code`, code);
    setDefault(a, `c_axis${i}_description`, description);
    setDefault(a, `dis_adm_axis${i}`, dx[i - 1] || "");
  }
}

/** Pre-fill discharge blanks ONLY with facts the client already gave. */
function applyDischargeDefaults(a: Answers) {
  setDefault(a, "dis_programs", s(a.services_requested) || s(a.referred_for));
  setDefault(a, "dis_summary", s(a.presenting_problem) || s(a.mh_history));
  setDefault(a, "dis_pcp_plan", s(a.needs) || s(a.treatments));
  // the crisis notes staff enter on the PCP/Crisis tab must reach the packet -
  // fold them into the printed plan description until a dedicated crisis-plan
  // document exists
  const crisis = [
    s(a.crisis_warning_signs) && `Warning signs: ${s(a.crisis_warning_signs)}`,
    s(a.crisis_steps) && `Coping steps: ${s(a.crisis_steps)}`,
    s(a.crisis_supports) && `Support people: ${s(a.crisis_supports)}`,
  ].filter(Boolean).join(" | ");
  if (crisis && !s(a.dis_pcp_plan).includes("Warning signs:")) {
    a.dis_pcp_plan = [s(a.dis_pcp_plan), crisis].filter(Boolean).join(" | ");
  }
  setDefault(a, "dis_strengths", s(a.strengths));
  setDefault(a, "dis_needs", s(a.needs));
  setDefault(a, "dis_abilities", s(a.abilities));
  setDefault(a, "dis_preferences", s(a.preferences));
  setDefault(a, "dis_medications", [s(a.medications), s(a.otc_medications)].filter(Boolean).join("; "));
  setDefault(a, "dis_residence_detail", s(a.living_arrangement) || s(a.lives_with_whom));
  setDefault(a, "dis_continuing_care", s(a.needs));
  setDefault(a, "dis_comments", s(a.preferences));
  setDefault(a, "dis_prepared_by", s(a.clinician_name) || s(a.staff_receiving_intake) || s(a.qp_referred_to));
}

export function applyOperationalDefaults(input: Answers, opts: { forPdf?: boolean } = {}): Answers {
  void opts; // kept for call-site compatibility; no PDF-only fabrications remain
  const a: Answers = { ...input };
  const intakeDate = s(a.intake_date) || new Date().toISOString().slice(0, 10);

  // dates: the intake happened on one day - copy it to the date blanks
  setDefault(a, "intake_date", intakeDate);
  setDefault(a, "referral_date", intakeDate);
  setDefault(a, "screening_date", intakeDate);
  setDefault(a, "admission_date", intakeDate);
  setDefault(a, "initial_screening_date", intakeDate);
  setDefault(a, "initial_assessment_date", intakeDate);
  setDefault(a, "official_admission_date", intakeDate);
  setDefault(a, "dis_admission_date", intakeDate);
  setDefault(a, "c_date_sent", intakeDate);
  // the question itself states this default ("max 1 year - defaults to 1 year from today")
  setDefault(a, "intervention_valid_until", addOneYear(intakeDate));

  // phones: same number, different blanks
  setDefault(a, "client_phone_home", s(a.client_phone_cell));
  setDefault(a, "ec1_home_phone", s(a.ec1_cell_phone));
  setDefault(a, "ec2_home_phone", s(a.ec2_cell_phone));

  // a verified MID means Medicaid coverage is already established
  if (!isBlank(a.mid_number)) setDefault(a, "has_medicaid", "Yes");

  // one staff member's name flows to the synonymous staff-name blanks
  const sharedStaffName =
    s(a.staff_receiving_intake) || s(a.qp_referred_to) || s(a.clinician_name) ||
    s(a.c_clinician) || s(a.dis_prepared_by);
  setDefault(a, "staff_receiving_intake", sharedStaffName);
  setDefault(a, "qp_referred_to", sharedStaffName);
  setDefault(a, "clinician_name", sharedStaffName);
  setDefault(a, "c_clinician", sharedStaffName);
  setDefault(a, "dis_prepared_by", sharedStaffName);

  applyDiagnosisDefaults(a);
  applyDischargeDefaults(a);
  return a;
}
