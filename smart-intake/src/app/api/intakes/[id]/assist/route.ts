import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

const FIELD_KEYS = new Set([
  "record_number", "mid_number", "pcp_name", "pcp_phone", "pcp_address",
  "preferred_emergency_facility", "height", "weight", "hair_color", "eye_color",
  "ec1_name", "ec1_cell_phone", "ec1_street", "ec1_city", "ec1_state",
  "client_phone_cell", "client_phone_home", "client_email", "address_street",
  "address_city", "address_state", "race", "ethnicity", "marital_status",
  "employment_status", "occupation", "employer_name", "employer_address",
  "employer_phone", "has_medicaid", "medicaid_effective_date", "has_nchc",
  "nchc_policy", "nchc_effective_date", "mco", "funding_other",
  "staff_receiving_intake", "qp_referred_to", "clinician_name", "c_clinician",
  "c_practice", "c_secure_fax", "c_secure_email", "c_agency_secure_fax",
  "referral_source", "social_agency_name", "services_other", "transport_destination",
  "transport_purposes", "program_can_meet_needs", "initial_screening_date",
  "admission_date", "official_admission_date", "dis_programs", "dis_summary",
  "dis_strengths", "dis_needs", "dis_abilities", "dis_preferences",
  "dis_medications", "dis_crisis_contact", "dis_crisis_phone", "dis_prepared_by",
  "medications", "otc_medications", "medical_diagnoses", "treatments",
  "hospitalizations", "drug_allergies", "environmental_allergies", "allergies",
  "current_diagnosis_known", "diagnosis_list", "receiving_mh_services",
  "mh_services_desc", "mh_service_provider", "other_agencies",
]);

