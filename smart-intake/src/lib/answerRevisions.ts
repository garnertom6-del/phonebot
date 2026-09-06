export type AnswerRevisions = Record<string, number>;
export type AnswerConflict = { key: string; serverValue: unknown; serverRevision: number; localValue?: unknown };

export class AnswerConflictError extends Error {
  readonly code = "ANSWER_CONFLICT";
  constructor(readonly conflicts: AnswerConflict[]) {
    super("Some answers changed in another window. Choose which version to keep, then retry saving.");
  }
  toJSON() {
    return { code: this.code, error: this.message, conflicts: this.conflicts };
  }
}

export function revisionsForKeys(revisions: AnswerRevisions, keys: Iterable<string>): AnswerRevisions {
  return Object.fromEntries([...keys].map((key) => [key, revisions[key] ?? 0]));
}

export function findAnswerConflicts(
  answers: Record<string, unknown>,
  rows: Array<{ key: string; value: string; revision: number }>,
  expected: unknown,
): AnswerConflict[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const hasExpectedMap = !!expected && typeof expected === "object" && !Array.isArray(expected);
  const expectedMap = hasExpectedMap ? expected as Record<string, unknown> : {};
  return Object.entries(answers).flatMap(([key, value]) => {
    const row = byKey.get(key);
    const revision = row?.revision ?? 0;
    const supplied = hasExpectedMap ? expectedMap[key] ?? 0 : undefined;
    const valid = typeof supplied === "number" && Number.isSafeInteger(supplied) && supplied >= 0;
    // Equal values may be an idempotent retry after a lost success response.
    if (valid && (supplied === revision || row?.value === JSON.stringify(value))) return [];
    let serverValue: unknown = "";
    if (row) { try { serverValue = JSON.parse(row.value); } catch { serverValue = row.value; } }
    return [{ key, serverValue, serverRevision: revision, localValue: value }];
  });
}
