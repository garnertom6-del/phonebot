import type { Answers } from "./fillPdf";
import { applyInsurancePlanDefaults } from "./insurancePlans";

/**
 * Operational defaults copy a real answer to another blank, or apply the
 * Medicaid-provider constants staff already decided (Medicaid Yes, NCHC No,
 * English, adult/competent, program can meet needs, Routine 14-day start,
 * thru dates = intake + 1 year). Client-skip placeholders such as
 * "none reported by client" are applied only when the client left email or
 * an employed work-phone blank.
 */

export const NONE_REPORTED_BY_CLIENT = "none reported by client";
export const NO_PRIMARY_CARE = "I do not have a primary care";

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

function isDiagnosisPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[.,;:_-]+/g, " ").replace(/\s+/g, " ").trim();
  return [
    "not reported",
    "not reported by client",
    "none",
    "none reported",
    "none reported by client",
    "unknown",
    "n a",
    "no diagnosis",
    "no diagnosis reported",
    "no current diagnosis",
  ].includes(normalized);
}

function diagnosisList(a: Answers): string[] {
  const listText = (value: unknown) => Array.isArray(value) ? value.join("; ") : s(value);
  const raw = [
    listText(a.sa_primary_diagnosis),
    listText(a.sa_secondary_diagnosis),
    listText(a.current_diagnosis_known),
    listText(a.diagnosis_menu),
    listText(a.diagnosis_list),
  ].filter(Boolean).join("; ");
  const seen = new Set<string>();
  return raw
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter((x) => {
      const normalized = x.toLowerCase();
      if (!x || isDiagnosisPlaceholder(x) || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 5);
}

function splitDiagnosis(value: unknown): { code: string; description: string } {
  // Some CCA exports render codes such as F33,.1. Normalize that punctuation
  // before splitting the code from the diagnosis description.
  const text = s(value).replace(/^([A-Z]\d{2})[, ]+\.?([0-9]+)/i, "$1.$2");
  const trailingCode = /^(.*?)\s*\(([A-Z]\d{2}(?:\.\d+)?)\)\s*$/i.exec(text);
  if (trailingCode) {
    return { code: trailingCode[2].toUpperCase(), description: trailingCode[1].trim() };
  }
  const match = /^([A-Z]\d{2}(?:\.\d+)?)\s*[-:)]?\s*(.*)$/i.exec(text);
  if (!match) return { code: "", description: text };
  return { code: match[1].toUpperCase(), description: match[2].trim() };
}

function splitDiagnosisGroup(value: unknown): { codes: string; descriptions: string } {
  const parsed = s(value)
    .split(/[;\n]+/)
    .map((entry) => splitDiagnosis(entry))
    .filter((entry) => entry.code || entry.description);
  return {
    codes: parsed.map((entry) => entry.code).filter(Boolean).join("; "),
    descriptions: parsed.map((entry) => entry.description).filter(Boolean).join("; "),
  };
}

function clearAxis(a: Answers, axis: number) {
  for (const suffix of ["", "_code", "_description", "_axis", "_code_number"]) {
    delete a[`c_axis${axis}${suffix}`];
  }
  delete a[`dis_adm_axis${axis}`];
}

function clearLegacyPresentingProblemFromAxis4(a: Answers) {
  const presenting = s(a.presenting_problem);
  const axis4 = s(a.c_axis4);
  const axis4Description = s(a.c_axis4_description);
  if (!presenting || s(a.social_family_medical_history)) return;

  // Older SMS saves incorrectly copied the presenting problem into Axis IV.
  // Remove only that exact derived value; preserve a real staff-entered Axis IV.
  if (axis4 !== presenting && axis4Description !== presenting) return;
  for (const key of ["c_axis4", "c_axis4_code", "c_axis4_description", "c_axis4_axis", "c_axis4_code_number"]) {
    delete a[key];
  }
}

/** Copy real, already-given diagnoses into the axis/discharge slots. */
function applyDiagnosisDefaults(a: Answers) {
  const dx = diagnosisList(a);
  if (dx.length) {
    setDefault(a, "sa_primary_diagnosis", dx[0]);
    setDefault(a, "sa_secondary_diagnosis", dx[1]);
    const axis1 = [...s(a.c_axis1).split(/[;\n]+/), ...dx]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry, index, entries) =>
        entries.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index,
      );
    if (axis1.length) a.c_axis1 = axis1.join("; ");

    // Older builds copied the second ordinary clinical diagnosis into Axis II
    // and sometimes copied a diagnosis into Axis V. Remove only those exact
    // derived values when their ICD code cannot represent an Axis-II condition.
    const axis2 = s(a.c_axis2);
    const axis2Code = splitDiagnosis(axis2).code;
    if (
      axis2 &&
      dx.some((entry) => entry.toLowerCase() === axis2.toLowerCase()) &&
      axis2Code &&
      !/^F(?:6\d|7\d)(?:\.|$)/i.test(axis2Code)
    ) clearAxis(a, 2);
    const axis5 = s(a.c_axis5);
    if (
      axis5 &&
      dx.some((entry) => entry.toLowerCase() === axis5.toLowerCase()) &&
      !!splitDiagnosis(axis5).code
    ) clearAxis(a, 5);
  }
  setDefault(a, "c_axis3", s(a.medical_diagnoses));
  setDefault(a, "c_axis4", s(a.social_family_medical_history));
  const roman = ["I", "II", "III", "IV", "V"];
  for (let i = 1; i <= 5; i++) {
    const axisValue = s(a[`c_axis${i}`]);
    const { codes, descriptions } = splitDiagnosisGroup(axisValue);
    setDefault(a, `c_axis${i}_code`, codes);
    setDefault(a, `c_axis${i}_description`, descriptions);
    setDefault(a, `c_axis${i}_axis`, axisValue ? roman[i - 1] : "");
    setDefault(a, `c_axis${i}_code_number`, codes);
    setDefault(a, `dis_adm_axis${i}`, axisValue);
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

function chipList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = s(value);
  return text ? text.split(/[,;]+/).map((item) => item.trim()).filter(Boolean) : [];
}

