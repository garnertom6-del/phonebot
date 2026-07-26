import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
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

  const rawAnswers = await loadAnswers(intake.id);
  const currentAnswers = applyOperationalDefaults(rawAnswers);
  const patch: Record<string, string> = {};
  const targetKeys = new Set<string>();
  for (const update of parsed.data.updates) {
    if (!targetAllowed(update.key, currentAnswers) || targetKeys.has(update.key)) {
      return NextResponse.json({ error: "This correction option contains a field that cannot be changed here. Rerun preflight." }, { status: 400 });
    }
    const current = clean(currentAnswers[update.key]);
    const proposed = sourceValue(update.sourceKey, currentAnswers, intake.client);
    if (current !== update.expectedCurrent || proposed === null || proposed !== update.proposedValue) {
      return NextResponse.json({ error: "The intake changed after this suggestion was created. Rerun preflight before applying it." }, { status: 409 });
    }
    if (current === proposed) {
      return NextResponse.json({ error: "This correction no longer changes the intake. Rerun preflight." }, { status: 409 });
    }
    targetKeys.add(update.key);
    patch[update.key] = proposed;
  }

  const merged = { ...rawAnswers, ...patch };
  await saveAnswers(intake.id, merged);
  await syncStructuredRows(intake.id, merged);

  const clientPatch: Record<string, string | null> = {};
  if ("mid_number" in patch) clientPatch.midNumber = clean(patch.mid_number) || null;
  if ("record_number" in patch) clientPatch.recordNumber = clean(patch.record_number) || null;
  if ("client_email" in patch) clientPatch.email = clean(patch.client_email) || null;
  if ("client_phone_cell" in patch) clientPatch.phone = clean(patch.client_phone_cell) || null;
  if ("guardian_name" in patch) clientPatch.guardianName = clean(patch.guardian_name) || null;
  if ("guardian_email" in patch) clientPatch.guardianEmail = clean(patch.guardian_email) || null;
  if ("guardian_phone" in patch) clientPatch.guardianPhone = clean(patch.guardian_phone) || null;
  if (Object.keys(clientPatch).length) {
    await prisma.client.update({ where: { id: intake.clientId }, data: clientPatch });
  }
  await prisma.intake.update({ where: { id: intake.id }, data: { status: "NEEDS_REVIEW" } });
  await audit("preflight_corrected", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: JSON.stringify({
      findingKey: parsed.data.findingKey,
      optionId: parsed.data.optionId,
      optionLabel: parsed.data.optionLabel,
      updatedFields: [...targetKeys],
    }),
  });
  return NextResponse.json({ ok: true, updatedFields: [...targetKeys] });
}
