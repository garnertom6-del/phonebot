import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { normalizeInsuranceValue } from "@/lib/insurancePlans";
import {
  CLIENT_ANSWER_KEYS,
  EDUCATION_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  ETHNICITY_PACKET_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  questionByKey,
  RACE_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
  STAFF_PREFILLED_CLIENT_FIELDS_KEY,
} from "@/config/mooreDivineQuestions";
import { parseHelperNotes } from "@/lib/parseIntakeNotes";

const FIELD_KEYS = new Set([
  "record_number", "mid_number", "gender", "education", "language", "language_other",
  "communication_level", "pcp_name", "pcp_phone", "pcp_address",
  "preferred_emergency_facility", "height", "weight", "hair_color", "eye_color",
  "identifying_marks", "special_diets", "medical_alerts", "last_physical_date", "fax",
  "ec1_name", "ec1_cell_phone", "ec1_home_phone", "ec1_work_phone", "ec1_street", "ec1_city", "ec1_state",
  "client_phone_cell", "client_phone_home", "client_phone_work", "client_email", "address_street",
  "address_city", "address_state", "living_arrangement", "lives_with_whom", "lives_where",
  "race", "ethnicity", "marital_status", "veteran", "employment_status", "occupation", "employer_name", "employer_address",
  "employer_phone", "has_medicaid", "medicaid_effective_date", "has_nchc",
  "nchc_policy", "nchc_effective_date", "has_medicare", "medicare_effective_date", "mco", "provider_choice_plan", "funding_other",
  "dss_ive_eligible", "income_sources", "income_other",
  "staff_receiving_intake", "qp_referred_to", "clinician_name", "c_clinician",
  "c_practice", "c_secure_fax", "c_secure_email", "c_agency_secure_fax",
  "referral_source", "referral_source_other", "social_agency_name", "referred_for", "services_requested", "services_other", "presenting_problem", "transport_destination",
  "transport_purposes", "program_can_meet_needs", "initial_screening_date",
  "strengths", "needs", "abilities", "preferences", "has_current_diagnosis", "diagnosis_list",
  "has_current_therapist", "therapist_name", "therapist_agency_phone", "mh_history",
  "has_limitations", "limitations_desc", "no_pcp_nearest_er", "medical_diagnoses", "treatments",
  "admission_date", "official_admission_date", "dis_programs", "dis_summary",
  "dis_strengths", "dis_needs", "dis_abilities", "dis_preferences",
  "dis_medications", "dis_crisis_contact", "dis_crisis_phone", "dis_prepared_by",
  "medications", "otc_medications", "hospitalizations", "drug_allergies", "environmental_allergies", "allergies",
  "pending_court_cases", "court_case_desc", "is_minor_or_incompetent", "date_adjudicated",
  "guardian_name", "guardian_address", "guardian_phone", "guardian_email",
  "current_diagnosis_known", "diagnosis_list", "receiving_mh_services",
  "mh_services_desc", "mh_service_provider", "other_agencies",
]);

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function hasValue(v: unknown): boolean {
  return !!clean(v) || (Array.isArray(v) && v.length > 0);
}

function option(value: string, options: string[]): string {
  const v = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ||
    options.find((o) => o.toLowerCase().includes(v) || v.includes(o.toLowerCase())) ||
    value.trim();
}

