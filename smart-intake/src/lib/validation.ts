import { z } from "zod";
import { REQUIRED_FOR_SUBMIT, SECTIONS, questionByKey, type AskIf, type Question } from "@/config/mooreDivineQuestions";
import type { Answers } from "./fillPdf";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function validCalendarDate(value: string): Date | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  const year = Number(iso?.[1] || us?.[3]);
  const month = Number(iso?.[2] || us?.[1]);
  const day = Number(iso?.[3] || us?.[2]);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

const optionalPhone = z.string().trim().optional().default("").refine(
  (value) => !value || /^\d{10,15}$/.test(value.replace(/\D/g, "")),
  "Enter a valid phone number with at least 10 digits",
);

export const newIntakeSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the client's full name"),
  dob: z.string().trim().min(1, "DOB is required").refine((value) => {
    const date = validCalendarDate(value);
    if (!date) return false;
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return date.getTime() <= todayUtc;
  }, "Enter a valid date of birth that is not in the future"),
  midNumber: z.string().trim().optional().default(""),
  recordNumber: z.string().trim().min(1, "Record # is required"),
  intakeDate: z.string().optional().default(""),
  location: z.string().optional().default(""),
  providerChoicePlan: z.string().optional().default(""),
  referralSource: z.string().optional().default(""),
  addressStreet: z.string().optional().default(""),
  addressCity: z.string().optional().default(""),
  addressState: z.string().optional().default(""),
  livingArrangement: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  phone: optionalPhone,
  guardianName: z.string().optional().default(""),
  guardianEmail: z.string().email().optional().or(z.literal("")),
  guardianPhone: optionalPhone,
  expectCca: z.boolean().optional(),
  autoEmailProviderPacket: z.boolean().optional(),
});

export const clientDetailsSchema = newIntakeSchema.pick({
  fullName: true,
  dob: true,
  midNumber: true,
  recordNumber: true,
  email: true,
  phone: true,
  guardianName: true,
  guardianEmail: true,
  guardianPhone: true,
});

export const batchIntakesSchema = z.object({
  expectCca: z.boolean().optional(),
  generateDraftPackets: z.boolean().optional(),
  generatePackets: z.boolean().optional(),
  intakes: z.array(newIntakeSchema)
    .min(1, "Add at least one intake")
    .max(25, "Create 25 intakes or fewer at a time"),
});

export const answersSchema = z.record(
  z.union([z.string(), z.boolean(), z.number(), z.array(z.string())]),
);

export const signatureSchema = z.object({
  role: z.enum(["client", "guardian", "staff", "clinician", "witness", "medicalDirector"]),
  imageData: z.string().startsWith("data:image"),
  printedName: z.string().min(1),
  relationship: z.enum(["client", "parent", "guardian", "legalRepresentative"]).optional(),
  signedDate: z.string().min(1),
  dobCheck: z.string().optional(),
});

export function askIfSatisfied(cond: AskIf | undefined, answers: Answers): boolean {
  if (!cond) return true;
  const v = answers[cond.key];
  if (cond.truthy) return !!v && v !== "No";
  if (cond.equals !== undefined) return v === cond.equals;
  if (cond.oneOf) return Array.isArray(v) ? v.some((x) => cond.oneOf!.includes(x)) : cond.oneOf.includes(String(v));
  return true;
}

/** A client without a fixed address should not be blocked by the street field. */
export function isQuestionRequired(q: Pick<Question, "key" | "required">, answers: Answers): boolean {
  if (!q.required) return false;
  if (q.key === "address_street" && String(answers.living_arrangement || "").toLowerCase() === "homeless") return false;
  return true;
}

export interface MissingField { key: string; label: string; section?: string }

/** Required items still missing before a client can submit. */
export function missingRequired(answers: Answers, hasClientSignature: boolean): MissingField[] {
  const missing: MissingField[] = [];
  const seen = new Set<string>();
  for (const req of REQUIRED_FOR_SUBMIT) {
    if (!askIfSatisfied(req.when, answers)) continue;
    if (req.key === "address_street" && String(answers.living_arrangement || "").toLowerCase() === "homeless") continue;
    const v = answers[req.key];
    if (req.key === "client_phone_cell" && (answers.client_email || v)) continue;
    if (v === undefined || v === "" || v === false || v === null) {
      missing.push({ key: req.key, label: req.label });
      seen.add(req.key);
    }
  }
  for (const s of SECTIONS) {
    for (const q of s.questions) {
      if (s.key === "welcome" || q.key === "intake_mode" || q.staffOnly || q.type === "info" || q.type === "heading") continue;
      if (!isQuestionRequired(q, answers) || seen.has(q.key) || !askIfSatisfied(q.askIf, answers)) continue;
      const v = answers[q.key];
      if (q.key === "client_phone_cell" && (answers.client_email || v)) continue;
      if (v === undefined || v === "" || v === false || v === null || (Array.isArray(v) && !v.length)) {
        missing.push({ key: q.key, label: q.label, section: s.title });
        seen.add(q.key);
      }
    }
  }
  if (!hasClientSignature) missing.push({ key: "signature", label: "Signature" });
  return missing;
}

/** Every unanswered client-visible question, plus key staff helper blanks, grouped for the staff checklist. */
export function missingOptional(answers: Answers): MissingField[] {
  const out: MissingField[] = [];
  const staffReviewKeys = new Set([
    "record_number", "mid_number", "race", "ethnicity", "marital_status", "employment_status",
    "pcp_name", "pcp_phone", "pcp_address", "preferred_emergency_facility",
    "height", "weight", "ec1_name", "ec1_cell_phone", "staff_receiving_intake",
    "qp_referred_to", "clinician_name", "program_can_meet_needs",
    "initial_screening_date", "admission_date", "official_admission_date",
  ]);
  for (const s of SECTIONS) {
    for (const q of s.questions) {
      // This controls the client questionnaire mode; it is not a packet
      // field staff need to resolve during preflight.
      if (q.key === "intake_mode") continue;
      if (q.staffOnly) continue;
      if (!q.essential && !q.required && !staffReviewKeys.has(q.key)) continue;
      if (q.type === "info" || q.type === "heading") continue;
      if (!askIfSatisfied(q.askIf, answers)) continue;
      const v = answers[q.key];
      if (v === undefined || v === "" || v === null || (Array.isArray(v) && !v.length)) {
        out.push({ key: q.key, label: q.label, section: s.title });
      }
    }
  }
  return out;
}

export function percentComplete(answers: Answers): number {
  let visible = 0, answered = 0;
  for (const s of SECTIONS) {
    for (const q of s.questions) {
      if (q.staffOnly || q.type === "info" || q.type === "heading") continue;
      if (!askIfSatisfied(q.askIf, answers)) continue;
      visible++;
      const v = answers[q.key];
      if (v !== undefined && v !== "" && v !== null && !(Array.isArray(v) && !v.length)) answered++;
    }
  }
  return visible ? Math.round((answered / visible) * 100) : 0;
}

export { questionByKey };