function applyPresentingDefaults(a: Answers) {
  const needs = chipList(a.presenting_need_chips);
  const why = chipList(a.why_want_services_chips);
  const whyText = s(a.why_want_services_text);
  const extra = s(a.presenting_problem);
  const derived = [needs.join(", "), why.join(", "), whyText].filter(Boolean).join(". ");
  if (!derived) return;
  if (!extra) a.presenting_problem = derived;
  else if (extra === derived || extra.startsWith(derived)) return;
  else if (derived.includes(extra)) a.presenting_problem = derived;
  else a.presenting_problem = `${derived}. ${extra}`;
}

function applyClientNarrativeDefaults(a: Answers) {
  applyPresentingDefaults(a);
  const agencies = chipList(a.other_agency_types);
  const where = s(a.other_agency_where);
  if (agencies.length) {
    setDefault(a, "other_agencies", [agencies.join(", "), where].filter(Boolean).join(" — "));
  }
  const limits = chipList(a.limitation_types);
  if (limits.length) setDefault(a, "limitations_desc", [limits.join(", "), s(a.limitations_desc)].filter(Boolean).join(". "));
  const allergies = chipList(a.allergy_types);
  if (allergies.length) {
    setDefault(a, "allergies", [allergies.join(", "), s(a.allergies)].filter(Boolean).join(". "));
    if (allergies.some((item) => item !== "Food" && item !== "Other")) {
      setDefault(a, "drug_allergies", allergies.filter((item) => item !== "Food" && item !== "Other").join(", "));
    }
    if (allergies.includes("Food")) setDefault(a, "environmental_allergies", [s(a.environmental_allergies), "Food"].filter(Boolean).join(", "));
  }
  const menu = s(a.diagnosis_menu);
  if (menu && menu !== "Other" && menu !== "I don't know") {
    setDefault(a, "diagnosis_list", menu);
    setDefault(a, "current_diagnosis_known", menu);
  }
  if (s(a.has_pcp) === "No") setDefault(a, "pcp_name", NO_PRIMARY_CARE);
}

/** Fill email / employed work-phone after the client skips or leaves them blank. */
export function applySkippedClientPlaceholders(input: Answers, keys?: string[]): Answers {
  const a: Answers = { ...input };
  const target = keys?.length ? keys : ["client_email", "client_phone_work", "employer_phone"];
  for (const key of target) {
    if (key === "client_email" && isBlank(a.client_email)) a.client_email = NONE_REPORTED_BY_CLIENT;
    if ((key === "client_phone_work" || key === "employer_phone")
      && ["Employed", "Self-Employed"].includes(s(a.employment_status))
      && isBlank(a[key])) {
      a[key] = NONE_REPORTED_BY_CLIENT;
    }
  }
  return a;
}

