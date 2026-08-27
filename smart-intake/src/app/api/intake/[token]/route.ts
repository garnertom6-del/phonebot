import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import {
  decodeAnswerRows,
  loadAnswers,
  loadSignatures,
  saveAnswersInTransaction,
  syncStructuredRowsInTransaction,
} from "@/lib/intakeData";
import { answersSchema, missingRequired, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { CLIENT_ANSWER_KEYS } from "@/config/mooreDivineQuestions";
import { providerDisplayName, providerPhone } from "@/lib/providerBranding";
import { clientUpdateFromAnswers } from "@/lib/clientAnswerSync";
import type { Answers } from "@/lib/fillPdf";
import {
  clientSubmissionFinished,
  lockOpenClientIntake,
} from "@/lib/clientSubmissionState";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

class IntakeClosedError extends Error {}

class MissingSubmitFieldsError extends Error {
  constructor(readonly missing: ReturnType<typeof missingRequired>) {
    super("Some required items are missing.");
  }
}

async function findByToken(token: string) {
  const intake = await prisma.intake.findUnique({
    where: { token },
    include: {
      client: true,
      provider: true,
      signatures: { select: { role: true } },
    },
  });
  if (!intake) {
    return {
      error: "This link is not valid.",
      code: "INVALID_LINK",
      provider: null,
      intake: null,
    };
  }
  const supportPhone = providerPhone(intake.provider?.phone, intake.provider?.name);
  const provider = {
    name: providerDisplayName(intake.provider?.name),
    phone: supportPhone.replace(/\D/g, "").length >= 7 ? supportPhone : null,
  };
  if (intake.provider && intake.provider.status !== "ACTIVE") {
    return {
      error: "This provider workspace is temporarily unavailable.",
      code: "PROVIDER_INACTIVE",
      provider,
      intake: null,
    };
  }
  if (clientSubmissionFinished(intake)) {
    return {
      error: "This intake has already been submitted.",
      code: "INTAKE_FINISHED",
      provider,
      intake: null,
    };
  }
  if (intake.tokenExpiresAt < new Date()) {
    return {
      error: "This secure link has expired.",
      code: "LINK_EXPIRED",
      provider,
      intake: null,
    };
  }
  return { error: null, code: null, provider, intake };
}

function lookupStatus(code: string | null): number {
  if (code === "LINK_EXPIRED") return 410;
  if (code === "INTAKE_FINISHED") return 409;
  if (code === "PROVIDER_INACTIVE") return 403;
  return 404;
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { error, code, provider, intake } = await findByToken(params.token);
  if (error || !intake) {
    return NextResponse.json(
      { error, code, provider },
      { status: lookupStatus(code), headers: PRIVATE_NO_STORE },
    );
  }
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const sigs = await loadSignatures(intake.id);
  if (intake.status === "NOT_STARTED") {
    await prisma.intake.updateMany({
      where: { id: intake.id, status: "NOT_STARTED", submittedAt: null },
      data: { status: "IN_PROGRESS" },
    });
  }
  await audit("link_opened", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  const sections = await prisma.intakeSection.findMany({ where: { intakeId: intake.id } });
  return NextResponse.json(
    {
      clientName: intake.client.fullName,
      provider: {
        name: intake.provider?.name || null,
        phone: intake.provider?.phone || null,
      },
      status: intake.status,
      quick: intake.expectCca,
      answers,
      sectionStatus: Object.fromEntries(sections.map((s) => [s.sectionKey, s.status])),
      signatures: Object.fromEntries(Object.entries(sigs).map(([r, s]) => [r, { printedName: s.printedName, signedDate: s.signedDate }])),
      percentComplete: percentComplete(answers),
    },
    { headers: PRIVATE_NO_STORE },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const { error, code, provider, intake } = await findByToken(params.token);
  if (error || !intake) {
    return NextResponse.json({ error, code, provider }, { status: lookupStatus(code) });
  }
  if (["SIGNED", "COMPLETED"].includes(intake.status)) {
    return NextResponse.json({ error: "This intake was already submitted." }, { status: 400 });
  }
  const body = await req.json();
  let answerPatch: Answers | null = null;
  if (body.answers) {
    const parsed = answersSchema.safeParse(body.answers);
    if (!parsed.success) return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
    // a client link may only write client-visible questions - never staff fields
    answerPatch = Object.fromEntries(
      Object.entries(parsed.data).filter(([k]) => CLIENT_ANSWER_KEYS.has(k)),
    ) as Answers;
  }
  const sectionEvent = body.section && ["started", "completed"].includes(body.event)
    ? { section: String(body.section), event: body.event as "started" | "completed" }
    : null;
  try {
    await prisma.$transaction(async (tx) => {
      if (!await lockOpenClientIntake(tx, intake.id)) throw new IntakeClosedError();
      const current = await tx.intake.findUnique({
        where: { id: intake.id },
        include: { client: true },
      });
      if (!current) throw new IntakeClosedError();
      if (answerPatch) {
        await saveAnswersInTransaction(tx, intake.id, answerPatch);
        await tx.client.update({
          where: { id: current.clientId },
          data: clientUpdateFromAnswers(current.client, answerPatch),
        });
      }
      if (sectionEvent) {
        const now = new Date();
        await tx.intakeSection.upsert({
          where: { intakeId_sectionKey: { intakeId: intake.id, sectionKey: sectionEvent.section } },
          create: {
            intakeId: intake.id,
            sectionKey: sectionEvent.section,
            status: sectionEvent.event === "completed" ? "COMPLETED" : "IN_PROGRESS",
            startedAt: now,
            completedAt: sectionEvent.event === "completed" ? now : null,
          },
          update: sectionEvent.event === "completed"
            ? { status: "COMPLETED", completedAt: now }
            : { status: "IN_PROGRESS" },
        });
      }
    });
  } catch (error) {
    if (error instanceof IntakeClosedError) {
      return NextResponse.json({
        error: "This intake was submitted while your changes were saving. The signed record was not changed.",
      }, { status: 409 });
    }
    throw error;
  }
  if (sectionEvent) {
    await audit(body.event === "completed" ? "section_completed" : "section_started",
      { providerId: intake.providerId || undefined, intakeId: intake.id, detail: body.section });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  // final submit
  const { error, code, provider, intake } = await findByToken(params.token);
  if (error || !intake) {
    return NextResponse.json({ error, code, provider }, { status: lookupStatus(code) });
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (!await lockOpenClientIntake(tx, intake.id)) throw new IntakeClosedError();
      const current = await tx.intake.findUnique({
        where: { id: intake.id },
        include: {
          client: true,
          signatures: { select: { role: true } },
        },
      });
      if (!current) throw new IntakeClosedError();
      const answerRows = await tx.intakeAnswer.findMany({
        where: { intakeId: intake.id },
        select: { key: true, value: true },
      });
      const answers = applyOperationalDefaults(decodeAnswerRows(answerRows));
      const hasSignature = current.signatures.some((signature) => (
        signature.role === "client" || signature.role === "guardian"
      ));
      const missing = missingRequired(answers, hasSignature, intake.provider);
      if (missing.length) throw new MissingSubmitFieldsError(missing);
      await saveAnswersInTransaction(tx, intake.id, answers);
      await syncStructuredRowsInTransaction(tx, intake.id, answers);
      await tx.client.update({
        where: { id: current.clientId },
        data: clientUpdateFromAnswers(current.client, answers),
      });
      await tx.intake.update({
        where: { id: intake.id },
        data: {
          status: hasSignature ? "SIGNED" : "SUBMITTED",
          submittedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (error instanceof MissingSubmitFieldsError) {
      return NextResponse.json({
        error: error.message,
        missing: error.missing,
      }, { status: 400 });
    }
    if (error instanceof IntakeClosedError) {
      return NextResponse.json({
        error: "This intake was already submitted.",
      }, { status: 409 });
    }
    throw error;
  }
  await audit("packet_submitted", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
