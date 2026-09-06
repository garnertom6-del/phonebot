import type { Answers } from "./fillPdf";
import { normalizeDateInput } from "./normalizeDateInput";

interface ClientContactLike {
  fullName: string;
  dob?: string;
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

/** Only write supplied fields; stale copies of the Client must not restore contacts. */
export function clientUpdateFromAnswers(
  _current: ClientContactLike,
  answers: Answers,
  changedKeys: Iterable<string> = Object.keys(answers),
): Partial<ClientContactLike> {
  return clientRecordPatchFromAnswerPatch(answers, changedKeys);
}

export function clientRecordPatchFromAnswerPatch(
  answers: Answers,
  changedKeys: Iterable<string>,
): Partial<ClientContactLike> {
  const changed = new Set(changedKeys);
  const patch: Partial<ClientContactLike> = {};
  const copy = (answerKey: string, recordKey: keyof ClientContactLike) => {
    if (!changed.has(answerKey) || !Object.prototype.hasOwnProperty.call(answers, answerKey)) return;
    const value = clean(answers[answerKey]);
    if (value) patch[recordKey] = value;
  };

  copy("client_full_name", "fullName");
  copy("mid_number", "midNumber");
  copy("record_number", "recordNumber");
  // Empty optional contacts are explicit removals, not a fallback to old data.
  for (const [answerKey, recordKey] of [
    ["client_email", "email"],
    ["guardian_name", "guardianName"],
    ["guardian_email", "guardianEmail"],
    ["guardian_phone", "guardianPhone"],
  ] as const) {
    if (changed.has(answerKey) && typeof answers[answerKey] === "string") {
      patch[recordKey] = clean(answers[answerKey]) || null;
    }
  }

  if (changed.has("dob")) {
    const dob = normalizeDateInput(answers.dob);
    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (dob && new Date(`${dob}T00:00:00Z`).getTime() <= todayUtc) patch.dob = dob;
  }

  if (["client_phone_cell", "client_phone_home"].some((key) => (
    changed.has(key) && typeof answers[key] === "string"
  ))) {
    // Callers supply the merged answer snapshot, so removing a cell number
    // can still select an unchanged home number instead of reviving the cell.
    const phone = clean(answers.client_phone_cell) || clean(answers.client_phone_home);
    patch.phone = phone || null;
  }
  return patch;
}
