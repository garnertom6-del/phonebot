/**
 * Seeds the demo database: staff login, the packet template record, and two
 * fully-answered sample clients (Angela Demo - adult; Jayden Sample - youth
 * with guardian), each with a captured demo signature.
 *
 * Run: npm run seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { newIntakeToken, tokenExpiry } from "../src/lib/tokens";
import { syncStructuredRows } from "../src/lib/intakeData";

const prisma = new PrismaClient();

function sigDataUrl(file: string): string {
  const p = path.join(__dirname, "assets", file);
  return "data:image/png;base64," + fs.readFileSync(p).toString("base64");
}

const TODAY = new Date().toLocaleDateString("en-US");

const ANGELA_ANSWERS: Record<string, unknown> = {
  intake_mode: "Full Intake - answer everything now",
  client_full_name: "Angela Demo", dob: "1987-04-12", mid_number: "987654321A",
  record_number: "MDC-1001", intake_date: TODAY, location: "Greensboro",
  client_email: "angela.demo@example.com", client_phone_cell: "336-555-0141",
  client_phone_home: "", gender: "Female", race: "Black or African American",
  ethnicity: "Non-Hispanic/Black", marital_status: "Single", veteran: "No",
  education: "High School/GED", language: "English", communication_level: "Good",
  address_street: "482 Maplewood Ave", address_city: "Greensboro", address_state: "NC",
  living_arrangement: "Adult Alone", lives_with_whom: "I live alone", lives_where: "Greensboro",
  effects_on_home: "N/A - lives alone, supportive sister nearby",
  employment_status: "Unemployed", income_sources: ["Disability"],
  has_medicaid: "Yes", medicaid_effective_date: "2024-01-01", has_medicare: "No",
  mco: "Healthy Blue Medicaid", has_nchc: "No",
  referral_source: "Self",
  referred_for: ["Peer Support Services", "Outpatient Therapy"],
  services_requested: ["Peer Support", "OPT"],
  presenting_problem:
    "I have been dealing with anxiety and depression for several years, and my housing " +
    "situation is unstable right now. I need peer support and someone to talk to so I can " +
    "get back on my feet and stay on track.",
  strengths: "Resilient, good with people, motivated to get better",
  needs: "Stable housing, coping skills, ongoing support",
  abilities: "Cooking, organizing, held retail jobs before",
  preferences: "Female peer support specialist if possible, afternoon appointments",
  other_agencies: "None currently",
  has_current_diagnosis: "Yes", diagnosis_list: "Generalized anxiety disorder; major depressive disorder",
  has_current_therapist: "No", receiving_mh_services: "No",
  mh_history: "Outpatient counseling in 2021-2022; no hospitalizations",
  current_diagnosis_known: "GAD; MDD",
  has_limitations: "No", pcp_name: "Dr. Renee Alston", pcp_phone: "336-555-0177",
  pcp_address: "Triad Family Medicine, 90 Wellness Dr, Greensboro NC",
  no_pcp_nearest_er: "No", preferred_emergency_facility: "Moses Cone Hospital",
  medical_diagnoses: "Asthma", treatments: "Albuterol inhaler as needed",
  hospitalizations: "None", last_physical_date: "March 2026",
  height: "5'5\"", weight: "150 lbs", hair_color: "Black", eye_color: "Brown",
  identifying_marks: "Small scar on left forearm", special_diets: "None",
  medical_alerts: "Asthma - carries inhaler",
  medications: "Sertraline 50mg daily, Albuterol inhaler",
  otc_medications: "Ibuprofen occasionally",
  drug_allergies: "Penicillin", environmental_allergies: "Pollen", allergies: "",
  pending_court_cases: "No", is_minor_or_incompetent: "No",
  ec1_name: "Monica Demo (sister)", ec1_street: "17 Birch Ct", ec1_city: "Greensboro",
  ec1_state: "NC", ec1_cell_phone: "336-555-0162", ec1_home_phone: "",
  sa_status: "No",
  provider_choice_plan: "Healthy Blue",
  roi1_recipient: "Dr. Renee Alston / Triad Family Medicine",
  roi1_items: ["Admission/ Screening Assessment", "Medication history/ physician orders", "Service Plan"],
  roi1_purpose: "Continuity of Care", roi1_thru_date: "", roi1_agreed: true,
  transport_destination: "Moore Divine Care Greensboro office and appointments",
  transport_purposes: ["Mental Health Services", "Activities associated with treatment plan"],
  intervention_valid_until: "",
  hipaa_understood: "Yes", hipaa_copy: "Yes", welcome_letter_ack: "Yes",
  survey_q1: "3", survey_q2: "3", survey_q3: "2", survey_q4: "3", survey_q5: "2",
  survey_q6: "2", survey_q7: "3", survey_q8: "2", survey_q9: "3",
  ref1_name: "Tasha Demo", ref1_phone: "336-555-0199",
  consent_provider_choice: true, consent_orientation: true, consent_rights: true,
  consent_treatment: true, consent_bill_of_rights: true, consent_emergency_info: true,
  consent_emergency_care: true, consent_emergency_interventions: true, consent_transport: true,
  consent_hipaa: true, consent_confidentiality: true,
  consent_treatment_plan_participation: true, consent_receipt_treatment_plan: true,
  consent_cca: true, consent_tailored_plan: true,
};

const JAYDEN_ANSWERS: Record<string, unknown> = {
  intake_mode: "Full Intake - answer everything now",
  client_full_name: "Jayden Sample", dob: "2011-09-22", mid_number: "123456789B",
  record_number: "MDC-1002", intake_date: TODAY, location: "Greensboro",
  client_email: "erica.sample@example.com", client_phone_cell: "336-555-0125",
  gender: "Male", race: "Black or African American", ethnicity: "Non-Hispanic/Black",
  marital_status: "Single", veteran: "No", education: "Grade/Elementary",
  language: "English", communication_level: "Good",
  address_street: "1206 Willow Bend Rd", address_city: "Greensboro", address_state: "NC",
  living_arrangement: "Child with Parent", lives_with_whom: "His mother Erica and younger sister",
  lives_where: "Greensboro", effects_on_home: "Frequent conflict with mother and sister when frustrated",
  employment_status: "Not in Labor Force", income_sources: [],
  has_medicaid: "Yes", medicaid_effective_date: "2023-06-01", has_medicare: "No",
  mco: "Alliance", has_nchc: "No",
  referral_source: "School",
  referred_for: ["Intensive In-Home Services", "Comprehensive Clinical Assessment"],
  services_requested: ["IIH", "CCA"],
  presenting_problem:
    "Jayden has been having behavioral concerns at school - leaving class, arguing with " +
    "teachers, and two suspensions this year. At home there is family conflict and he has " +
    "trouble managing his emotions. We need in-home support and a full assessment.",
  strengths: "Smart, loves basketball and drawing, protective of his sister",
  needs: "Emotional regulation skills, behavior support at school and home",
  abilities: "Good reader, artistic",
  preferences: "Male mentor if possible, after-school appointment times",
  other_agencies: "School counselor at Northview Middle School",
  has_current_diagnosis: "Not sure",
  has_current_therapist: "No", receiving_mh_services: "No",
  mh_history: "Saw school counselor weekly last year",
  has_limitations: "No", pcp_name: "Dr. Kevin Bryant", pcp_phone: "336-555-0110",
  pcp_address: "Greensboro Pediatrics, 240 Meadow Ln", no_pcp_nearest_er: "No",
  preferred_emergency_facility: "Moses Cone - Women's & Children's",
  medical_diagnoses: "Seasonal allergies", treatments: "Loratadine in spring",
  hospitalizations: "None", last_physical_date: "August 2025",
  height: "5'1\"", weight: "102 lbs", hair_color: "Black", eye_color: "Brown",
  identifying_marks: "None", special_diets: "None", medical_alerts: "None",
  medications: "None daily", otc_medications: "Loratadine 10mg in allergy season",
  drug_allergies: "None known", environmental_allergies: "Pollen, dust",
  pending_court_cases: "No",
  is_minor_or_incompetent: "Yes", guardian_name: "Erica Sample",
  guardian_address: "1206 Willow Bend Rd, Greensboro NC", guardian_phone: "336-555-0125",
  guardian_email: "erica.sample@example.com",
  ec1_name: "Erica Sample (mother/legal guardian)", ec1_street: "1206 Willow Bend Rd",
  ec1_city: "Greensboro", ec1_state: "NC", ec1_cell_phone: "336-555-0125",
  ec2_name: "Darius Sample (uncle)", ec2_cell_phone: "336-555-0138",
  sa_status: "Denies",
  provider_choice_plan: "Alliance",
  roi1_recipient: "Northview Middle School - Counseling Office",
  roi1_items: ["Admission/ Screening Assessment", "Service Plan", "Psychological testing"],
  roi1_purpose: "Continuity of Care", roi1_agreed: true,
  roi2_recipient: "Dr. Kevin Bryant / Greensboro Pediatrics",
  roi2_items: ["Medication history/ physician orders", "Service Plan"],
  roi2_purpose: "Continuity of Care", roi2_agreed: true,
  transport_destination: "School, Moore Divine Care office, and treatment activities",
  transport_purposes: ["Mental Health Services", "Activities associated with treatment plan"],
  hipaa_understood: "Yes", hipaa_copy: "Yes", welcome_letter_ack: "Yes",
  consent_provider_choice: true, consent_orientation: true, consent_rights: true,
  consent_treatment: true, consent_bill_of_rights: true, consent_emergency_info: true,
  consent_emergency_care: true, consent_emergency_interventions: true, consent_transport: true,
  consent_hipaa: true, consent_confidentiality: true,
  consent_treatment_plan_participation: true, consent_receipt_treatment_plan: true,
  consent_cca: true, consent_tailored_plan: true,
};

async function seedIntake(opts: {
  client: { fullName: string; dob: string; midNumber: string; recordNumber: string;
    email: string; phone: string; guardianName?: string; guardianEmail?: string; guardianPhone?: string };
  answers: Record<string, unknown>;
  signature: { role: "client" | "guardian"; file: string; printedName: string; relationship: string };
}) {
  const client = await prisma.client.create({ data: opts.client });
  const intake = await prisma.intake.create({
    data: {
      clientId: client.id, token: newIntakeToken(), tokenExpiresAt: tokenExpiry(),
      status: "SIGNED", intakeDate: TODAY, location: "Greensboro",
      linkSentAt: new Date(), lastActivityAt: new Date(), submittedAt: new Date(),
    },
  });
  await prisma.$transaction(Object.entries(opts.answers).map(([key, v]) =>
    prisma.intakeAnswer.create({ data: { intakeId: intake.id, key, value: JSON.stringify(v) } })));
  await prisma.signature.create({
    data: {
      intakeId: intake.id, role: opts.signature.role,
      imageData: sigDataUrl(opts.signature.file), printedName: opts.signature.printedName,
      relationship: opts.signature.relationship, signedDate: TODAY,
    },
  });
  await syncStructuredRows(intake.id, opts.answers);
  await prisma.auditLog.createMany({
    data: [
      { intakeId: intake.id, event: "intake_created", detail: "seed" },
      { intakeId: intake.id, event: "link_opened", detail: "seed" },
      { intakeId: intake.id, event: "signature_captured", detail: opts.signature.role },
      { intakeId: intake.id, event: "packet_submitted", detail: "seed" },
    ],
  });
  return intake;
}

async function main() {
  await prisma.user.upsert({
    where: { email: "admin@mooredivinecare.local" },
    create: {
      email: "admin@mooredivinecare.local",
      passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD || "IntakeDemo123!", 10),
      name: "MDC Admin", role: "admin",
    },
    // Setting ADMIN_PASSWORD in the host's environment updates the admin
    // password on the next deploy - no shell access or UI needed.
    update: process.env.ADMIN_PASSWORD
      ? { passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10) }
      : {},
  });
  await prisma.pdfTemplate.upsert({
    where: { name: "Moore Divine Care Client Intake Package" },
    create: {
      name: "Moore Divine Care Client Intake Package",
      filePath: "public/templates/MooreDivineCare_Intake_Packet-1.pdf", pageCount: 43,
    },
    update: {},
  });

  const existing = await prisma.client.findFirst({ where: { fullName: "Angela Demo" } });
  if (existing) {
    console.log("Sample clients already seeded - skipping.");
    return;
  }
  const a = await seedIntake({
    client: {
      fullName: "Angela Demo", dob: "04/12/1987", midNumber: "987654321A", recordNumber: "MDC-1001",
      email: "angela.demo@example.com", phone: "336-555-0141",
    },
    answers: ANGELA_ANSWERS,
    signature: { role: "client", file: "sig-angela.png", printedName: "Angela Demo", relationship: "client" },
  });
  const j = await seedIntake({
    client: {
      fullName: "Jayden Sample", dob: "09/22/2011", midNumber: "123456789B", recordNumber: "MDC-1002",
      email: "erica.sample@example.com", phone: "336-555-0125",
      guardianName: "Erica Sample", guardianEmail: "erica.sample@example.com", guardianPhone: "336-555-0125",
    },
    answers: JAYDEN_ANSWERS,
    signature: { role: "guardian", file: "sig-erica.png", printedName: "Erica Sample", relationship: "guardian" },
  });
  console.log("Seeded staff login admin@mooredivinecare.local / IntakeDemo123!");
  console.log("Seeded sample intakes:", a.id, j.id);
}

main().finally(() => prisma.$disconnect());
