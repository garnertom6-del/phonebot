import { canGenerateRecordNumber, makeRecordNumber } from "./insurancePlans";

/** Use a row's own plan; a batch default applies only to rows without a plan. */
export function generateBatchRecordNumbers<T extends { providerChoicePlan: string; recordNumber: string }>(
  rows: T[],
  fallbackPlan: string,
  isActive: (row: T) => boolean,
  generate: (plan: string) => string = makeRecordNumber,
) {
  const used = new Set(rows.map((row) => row.recordNumber.trim().toLowerCase()).filter(Boolean));
  const manualRows: number[] = [];
  const missingPlanRows: number[] = [];
  const failedRows: number[] = [];
  let generatedCount = 0;
  const updatedRows = rows.map((row, index) => {
    if (!isActive(row) || row.recordNumber.trim()) return row;
    const plan = row.providerChoicePlan.trim() || fallbackPlan.trim();
    if (!plan) { missingPlanRows.push(index + 1); return row; }
    if (!canGenerateRecordNumber(plan)) { manualRows.push(index + 1); return row; }
    for (let attempt = 0; attempt < 50; attempt++) {
      const recordNumber = generate(plan);
      if (used.has(recordNumber.trim().toLowerCase())) continue;
      used.add(recordNumber.trim().toLowerCase());
      generatedCount++;
      return { ...row, providerChoicePlan: row.providerChoicePlan || plan, recordNumber };
    }
    failedRows.push(index + 1);
    return row;
  });
  return { rows: updatedRows, generatedCount, manualRows, missingPlanRows, failedRows };
}
