import type { Answers } from "./fillPdf";

interface ClientContactLike {
  fullName: string;
  midNumber?: string | null;
  recordNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  guardianName?: string | null;
  guardianEmail?: string | null;
  guardianPhone?: string | null;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function answeredClientFields(answers: Answers) {
  return {
    fullName: clean(answers.client_full_name),
    midNumber: clean(answers.mid_number),
    recordNumber: clean(answers.record_number),
    email: clean(answers.client_email),
    phone: clean(answers.client_phone_cell) || clean(answers.client_phone_home),
    guardianName: clean(answers.guardian_name),
    guardianEmail: clean(answers.guardian_email),
    guardianPhone: clean(answers.guardian_phone),
  };
}

export function clientUpdateFromAnswers(current: ClientContactLike, answers: Answers) {
  const answered = answeredClientFields(answers);
  return {
    fullName: answered.fullName || current.fullName,
    midNumber: answered.midNumber || current.midNumber,
    recordNumber: answered.recordNumber || current.recordNumber,
    email: answered.email || current.email,
    phone: answered.phone || current.phone,
    guardianName: answered.guardianName || current.guardianName,
    guardianEmail: answered.guardianEmail || current.guardianEmail,
    guardianPhone: answered.guardianPhone || current.guardianPhone,
  };
}