export function applyOperationalDefaults(input: Answers, opts: { forPdf?: boolean } = {}): Answers {
  const a: Answers = { ...input };
  const forPdf = opts.forPdf === true;
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
  for (const key of ["roi1_thru_date", "roi2_thru_date", "roi3_thru_date"]) {
    setDefault(a, key, addOneYear(intakeDate));
  }

  // Do not invent coverage, guardian status, clinical severity, or
  // program/service eligibility. Those values require a record, CCA, or staff
  // review. A verified MID is sufficient evidence for the Medicaid checkbox.
  // Preferred language is a staff constant (English) — never a client SMS ask.
  if (!isBlank(a.mid_number)) setDefault(a, "has_medicaid", "Yes");
  setDefault(a, "has_nchc", "No");
  setDefault(a, "language", "English");

  setDefault(a, "pcp_plan_client_name", s(a.client_full_name));
  setDefault(a, "pcp_plan_dob", s(a.dob));
  setDefault(a, "pcp_plan_medicaid_id", s(a.mid_number));
  setDefault(a, "pcp_plan_record_number", s(a.record_number));
  setDefault(a, "pcp_plan_person_receiving", "Yes");
  setDefault(a, "pcp_plan_client_printed_name", s(a.client_full_name));

  if (s(a.roi_understand_1) === "Yes" && s(a.roi_understand_2) === "Yes" && s(a.roi_understand_3) === "Yes") {
    setDefault(a, "roi_understand_initialed", "Yes");
  }

  if (forPdf) {
    setDefault(a, "services_requested", ["CCA", "OPT", "Med Mgt"]);
    if (isBlank(a.client_email)) a.client_email = NONE_REPORTED_BY_CLIENT;
    if (["Employed", "Self-Employed"].includes(s(a.employment_status))) {
      if (isBlank(a.client_phone_work)) a.client_phone_work = NONE_REPORTED_BY_CLIENT;
      if (isBlank(a.employer_phone)) a.employer_phone = NONE_REPORTED_BY_CLIENT;
    }
    if (s(a.last_physical_date) === "Yes") a.last_physical_date = "Within last year";
    if (s(a.last_physical_date) === "No") a.last_physical_date = "Not in last year";
    if (s(a.education) === "High School" || s(a.education) === "GED") a.education = "High School/GED";
  }

  // phones: same number, different blanks
  setDefault(a, "client_phone_home", s(a.client_phone_cell));
  setDefault(a, "ec1_home_phone", s(a.ec1_cell_phone));
  setDefault(a, "ec2_home_phone", s(a.ec2_cell_phone));

  // Gate answers may be derived only from a real supporting value. This keeps
  // staff/NC Tracks/CCA prefills from making the client repeat a parent answer.
  if (!isBlank(a.pcp_name) || !isBlank(a.pcp_phone) || !isBlank(a.pcp_address)) setDefault(a, "has_pcp", "Yes");
  if (!isBlank(a.diagnosis_menu) || !isBlank(a.diagnosis_list)) setDefault(a, "has_current_diagnosis", "Yes");
  if (!isBlank(a.limitation_types) || !isBlank(a.limitations_desc)) setDefault(a, "has_limitations", "Yes");
  if (!isBlank(a.hospitalizations)) setDefault(a, "has_hospitalization", "Yes");
  if (!isBlank(a.drug_allergies) || !isBlank(a.environmental_allergies) || !isBlank(a.allergies)) {
    setDefault(a, "has_allergies", "Yes");
  }

  applyInsurancePlanDefaults(a);
  applyClientNarrativeDefaults(a);

  // one staff member's name flows to the synonymous staff-name blanks
  const sharedStaffName =
    s(a.staff_receiving_intake) || s(a.qp_referred_to) || s(a.clinician_name) ||
    s(a.c_clinician) || s(a.dis_prepared_by);
  setDefault(a, "staff_receiving_intake", sharedStaffName);
  setDefault(a, "qp_referred_to", sharedStaffName);
  setDefault(a, "clinician_name", sharedStaffName);
  setDefault(a, "c_clinician", sharedStaffName);
  setDefault(a, "dis_prepared_by", sharedStaffName);

  clearLegacyPresentingProblemFromAxis4(a);
  applyDiagnosisDefaults(a);
  applyDischargeDefaults(a);
  return a;
}
