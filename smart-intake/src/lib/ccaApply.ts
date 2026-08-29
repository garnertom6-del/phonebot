import { prisma } from "./prisma";
import { applyOperationalDefaults } from "./answerDefaults";
import { mergeCcaAnswers } from "./ccaExtract";
import type { Answers } from "./fillPdf";
import { loadAnswers, nonMaterialAnswerKeys, saveAnswers, syncStructuredRows } from "./intakeData";
import { questionByKey } from "./validation";
import { formatDateForPeople, normalizeDateInput } from "./normalizeDateInput";

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
    // assess_date is printed text; initial_assessment_date is a date box that
    // only shows YYYY-MM-DD, so each gets the shape it can display
    const ccaIso = normalizeDateInput(ccaDate);
    withDefaults.assess_date = formatDateForPeople(ccaDate) || ccaDate;
    if (!filled.includes("assess_date")) filled.push("assess_date");
    if (ccaIso) {
      withDefaults.initial_assessment_date = ccaIso;
      if (!filled.includes("initial_assessment_date")) filled.push("initial_assessment_date");
    }
  }
  // Only values the CCA actually brings in get saved (the `filled` list). Count a
  // change as material only when it is one of those keys, so a re-scan that adds
  // nothing new does not prompt to re-sign for a no-op.
  const filledSet = new Set(filled);
  const materialKeys = materialCcaChanges(current, withDefaults).filter((key) => filledSet.has(key));
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
