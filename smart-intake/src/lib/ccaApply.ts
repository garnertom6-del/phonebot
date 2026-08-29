import { prisma } from "./prisma";
import { applyOperationalDefaults } from "./answerDefaults";
import { mergeCcaAnswers } from "./ccaExtract";
import type { Answers } from "./fillPdf";
import { loadAnswers, nonMaterialAnswerKeys, saveAnswers, syncStructuredRows } from "./intakeData";
import { questionByKey } from "./validation";

export class CcaSignaturesWouldInvalidateError extends Error {
  code = "SIGNATURES_WOULD_INVALIDATE" as const;
  signatureCount: number;
  changedCount: number;

  constructor(signatureCount: number, changedCount: number) {
    super(
      `Applying these CCA answers would require re-signing ${signatureCount} captured signature${signatureCount === 1 ? "" : "s"}. Confirm to continue.`,
    );
    this.name = "CcaSignaturesWouldInvalidateError";
    this.signatureCount = signatureCount;
    this.changedCount = changedCount;
  }
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function materialCcaChanges(
  current: Answers,
  next: Answers,
): string[] {
  const ignored = new Set(nonMaterialAnswerKeys());
  return Object.keys(next).filter((key) => (
    !ignored.has(key) && !jsonEqual(current[key], next[key])
  ));
}

export async function applyCcaAnswers(opts: {
  intakeId: string;
  clientId: string;
  currentMid?: string | null;
  currentRecord?: string | null;
  currentPhone?: string | null;
  currentEmail?: string | null;
  extracted: Answers;
  overwrite: boolean;
  confirmInvalidateSignatures?: boolean;
}): Promise<{
  filled: string[];
  skipped: string[];
  signaturesInvalidated: boolean;
  filledLabels: string[];
  skippedLabels: string[];
}> {
  const current = await loadAnswers(opts.intakeId);
  const { merged, filled, skipped } = mergeCcaAnswers(current, opts.extracted, opts.overwrite);
  const withDefaults = applyOperationalDefaults({ ...current, ...merged });
  const ccaDate = opts.extracted.cca_assessment_date;
  if (typeof ccaDate === "string" && ccaDate.trim()) {
    for (const key of ["assess_date", "initial_assessment_date"]) {
      withDefaults[key] = ccaDate;
      if (!filled.includes(key)) filled.push(key);
    }
  }
  const materialKeys = materialCcaChanges(current, withDefaults);
  const capturedSignatures = await prisma.signature.count({
    where: { intakeId: opts.intakeId, invalidatedAt: null },
  });
  if (capturedSignatures && materialKeys.length && !opts.confirmInvalidateSignatures) {
    throw new CcaSignaturesWouldInvalidateError(capturedSignatures, materialKeys.length);
  }

  let signaturesInvalidated = false;
  if (filled.length) {
    const saved = await saveAnswers(opts.intakeId, withDefaults);
    signaturesInvalidated = saved.signaturesInvalidated;
    await syncStructuredRows(opts.intakeId, await loadAnswers(opts.intakeId));
    await prisma.client.update({
      where: { id: opts.clientId },
      data: {
        midNumber: typeof withDefaults.mid_number === "string" && withDefaults.mid_number.trim()
          ? withDefaults.mid_number.trim()
          : opts.currentMid,
        recordNumber: typeof withDefaults.record_number === "string" && withDefaults.record_number.trim()
          ? withDefaults.record_number.trim()
          : opts.currentRecord,
        phone: typeof withDefaults.client_phone_cell === "string" && withDefaults.client_phone_cell.trim()
          ? withDefaults.client_phone_cell.trim()
          : opts.currentPhone,
        email: typeof withDefaults.client_email === "string" && withDefaults.client_email.trim()
          ? withDefaults.client_email.trim()
          : opts.currentEmail,
      },
    });
  }
  const label = (key: string) => questionByKey(key)?.label || key;
  return {
    filled,
    skipped,
    signaturesInvalidated,
    filledLabels: filled.map(label).slice(0, 60),
    skippedLabels: skipped.map(label).slice(0, 30),
  };
}