function normalizeAssistValue(key: string, value: string): string | string[] {
  const text = value.trim();
  if ([
    "has_medicaid", "has_nchc", "has_medicare", "program_can_meet_needs",
    "has_current_diagnosis", "has_current_therapist", "receiving_mh_services",
    "has_limitations", "no_pcp_nearest_er", "pending_court_cases", "is_minor_or_incompetent",
  ].includes(key)) {
    return /^(y|yes|true|has|active)$/i.test(text) ? "Yes" : /^(n|no|false|none)$/i.test(text) ? "No" : text;
  }
  if (key === "gender") return option(text, ["Female", "Male", "Transgender", "Other"]);
  if (key === "race") {
    return option(text, [...RACE_OPTIONS, "Native American"]);
  }
  if (key === "ethnicity") {
    return option(text, ETHNICITY_PACKET_OPTIONS);
  }
  if (key === "marital_status") {
    return option(text, MARITAL_STATUS_OPTIONS);
  }
  if (key === "veteran") {
    return option(text, ["Yes", "No"]);
  }
  if (key === "education") {
    return option(text, [...EDUCATION_OPTIONS, "High School/GED"]);
  }
  if (key === "language") {
    return option(text, ["English", "Spanish", "French", "German", "Other"]);
  }
  if (key === "communication_level") {
    return option(text, ["Excellent", "Good", "Fair", "Poor"]);
  }
  if (key === "living_arrangement") {
    return option(text, [
      "Adult with Spouse", "Adult with Relative", "Adult Alone", "Homeless", "Residential",
      "Living in hospital/institution", "Child with Parent", "Child with other relative", "Child with Non-relative",
    ]);
  }
  if (key === "referral_source") {
    return option(text, REFERRAL_SOURCE_OPTIONS);
  }
  if (key === "employment_status") {
    return option(text, EMPLOYMENT_STATUS_OPTIONS);
  }
  if (key === "mco") {
    return normalizeInsuranceValue(text, "mco") || text;
  }
  if (key === "provider_choice_plan") {
    return normalizeInsuranceValue(text, "providerChoice") || text;
  }
  if (["transport_purposes", "income_sources", "referred_for", "services_requested"].includes(key)) {
    return text.split(/[,;|]/).map((v) => v.trim()).filter(Boolean);
  }
  return text;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const incoming = body.fields && typeof body.fields === "object" ? body.fields as Record<string, unknown> : {};
  const helperNotes = clean(body.helperNotes);
  const fillEmptyOnly = body.fillEmptyOnly === true;
  const parsedNotes = parseHelperNotes(helperNotes);
  const current = await loadAnswers(intake.id);
  const next = { ...current };

  const applied = new Set<string>();
  for (const [key, value] of Object.entries(incoming)) {
    if (!FIELD_KEYS.has(key)) continue;
    const text = clean(value);
    if (text) {
      next[key] = normalizeAssistValue(key, text);
      applied.add(key);
    }
  }
  for (const [key, value] of Object.entries(parsedNotes)) {
    if (!FIELD_KEYS.has(key)) continue;
    const text = clean(value);
    if (!text) continue;
    if (fillEmptyOnly && hasValue(next[key])) continue;
    next[key] = normalizeAssistValue(key, text);
    applied.add(key);
  }
  if (helperNotes) next.staff_helper_notes = helperNotes;

  // Remember which client-facing answers came from staff helper info so the
  // SMS questionnaire can skip them without skipping legal consent questions.
  const existingStaffPrefilled = Array.isArray(current[STAFF_PREFILLED_CLIENT_FIELDS_KEY])
    ? current[STAFF_PREFILLED_CLIENT_FIELDS_KEY].filter((key): key is string => typeof key === "string")
    : [];
  const clientPrefilled = new Set(existingStaffPrefilled);
  for (const key of applied) {
    const question = questionByKey(key);
    if (CLIENT_ANSWER_KEYS.has(key) && question?.type !== "consent" && hasValue(next[key])) {
      clientPrefilled.add(key);
    }
  }
  next[STAFF_PREFILLED_CLIENT_FIELDS_KEY] = [...clientPrefilled].sort();

  const defaults = applyOperationalDefaults(next);
  await saveAnswers(intake.id, defaults);
  await syncStructuredRows(intake.id, defaults);
  await prisma.client.update({
    where: { id: intake.clientId },
    data: {
      midNumber: clean(defaults.mid_number) || intake.client.midNumber,
      recordNumber: clean(defaults.record_number) || intake.client.recordNumber,
      phone: clean(defaults.client_phone_cell) || intake.client.phone,
    },
  });
  await audit("answers_updated", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: applied.size
      ? `NC Tracks / helper info applied (${applied.size} fields; ${clientPrefilled.size} client answers prefilled)`
      : "NC Tracks / helper info applied",
  });
  const clientPrefilledFields = [...clientPrefilled].sort();
  return NextResponse.json({
    ok: true,
    applied: applied.size,
    fields: [...applied].sort(),
    clientPrefilled: clientPrefilledFields,
    clientPrefilledLabels: clientPrefilledFields.map((key) => questionByKey(key)?.label || key),
  });
}
