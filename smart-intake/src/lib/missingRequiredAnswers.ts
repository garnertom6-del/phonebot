export type RequiredFieldGap = {
  key: string;
  label: string;
  section?: string;
};

/** Answers still missing for packet completeness. Signature has its own case-page section. */
export function missingRequiredAnswers<T extends RequiredFieldGap>(fields: T[]): T[] {
  return fields.filter((field) => field.key !== "signature");
}

export function missingRequiredAnswerCount(fields: RequiredFieldGap[]): number {
  return missingRequiredAnswers(fields).length;
}
