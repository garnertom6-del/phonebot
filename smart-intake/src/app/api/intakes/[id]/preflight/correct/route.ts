import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { decodeAnswerRows, saveAnswersInTransaction, syncStructuredRowsInTransaction } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { clientUpdateFromAnswers } from "@/lib/clientAnswerSync";
import { AnswerConflictError } from "@/lib/answerRevisions";

class CorrectionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const correctionSchema = z.object({
  findingKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  optionId: z.string().trim().min(1).max(120),
  optionLabel: z.string().trim().min(1).max(180),
  updates: z.array(z.object({
    key: z.string().trim().min(1).max(120),
    sourceKey: z.string().trim().min(1).max(120),
    expectedCurrent: z.string().max(1000),
    proposedValue: z.string().max(1000),
  })).min(1).max(8),
});

function clean(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function targetAllowed(key: string, answers: Record<string, unknown>): boolean {
  if (!questionByKey(key) && !(key in answers)) return false;
  return !(
    /^consent_/i.test(key)
    || /_agreed$/i.test(key)
    || /signature|(^|_)sig($|_)/i.test(key)
  );
}

function sourceValue(
  sourceKey: string,
  answers: Record<string, unknown>,
  client: { fullName: string; dob: string },
): string | null {
  if (sourceKey === "@client.fullName") return clean(client.fullName);
  if (sourceKey === "@client.dob") return clean(client.dob);
  if (sourceKey === "@clear") return "";
  if (!(sourceKey in answers)) return null;
  const value = clean(answers[sourceKey]);
  return value || null;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const parsed = correctionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Choose a valid correction option." }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let updatedFields: string[];
  try {
    updatedFields = await prisma.$transaction(async (tx) => {
      // Keep both the suggestion's target and its source stable through save.
      await tx.intake.update({ where: { id: intake.id }, data: { lastActivityAt: new Date() } });
      const freshIntake = await tx.intake.findUniqueOrThrow({ where: { id: intake.id }, include: { client: true } });
      const rows = await tx.intakeAnswer.findMany({ where: { intakeId: intake.id } });
      const rawAnswers = decodeAnswerRows(rows);
      const currentAnswers = applyOperationalDefaults(rawAnswers);
      const patch: Record<string, string> = {};
      const targetKeys = new Set<string>();
      for (const update of parsed.data.updates) {
        if (!targetAllowed(update.key, currentAnswers) || targetKeys.has(update.key)) {
          throw new CorrectionError("This correction option contains a field that cannot be changed here. Rerun preflight.", 400);
        }
        const current = clean(currentAnswers[update.key]);
        const proposed = sourceValue(update.sourceKey, currentAnswers, freshIntake.client);
        if (current !== update.expectedCurrent || proposed === null || proposed !== update.proposedValue) {
          throw new CorrectionError("The intake changed after this suggestion was created. Rerun preflight before applying it.", 409);
        }
        if (current === proposed) throw new CorrectionError("This correction no longer changes the intake. Rerun preflight.", 409);
        targetKeys.add(update.key);
        patch[update.key] = proposed;
      }
      const saved = await saveAnswersInTransaction(tx, intake.id, patch, {
        expectedAnswerRevisions: Object.fromEntries(rows.map((row) => [row.key, row.revision])),
        requireExpectedRevisions: true,
      });
      const merged = { ...rawAnswers, ...patch };
      await syncStructuredRowsInTransaction(tx, intake.id, merged);
      await tx.client.update({
        where: { id: freshIntake.clientId },
        data: clientUpdateFromAnswers(freshIntake.client, merged, saved.changedKeys),
      });
      await tx.intake.update({ where: { id: intake.id }, data: { status: "NEEDS_REVIEW" } });
      return [...targetKeys];
    });
  } catch (error) {
    if (error instanceof CorrectionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AnswerConflictError) return NextResponse.json(error.toJSON(), { status: 409 });
    throw error;
  }
  await audit("preflight_corrected", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: JSON.stringify({
      findingKey: parsed.data.findingKey,
      optionId: parsed.data.optionId,
      optionLabel: parsed.data.optionLabel,
      updatedFields,
    }),
  });
  return NextResponse.json({ ok: true, updatedFields });
}
