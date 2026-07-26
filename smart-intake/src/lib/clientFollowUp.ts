import {
  CLIENT_ANSWER_KEYS,
  questionByKey,
  type QType,
  type Question,
} from "@/config/mooreDivineQuestions";
import { askIfSatisfied } from "@/lib/validation";
const FOLLOW_UP_TYPES = new Set<QType>([
  "text",
  "textarea",
  "date",
  "phone",
  "email",
  "number",
  "radio",
  "chips",
  "yesno",
  "survey",
]);
const FOLLOW_UP_ALLOWED_KEYS = new Set([
  "mid_number",
  "client_email",
  "gender",
  "race",
  "ethnicity",
  "marital_status",
  "address_street",
  "address_city",
  "address_state",
  "client_phone_cell",
  "employment_status",
  "presenting_problem",
  "is_minor_or_incompetent",
  "guardian_name",
  "guardian_phone",
  "ec1_name",
  "ec1_cell_phone",
  "pcp_name",
  "pcp_phone",
  "pcp_address",
  "preferred_emergency_facility",
  "height",
  "weight",
]);
const FOLLOW_UP_BLOCKED_KEYS = new Set([
  // This yes/no is part of the signed HIPAA acknowledgment, even though the
  // original questionnaire renders it as a normal choice.
  "hipaa_understood",
]);

export type ClientFollowUpQuestion = {
  key: string;
  label: string;
  type: QType;
  options?: string[];
  placeholder?: string;
  help?: string;
};

export function isBlankFollowUpValue(value: unknown): boolean {
  return value == null
    || value === ""
    || (typeof value === "string" && !value.trim())
    || (Array.isArray(value) && value.length === 0);
}

export function parseFollowUpFieldKeys(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.map(String).filter(Boolean))].slice(0, 25)
      : [];
  } catch {
    return [];
  }
}

function questionOptions(question: Question): string[] | undefined {
  if (question.options?.length) return question.options;
  if (question.type === "survey") return ["1", "2", "3"];
  return undefined;
}

export function clientFollowUpQuestions(
  fieldKeys: string[],
  answers: Record<string, unknown>,
  options: { missingOnly?: boolean } = { missingOnly: true },
): ClientFollowUpQuestion[] {
  const seen = new Set<string>();
  const questions: ClientFollowUpQuestion[] = [];
  for (const key of fieldKeys.slice(0, 50)) {
    if (seen.has(key) || !CLIENT_ANSWER_KEYS.has(key)) continue;
    const question = questionByKey(key);
    if (
      !question
      || !FOLLOW_UP_ALLOWED_KEYS.has(question.key)
      || question.staffOnly
      || question.type === "consent"
      || FOLLOW_UP_BLOCKED_KEYS.has(question.key)
      || !FOLLOW_UP_TYPES.has(question.type)
      || !askIfSatisfied(question.askIf, answers)
      || (options.missingOnly !== false && !isBlankFollowUpValue(answers[key]))
    ) {
      continue;
    }
    seen.add(key);
    questions.push({
      key,
      label: question.label,
      type: question.type,
      options: questionOptions(question),
      placeholder: question.placeholder,
      help: question.help,
    });
    if (questions.length >= 25) break;
  }
  return questions;
}

type FollowUpAnswer = string | boolean | number | string[];

function normalizeAnswer(question: ClientFollowUpQuestion, value: unknown): FollowUpAnswer | null {
  if (question.type === "chips") {
    if (!Array.isArray(value) || !value.length || value.length > 20) return null;
    const selected = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
    if (!selected.length || selected.some((item) => !question.options?.includes(item))) return null;
    return selected;
  }

  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text = String(value).trim();
  if (!text || text.length > 4000) return null;

  if (["radio", "yesno", "survey"].includes(question.type)) {
    return question.options?.includes(text) ? text : null;
  }
  if (question.type === "number" && !Number.isFinite(Number(text))) return null;
  if (question.type === "phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return null;
  }
  if (question.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  if (question.type === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const date = match ? new Date(`${text}T00:00:00.000Z`) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  }
  return text;
}

export function validateFollowUpSubmission(
  questions: ClientFollowUpQuestion[],
  payload: unknown,
  options: { skippedKeys?: string[] } = {},
): { ok: true; answers: Record<string, FollowUpAnswer>; skippedKeys: string[] } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Answer each requested question before sending." };
  }
  const input = payload as Record<string, unknown>;
  const allowed = new Set(questions.map((question) => question.key));
  const skippedKeys = [...new Set((options.skippedKeys || []).map(String).filter(Boolean))];
  if (skippedKeys.length > questions.length || skippedKeys.some((key) => !allowed.has(key))) {
    return { ok: false, error: "Only requested questions can be deferred to staff." };
  }
  const skipped = new Set(skippedKeys);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, error: "This link can only update the questions requested by your provider." };
  }

  const answers: Record<string, FollowUpAnswer> = {};
  for (const question of questions) {
    if (skipped.has(question.key)) {
      if (question.key in input && !isBlankFollowUpValue(input[question.key])) {
        return { ok: false, error: `Choose either an answer or staff follow-up for: ${question.label}` };
      }
      continue;
    }
    const normalized = normalizeAnswer(question, input[question.key]);
    if (normalized == null) {
      return { ok: false, error: `Please enter a valid answer for: ${question.label}` };
    }
    answers[question.key] = normalized;
  }
  return { ok: true, answers, skippedKeys };
}
