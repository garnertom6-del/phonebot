import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { loadAnswers, loadSignatures, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { answersSchema, missingRequired, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { CLIENT_ANSWER_KEYS } from "@/config/mooreDivineQuestions";

async function findByToken(token: string) {
  const intake = await prisma.intake.findUnique({ where: { token }, include: { client: true, provider: true } });
  if (!intake) return { error: "This link is not valid.", intake: null };
  if (intake.provider && intake.provider.status !== "ACTIVE") {
    return { error: "This link is not valid. Please contact the provider for a new intake link.", intake: null };
  }
  if (intake.tokenExpiresAt < new Date()) {
    return { error: "This link has expired. Please ask Moore Divine Care for a new one (336-285-5204).", intake: null };
  }
  return { error: null, intake };
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { error, intake } = await findByToken(params.token);
  if (error || !intake) return NextResponse.json({ error }, { status: 404 });
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const sigs = await loadSignatures(intake.id);
  if (intake.status === "NOT_STARTED") {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "IN_PROGRESS" } });
  }
  await audit("link_opened", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  const sections = await prisma.intakeSection.findMany({ where: { intakeId: intake.id } });
  return NextResponse.json({
    clientName: intake.client.fullName,
    status: intake.status,
    quick: intake.expectCca,
    answers,
    sectionStatus: Object.fromEntries(sections.map((s) => [s.sectionKey, s.status])),
    signatures: Object.fromEntries(Object.entries(sigs).map(([r, s]) => [r, { printedName: s.printedName, signedDate: s.signedDate }])),
    percentComplete: percentComplete(answers),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const { error, intake } = await findByToken(params.token);
  if (error || !intake) return NextResponse.json({ error }, { status: 404 });
  if (["SIGNED", "COMPLETED"].includes(intake.status)) {
    return NextResponse.json({ error: "This intake was already submitted." }, { status: 400 });
  }
  const body = await req.json();
  if (body.answers) {
    const parsed = answersSchema.safeParse(body.answers);
    if (!parsed.success) return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
    // a client link may only write client-visible questions - never staff fields
    const clientOnly = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => CLIENT_ANSWER_KEYS.has(k)));
    await saveAnswers(intake.id, applyOperationalDefaults(clientOnly));
  }
  if (body.section && ["started", "completed"].includes(body.event)) {
    const now = new Date();
    await prisma.intakeSection.upsert({
      where: { intakeId_sectionKey: { intakeId: intake.id, sectionKey: body.section } },
      create: {
        intakeId: intake.id, sectionKey: body.section,
        status: body.event === "completed" ? "COMPLETED" : "IN_PROGRESS",
        startedAt: now, completedAt: body.event === "completed" ? now : null,
      },
      update: body.event === "completed"
        ? { status: "COMPLETED", completedAt: now }
        : { status: "IN_PROGRESS" },
    });
    await audit(body.event === "completed" ? "section_completed" : "section_started",
      { providerId: intake.providerId || undefined, intakeId: intake.id, detail: body.section });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // final submit
  const { error, intake } = await findByToken(params.token);
  if (error || !intake) return NextResponse.json({ error }, { status: 404 });
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const sigs = await loadSignatures(intake.id);
  const missing = missingRequired(answers, !!(sigs.client || sigs.guardian));
  if (missing.length) {
    return NextResponse.json({ error: "Some required items are missing.", missing }, { status: 400 });
  }
  await saveAnswers(intake.id, answers);
  await syncStructuredRows(intake.id, answers);
  await prisma.intake.update({
    where: { id: intake.id },
    data: { status: sigs.client || sigs.guardian ? "SIGNED" : "SUBMITTED", submittedAt: new Date() },
  });
  await audit("packet_submitted", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
