import { SECTIONS, type Question } from "@/config/mooreDivineQuestions";
import type { Answers } from "./fillPdf";

export const AUTO_SEND_COMPLETED_COPIES_KEY = "auto_send_completed_copies";
export const COPY_ALLOWED_STATUSES = ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"];
export const COPY_RECEIPT_ANSWER_DEFAULTS = {
  hipaa_copy: "Yes",
  welcome_letter_ack: "Yes",
} as const;

export interface CompletedCopyQuestion {
  key: string;
  label: string;
  type: Question["type"];
  help?: string;
  placeholder?: string;
  options?: string[];
  consentText?: string;
  clientAnswer?: string;
}

export interface CompletedCopySection {
  key: string;
  title: string;
  intro?: string;
  questions: CompletedCopyQuestion[];
}

function answerText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.length ? value.join(", ") : undefined;
  if (typeof value === "boolean") return value ? "Yes / agreed" : "No";
  return String(value);
}

function hasVisibleWriting(q: Question): boolean {
  return Boolean(q.label || q.help || q.placeholder || q.options?.length || q.consentText);
}

export function buildCompletedCopySections(answers: Answers): CompletedCopySection[] {
  return SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    intro: section.intro,
    questions: section.questions
      .filter((q) => !q.staffOnly && hasVisibleWriting(q))
      .map((q) => ({
        key: q.key,
        label: q.label,
        type: q.type,
        help: q.help,
        placeholder: q.placeholder,
        options: q.options,
        consentText: q.consentText,
        clientAnswer: answerText(answers[q.key]),
      })),
  })).filter((section) => section.intro || section.questions.length);
}

export function autoSendCompletedCopiesEnabled(answers: Answers): boolean {
  return answers[AUTO_SEND_COMPLETED_COPIES_KEY] !== false;
}