const NOTE_LABELS: Array<[RegExp, string]> = [
  [/^mid(?:#| number)?$/i, "mid_number"],
  [/^record(?:#| number)?$/i, "record_number"],
  [/^(cell|cell phone|phone|client phone)$/i, "client_phone_cell"],
  [/^(home phone|client home phone)$/i, "client_phone_home"],
  [/^(email|client email)$/i, "client_email"],
  [/^(address|street|street address)$/i, "address_street"],
  [/^city$/i, "address_city"],
  [/^state$/i, "address_state"],
  [/^race$/i, "race"],
  [/^ethnicity$/i, "ethnicity"],
  [/^(marital|marital status)$/i, "marital_status"],
  [/^(employment|employment status)$/i, "employment_status"],
  [/^occupation$/i, "occupation"],
  [/^employer$/i, "employer_name"],
  [/^employer address$/i, "employer_address"],
  [/^employer phone$/i, "employer_phone"],
  [/^(medicaid|has medicaid)$/i, "has_medicaid"],
  [/^medicaid effective(?: date)?$/i, "medicaid_effective_date"],
  [/^(nchc|nc health choice|has nchc)$/i, "has_nchc"],
  [/^nchc policy$/i, "nchc_policy"],
  [/^nchc effective(?: date)?$/i, "nchc_effective_date"],
  [/^(mco|health plan|tailored plan)$/i, "mco"],
  [/^(funding|funding source)$/i, "funding_other"],
  [/^pcp(?: name| doctor)?$/i, "pcp_name"],
  [/^pcp phone$/i, "pcp_phone"],
  [/^pcp address$/i, "pcp_address"],
  [/^(hospital|emergency facility|local hospital)$/i, "preferred_emergency_facility"],
  [/^height$/i, "height"],
  [/^weight$/i, "weight"],
  [/^hair(?: color)?$/i, "hair_color"],
  [/^eye(?: color)?$/i, "eye_color"],
  [/^(emergency contact|ec1 name)$/i, "ec1_name"],
  [/^(emergency phone|ec1 phone|ec1 cell)$/i, "ec1_cell_phone"],
  [/^staff$/i, "staff_receiving_intake"],
  [/^qp$/i, "qp_referred_to"],
  [/^clinician$/i, "clinician_name"],
  [/^(staff|qp|clinician|witness) name$/i, "staff_receiving_intake"],
  [/^(transport|transport destination|transport purpose)$/i, "transport_destination"],
  [/^(can meet needs|program can meet needs)$/i, "program_can_meet_needs"],
  [/^initial screening(?: date)?$/i, "initial_screening_date"],
  [/^admission(?: date)?$/i, "admission_date"],
  [/^official admission(?: date)?$/i, "official_admission_date"],
  [/^discharge programs?$/i, "dis_programs"],
  [/^(discharge summary|dis summary)$/i, "dis_summary"],
  [/^strengths?$/i, "dis_strengths"],
  [/^needs?$/i, "dis_needs"],
  [/^abilities?$/i, "dis_abilities"],
  [/^preferences?$/i, "dis_preferences"],
  [/^(discharge medications|medications)$/i, "dis_medications"],
  [/^(current medications|prescription medications|prescriptions)$/i, "medications"],
  [/^(otc|over the counter|over-the-counter medications)$/i, "otc_medications"],
  [/^(medical diagnoses|medical conditions|physical health)$/i, "medical_diagnoses"],
  [/^(treatments|medical treatments)$/i, "treatments"],
  [/^(hospitalizations|surgeries)$/i, "hospitalizations"],
  [/^(drug allergies|medication allergies)$/i, "drug_allergies"],
  [/^(environmental allergies|food allergies)$/i, "environmental_allergies"],
  [/^allergies$/i, "allergies"],
  [/^(diagnosis|current diagnosis|mental health diagnosis)$/i, "current_diagnosis_known"],
  [/^(diagnosis list|diagnoses)$/i, "diagnosis_list"],
  [/^(receiving mental health services|currently receiving mental health services)$/i, "receiving_mh_services"],
  [/^(mental health services|mh services|services receiving)$/i, "mh_services_desc"],
  [/^(mental health provider|mh provider|service provider|other provider)$/i, "mh_service_provider"],
  [/^(other agencies|current agencies|other mental health company)$/i, "other_agencies"],
  [/^(crisis contact|discharge crisis contact)$/i, "dis_crisis_contact"],
  [/^(crisis phone|discharge crisis phone)$/i, "dis_crisis_phone"],
  [/^(prepared by|discharge prepared by)$/i, "dis_prepared_by"],
];

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseHelperNotes(notes: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of notes.split(/\r?\n/)) {
    const m = /^\s*([^:=-]{2,40})\s*[:=-]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    for (const [re, key] of NOTE_LABELS) {
      if (re.test(label)) {
        out[key] = value;
        break;
      }
    }
  }
  return out;
}

function option(value: string, options: string[]): string {
  const v = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ||
    options.find((o) => o.toLowerCase().includes(v) || v.includes(o.toLowerCase())) ||
    value.trim();
}

function normalizeAssistValue(key: string, value: string): string | string[] {
  const text = value.trim();
  if (key === "has_medicaid" || key === "has_nchc" || key === "program_can_meet_needs") {
    return /^(y|yes|true|has|active)$/i.test(text) ? "Yes" : /^(n|no|false|none)$/i.test(text) ? "No" : text;
  }
  if (key === "race") {
    return option(text, ["American Indian or Alaska Native", "Asian", "Black or African American", "Caucasian or White", "Multiracial", "Native American", "Native Hawaiian or Pacific Islander"]);
  }
  if (key === "ethnicity") {
    return option(text, ["Hispanic/White", "Non-Hispanic/White", "Latino", "Hispanic/Black", "Non-Hispanic/Black"]);
  }
  if (key === "marital_status") {
    return option(text, ["Single", "Married", "Separated", "Widowed"]);
  }
  if (key === "employment_status") {
    return option(text, ["Not in Labor Force", "Unemployed", "Disabled", "Employed"]);
  }
  if (key === "transport_purposes") {
    return text.split(/[,;|]/).map((v) => v.trim()).filter(Boolean);
  }
  return text;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const incoming = body.fields && typeof body.fields === "object" ? body.fields as Record<string, unknown> : {};
  const helperNotes = clean(body.helperNotes);
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
    if (text) {
      next[key] = normalizeAssistValue(key, text);
      applied.add(key);
    }
  }
  if (helperNotes) next.staff_helper_notes = helperNotes;

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
    detail: applied.size ? `NC Tracks / helper info applied (${applied.size} fields)` : "NC Tracks / helper info applied",
  });
  return NextResponse.json({ ok: true, applied: applied.size, fields: [...applied].sort() });
}
