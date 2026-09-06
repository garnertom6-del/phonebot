export type BatchFailure = { row: number; clientName?: string; error: string };

/** API failure rows refer to the nonempty submitted rows, not the visible grid. */
export function batchRetryDrafts<T>(
  drafts: T[],
  submittedRowIndexes: number[],
  failures: BatchFailure[],
  blank: () => T,
): { drafts: T[]; failures: BatchFailure[] } {
  const failedIndexes = new Set(failures.map((failure) => submittedRowIndexes[failure.row - 1]));
  const submittedIndexes = new Set(submittedRowIndexes);
  return {
    drafts: drafts.map((draft, index) => (
      submittedIndexes.has(index) && !failedIndexes.has(index) ? blank() : draft
    )),
    failures: failures.map((failure) => ({
      ...failure,
      row: (submittedRowIndexes[failure.row - 1] ?? (failure.row - 1)) + 1,
    })),
  };
}
