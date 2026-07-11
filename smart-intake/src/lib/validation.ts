import { z } from "zod";
import { REQUIRED_FOR_SUBMIT, SECTIONS, questionByKey, type AskIf } from "@/config/mooreDivineQuestions";
import type { Answers } from "./fillPdf";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const newIntakeSchema = z.object({
  fullName: z.string().min(1, "Client full name is required"),
  dob: z.string().min(1, "DOB is required"),
  midNumber: z.string().optional().default(""),
  recordNumber: z.string().min(1, "Record # is required"),
  intakeDate: z.string().optional().default(""),
  location: z.string().optional().default(""),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().default(""),
  guardianName: z.string().optional().default(""),
  guardianEmail: z.string().email().optional().or(z.literal("")),
  guardianPhone: z.string().optional().default(""),
  expectCca: z.boolean().optional(),
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

export interface MissingField { key: string; label: string; section?: string }

/** Required items still missing before a client can submit. */
export function missingRequired(answers: Answers, hasClientSignature: boolean): MissingField[] {
  const missing: MissingField[] = [];
  const seen = new Set<string>();
  for (const req of REQUIRED_FOR_SUBMIT) {
    if (!askIfSatisfied(req.when, answers)) continue;
    const v = answers[req.key];
    if (req.key === "client_phone_cell" && (answers.client_email || v)) continue;
    if (v === undefined || v === "" || v === false || v === null) {
      missing.push({ key: req.key, label: req.label });
      seen.add(req.key);
    }
  }
  for (const s of SECTIONS) {
    for (const q of s.questions) {
      if (s.key === "welcome" || q.key === "intake_mode") continue;
      if (!q.required || seen.has(q.key) || !askIfSatisfied(q.askIf, answers)) continue;
      const v = answers[q.key];
      if (v === undefined || v === "" || v === false || v === null || (Array.isArray(v) && !v.length)) {
        missing.push({ key: q.key, label: q.label, section: s.title });
        seen.add(q.key);
      }
    }
  }
  if (!hasClientSignature) missing.push({ key: "signature", label: "Signature" });
  return missing;
}

/** Every unanswered (visible) question, grouped for the staff checklist. */
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
