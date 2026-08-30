import { isPlausiblePhone } from "./intakeContacts";

export type IntakeNoteField = {
  key: string;
  label: string;
  value: string;
};

const NOTE_LABELS: Array<[RegExp, string]> = [
  [/^(name|client name|full name|client full name|recipient name|member name)$/i, "client_full_name"],
  [/^(dob|date of birth|birth date|birthdate)$/i, "dob"],
  [/^(mid(?:#| number)?|recipient id|medicaid id|member id|medicaid number)$/i, "mid_number"],
  [/^record(?:#| number)?$/i, "record_number"],
  [/^(cell|cell phone|phone|phone number|client phone|mobile|mobile phone)$/i, "client_phone_cell"],
  [/^(home phone|client home phone)$/i, "client_phone_home"],
  [/^(work phone|client work phone)$/i, "client_phone_work"],
  [/^(email|client email)$/i, "client_email"],
  [/^(address|street|street address)$/i, "address_street"],
  [/^city$/i, "address_city"],
  [/^state$/i, "address_state"],
  [/^gender$/i, "gender"],
  [/^race$/i, "race"],
  [/^ethnicity$/i, "ethnicity"],
  [/^(marital|marital status)$/i, "marital_status"],
  [/^(veteran|veteran status|military service)$/i, "veteran"],
  [/^(education|highest education)$/i, "education"],
  [/^(language|preferred language)$/i, "language"],
  [/^(communication|communication level)$/i, "communication_level"],
  [/^(employment|employment status)$/i, "employment_status"],
  [/^(living arrangement|where living|residence)$/i, "living_arrangement"],
  [/^(lives with|who lives with|household)$/i, "lives_with_whom"],
  [/^(lives where|living area|residence area)$/i, "lives_where"],
  [/^occupation$/i, "occupation"],
  [/^employer$/i, "employer_name"],
  [/^employer address$/i, "employer_address"],
  [/^employer phone$/i, "employer_phone"],
  [/^(medicaid|has medicaid)$/i, "has_medicaid"],
  [/^medicaid effective(?: date)?$/i, "medicaid_effective_date"],
  [/^(medicare|has medicare)$/i, "has_medicare"],
  [/^medicare effective(?: date)?$/i, "medicare_effective_date"],
  [/^(nchc|nc health choice|has nchc)$/i, "has_nchc"],
  [/^nchc policy$/i, "nchc_policy"],
  [/^nchc effective(?: date)?$/i, "nchc_effective_date"],
  [/^(mco|health plan|tailored plan)$/i, "mco"],
  [/^(insurance type|insurance plan|provider choice plan)$/i, "provider_choice_plan"],
  [/^(funding|funding source)$/i, "funding_other"],
  [/^(income|income sources|money from)$/i, "income_sources"],
  [/^other income$/i, "income_other"],
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
  [/^emergency (home|house) phone$/i, "ec1_home_phone"],
  [/^emergency work phone$/i, "ec1_work_phone"],
  [/^emergency street$/i, "ec1_street"],
  [/^emergency city$/i, "ec1_city"],
  [/^emergency state$/i, "ec1_state"],
  [/^staff$/i, "staff_receiving_intake"],
  [/^qp$/i, "qp_referred_to"],
  [/^clinician$/i, "clinician_name"],
  [/^(staff|qp|clinician|witness) name$/i, "staff_receiving_intake"],
  [/^(transport|transport destination|transport purpose)$/i, "transport_destination"],
  [/^(referral|referral source|referred by)$/i, "referral_source"],
  [/^(other referral|other agency or provider|referral source other)$/i, "referral_source_other"],
  [/^(social agency|agency name)$/i, "social_agency_name"],
  [/^(referred for|requested services)$/i, "referred_for"],
  [/^(services requested|services interested in)$/i, "services_requested"],
  [/^other service$/i, "services_other"],
  [/^(presenting problem|reason for services|what brings you in)$/i, "presenting_problem"],
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
  [/^client strengths?$/i, "strengths"],
  [/^client needs?$/i, "needs"],
  [/^client abilities?$/i, "abilities"],
  [/^care preferences?$/i, "preferences"],
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
  [/^(mental health history|mh history)$/i, "mh_history"],
  [/^(current therapist|therapist)$/i, "therapist_name"],
  [/^(therapist phone|therapist agency|therapist agency phone)$/i, "therapist_agency_phone"],
  [/^(current diagnosis|diagnosis known)$/i, "current_diagnosis_known"],
  [/^(diagnosis list|diagnoses)$/i, "diagnosis_list"],
  [/^(physical limitations|limitations)$/i, "limitations_desc"],
  [/^(no pcp|no primary care doctor)$/i, "no_pcp_nearest_er"],
  [/^(last physical|last physical date)$/i, "last_physical_date"],
  [/^(identifying marks|scars|tattoos)$/i, "identifying_marks"],
  [/^(special diet|special diets)$/i, "special_diets"],
  [/^(medical alert|medical alerts)$/i, "medical_alerts"],
  [/^fax$/i, "fax"],
  [/^(court cases|pending court cases)$/i, "pending_court_cases"],
  [/^(court case|court case description)$/i, "court_case_desc"],
  [/^(minor|legal guardian|guardian status)$/i, "is_minor_or_incompetent"],
  [/^date adjudicated$/i, "date_adjudicated"],
  [/^guardian name$/i, "guardian_name"],
  [/^guardian address$/i, "guardian_address"],
  [/^guardian phone$/i, "guardian_phone"],
  [/^guardian email$/i, "guardian_email"],
  [/^(crisis contact|discharge crisis contact)$/i, "dis_crisis_contact"],
  [/^(crisis phone|discharge crisis phone)$/i, "dis_crisis_phone"],
  [/^(prepared by|discharge prepared by)$/i, "dis_prepared_by"],
];

export const INTAKE_NOTE_FIELD_LABELS: Record<string, string> = {
  client_full_name: "Name",
  dob: "Date of birth",
  mid_number: "MID",
  record_number: "Record#",
  client_phone_cell: "Phone",
  client_email: "Email",
  address_street: "Street",
  address_city: "City",
  address_state: "State",
  living_arrangement: "Living arrangement",
  gender: "Gender",
  race: "Race",
  ethnicity: "Ethnicity",
  veteran: "Veteran",
  employment_status: "Employment",
  provider_choice_plan: "Insurance",
  pcp_name: "PCP",
  pcp_phone: "PCP phone",
  ec1_name: "Emergency contact",
  ec1_cell_phone: "Emergency phone",
};

const CREATE_FORM_NOTE_KEYS = [
  "client_full_name",
  "dob",
  "mid_number",
  "client_phone_cell",
  "client_email",
  "address_street",
  "address_city",
  "address_state",
  "living_arrangement",
  "gender",
  "race",
  "ethnicity",
  "veteran",
  "employment_status",
  "provider_choice_plan",
  "pcp_name",
  "pcp_phone",
  "ec1_name",
  "ec1_cell_phone",
] as const;

function keyForLabel(label: string): string | undefined {
  for (const [re, key] of NOTE_LABELS) {
    if (re.test(label)) return key;
  }
  return undefined;
}

export function toDateInputValue(value: string): string {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  const year = Number(iso?.[1] || us?.[3]);
  const month = Number(iso?.[2] || us?.[1]);
  const day = Number(iso?.[3] || us?.[2]);
  if (!year || !month || !day) return trimmed;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return trimmed;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function splitUsAddress(value: string): { street?: string; city?: string; state?: string } {
  const trimmed = value.trim();
  const withCommaState = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(trimmed);
  if (withCommaState) {
    return { street: withCommaState[1].trim(), city: withCommaState[2].trim(), state: withCommaState[3].toUpperCase() };
  }
  const cityState = /^(.+?),\s*([^,]+?)\s+([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(trimmed);
  if (cityState) {
    return { street: cityState[1].trim(), city: cityState[2].trim(), state: cityState[3].toUpperCase() };
  }
  return { street: trimmed };
}

function firstPhoneIn(value: string): string | undefined {
  const match = value.match(/(\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4})/);
  const candidate = match?.[1]?.trim();
  return candidate && isPlausiblePhone(candidate) ? candidate : undefined;
}

export function splitNameAndPhone(value: string): { name?: string; phone?: string } {
  const phone = firstPhoneIn(value);
  if (!phone) return { name: value.trim() || undefined };
  const name = value.replace(phone, "").replace(/[,/|]+/g, " ").replace(/\s+/g, " ").trim();
  return { name: name || undefined, phone };
}

function setIfEmpty(out: Record<string, string>, key: string, value?: string) {
  const text = (value || "").trim();
  if (!text || out[key]) return;
  out[key] = text;
}

export function parseHelperNotes(notes: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of notes.split(/\r?\n/)) {
    const m = /^\s*([^:=-]{2,40})\s*[:=-]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = keyForLabel(m[1].trim());
    if (!key) continue;
    out[key] = m[2].trim();
  }

  if (out.dob) out.dob = toDateInputValue(out.dob);

  if (out.address_street && !out.address_city && !out.address_state) {
    const parts = splitUsAddress(out.address_street);
    if (parts.city || parts.state) {
      if (parts.street) out.address_street = parts.street;
      setIfEmpty(out, "address_city", parts.city);
      setIfEmpty(out, "address_state", parts.state);
    }
  }

  if (out.ec1_name && !out.ec1_cell_phone) {
    const parts = splitNameAndPhone(out.ec1_name);
    if (parts.phone) {
      if (parts.name) out.ec1_name = parts.name;
      else delete out.ec1_name;
      out.ec1_cell_phone = parts.phone;
    }
  }

  return out;
}

export function extractIntakeNoteFields(notes: string): IntakeNoteField[] {
  const parsed = parseHelperNotes(notes);
  return CREATE_FORM_NOTE_KEYS
    .filter((key) => parsed[key])
    .map((key) => ({
      key,
      label: INTAKE_NOTE_FIELD_LABELS[key] || key,
      value: parsed[key],
    }));
}

export type ExtractedNoteFieldState = "empty" | "applied" | "replace";

export function extractedNoteFieldState(field: IntakeNoteField, currentValue: string): ExtractedNoteFieldState {
  const current = currentValue.trim();
  if (current === field.value.trim()) return "applied";
  if (current) return "replace";
  return "empty";
}

/** Empty-field chips only. Occupied fields stay until staff confirms replace. */
export function emptyExtractedNoteFields(
  fields: IntakeNoteField[],
  currentOf: (field: IntakeNoteField) => string,
): IntakeNoteField[] {
  return fields.filter((field) => extractedNoteFieldState(field, currentOf(field)) === "empty");
}
