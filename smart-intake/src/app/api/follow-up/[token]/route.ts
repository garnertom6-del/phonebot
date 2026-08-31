import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { audit } from "@/lib/auditLog";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { clientRecordPatchFromAnswerPatch } from "@/lib/clientAnswerSync";
import {
  clientFollowUpQuestions,
  parseFollowUpFieldKeys,
  validateFollowUpSubmission,
} from "@/lib/clientFollowUp";
import { loadAnswers, saveAnswersInTransaction, syncStructuredRowsInTransaction } from "@/lib/intakeData";
import { prisma } from "@/lib/prisma";
import type { Answers } from "@/lib/fillPdf";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

class FollowUpClosedError extends Error {}

async function findFollowUp(token: string) {
  return prisma.intakeFollowUp.findUnique({
    where: { token },
    include: {
      intake: {
        include: {
          client: true,
          provider: { select: { name: true, phone: true, status: true } },
          signatures: { select: { role: true } },
        },
      },
    },
  });
}

function answersFromRows(rows: Array<{ key: string; value: string }>): Answers {
  const answers: Answers = {};
  for (const row of rows) {
    try {
      answers[row.key] = JSON.parse(row.value);
    } catch {
      answers[row.key] = row.value;
    }
  }
  return answers;
}

function wasSubmittedWithClientSignature(intake: {
  submittedAt: Date | null;
  status: string;
  signatures: Array<{ role: string }>;
}) {
  return !!intake.submittedAt
    && intake.status !== "NOT_STARTED"
    && intake.signatures.some((signature) => (
      signature.role === "client" || signature.role === "guardian"
    ));
}

function unavailableResponse(
  error: string,
  code: string,
  status: number,
  provider?: { name: string; phone: string | null } | null,
) {
  return NextResponse.json({ error, code, provider }, { status, headers: PRIVATE_NO_STORE });
}

export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const followUp = await findFollowUp(params.token);
  if (!followUp) return unavailableResponse("This follow-up link is not valid.", "INVALID_LINK", 404);
  const provider = followUp.intake.provider
    ? { name: followUp.intake.provider.name, phone: followUp.intake.provider.phone }
    : null;
  if (followUp.intake.provider && followUp.intake.provider.status !== "ACTIVE") {
    return unavailableResponse("This provider workspace is temporarily unavailable.", "PROVIDER_INACTIVE", 403, provider);
  }
  if (followUp.status === "COMPLETED") {
    return NextResponse.json({
      completed: true,
      provider,
      savedCount: followUp.savedCount,
      skippedCount: parseFollowUpFieldKeys(followUp.skippedKeys || "[]").length,
    }, { headers: PRIVATE_NO_STORE });
  }
  if (followUp.status === "SUPERSEDED") {
    return unavailableResponse("A newer follow-up link was sent. Use the most recent message from your provider.", "LINK_REPLACED", 410, provider);
  }
  if (followUp.status === "PROCESSING") {
    if (followUp.updatedAt.getTime() < Date.now() - 5 * 60_000) {
      await prisma.intakeFollowUp.updateMany({
        where: {
          id: followUp.id,
          status: "PROCESSING",
          updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
        },
        data: { status: "OPEN" },
      });
    }
    return unavailableResponse("Your answers are being saved. Wait a moment before reopening this link.", "SUBMISSION_IN_PROGRESS", 409, provider);
  }
  if (followUp.tokenExpiresAt < new Date()) {
    return unavailableResponse("This secure follow-up link has expired.", "LINK_EXPIRED", 410, provider);
  }
  if (followUp.intake.status === "COMPLETED" || followUp.intake.archived) {
    return unavailableResponse("This intake is already closed. Contact your provider if you need help.", "INTAKE_CLOSED", 409, provider);
  }
  if (
    !wasSubmittedWithClientSignature(followUp.intake)
  ) {
    return unavailableResponse("The original intake must be signed before this follow-up can be used.", "INTAKE_NOT_SIGNED", 409, provider);
  }
  if (followUp.intake.docusignEnvelopeId) {
    return unavailableResponse("This packet is already in DocuSign. Contact your provider to make a correction.", "DOCUSIGN_ACTIVE", 409, provider);
  }

  const answers = applyOperationalDefaults(await loadAnswers(followUp.intakeId));
  const questions = clientFollowUpQuestions(parseFollowUpFieldKeys(followUp.fieldKeys), answers);
  await audit("follow_up_opened", {
    providerId: followUp.intake.providerId || undefined,
    intakeId: followUp.intakeId,
    ip: req.headers.get("x-forwarded-for") || undefined,
    detail: `${questions.length} unanswered follow-up question${questions.length === 1 ? "" : "s"}`,
  });
  if (!questions.length) {
    await prisma.intakeFollowUp.updateMany({
      where: { id: followUp.id, status: "OPEN" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({ completed: true, provider }, { headers: PRIVATE_NO_STORE });
  }

  return NextResponse.json({
    completed: false,
    provider,
    clientFirstName: followUp.intake.client.fullName.split(/\s+/)[0] || "there",
    questions,
    expiresAt: followUp.tokenExpiresAt,
  }, { headers: PRIVATE_NO_STORE });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const followUp = await findFollowUp(params.token);
  if (!followUp) return unavailableResponse("This follow-up link is not valid.", "INVALID_LINK", 404);
  const provider = followUp.intake.provider
    ? { name: followUp.intake.provider.name, phone: followUp.intake.provider.phone }
    : null;
  if (followUp.intake.provider && followUp.intake.provider.status !== "ACTIVE") {
    return unavailableResponse("This provider workspace is temporarily unavailable.", "PROVIDER_INACTIVE", 403, provider);
  }
  if (followUp.status === "COMPLETED") {
    return unavailableResponse("These follow-up answers were already submitted.", "ALREADY_SUBMITTED", 409, provider);
  }
  if (followUp.status !== "OPEN" || followUp.tokenExpiresAt < new Date()) {
    return unavailableResponse("This follow-up link is no longer active.", "LINK_INACTIVE", 410, provider);
  }
  if (followUp.intake.status === "COMPLETED" || followUp.intake.archived) {
    return unavailableResponse("This intake is already closed. Contact your provider if you need help.", "INTAKE_CLOSED", 409, provider);
  }
  if (!wasSubmittedWithClientSignature(followUp.intake)) {
    return unavailableResponse("The original intake must be signed before this follow-up can be used.", "INTAKE_NOT_SIGNED", 409, provider);
  }
  if (followUp.intake.docusignEnvelopeId) {
    return unavailableResponse("This packet is already in DocuSign. Contact your provider to make a correction.", "DOCUSIGN_ACTIVE", 409, provider);
  }

  const rawAnswers = await loadAnswers(followUp.intakeId);
  const currentAnswers = applyOperationalDefaults(rawAnswers);
  const questions = clientFollowUpQuestions(parseFollowUpFieldKeys(followUp.fieldKeys), currentAnswers);
  if (!questions.length) {
    await prisma.intakeFollowUp.update({
      where: { id: followUp.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true, alreadyAnswered: true }, { headers: PRIVATE_NO_STORE });
  }

  const body = await req.json().catch(() => ({}));
  if (body.attested !== true) {
    return NextResponse.json({
      error: "Confirm that your answers are accurate before sending.",
    }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  const skippedKeys = Array.isArray(body.skippedKeys)
    ? body.skippedKeys.map(String).slice(0, 26)
    : [];
  const submittedAnswerKeys = body.answers
    && typeof body.answers === "object"
    && !Array.isArray(body.answers)
      ? Object.keys(body.answers)
      : [];
  const submittedKeys = new Set([...submittedAnswerKeys, ...skippedKeys]);
  const outstandingKeys = new Set(questions.map((question) => question.key));
  const authorizedQuestions = clientFollowUpQuestions(
    parseFollowUpFieldKeys(followUp.fieldKeys),
    currentAnswers,
    { missingOnly: false },
  );
  const validationQuestions = authorizedQuestions.filter((question) => (
    outstandingKeys.has(question.key) || submittedKeys.has(question.key)
  ));
  const validated = validateFollowUpSubmission(
    validationQuestions,
    body.answers,
    { skippedKeys },
  );
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  const reserved = await prisma.intakeFollowUp.updateMany({
    where: { id: followUp.id, status: "OPEN", tokenExpiresAt: { gt: new Date() } },
    data: { status: "PROCESSING" },
  });
  if (reserved.count !== 1) {
    return unavailableResponse("These answers are already being saved or were submitted.", "SUBMISSION_IN_PROGRESS", 409, provider);
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const locked = await tx.intake.updateMany({
        where: {
          id: followUp.intakeId,
          archived: false,
          status: { not: "COMPLETED" },
          docusignEnvelopeId: null,
        },
        data: { lastActivityAt: now },
      });
      if (locked.count !== 1) {
        throw new FollowUpClosedError("This intake closed while the response was being sent.");
      }
      const currentIntake = await tx.intake.findUnique({
        where: { id: followUp.intakeId },
        include: {
          signatures: { select: { role: true } },
        },
      });
      if (
        !currentIntake
        || !wasSubmittedWithClientSignature(currentIntake)
      ) {
        throw new FollowUpClosedError("The signed intake is no longer available for follow-up.");
      }
      const processing = await tx.intakeFollowUp.findUnique({
        where: { id: followUp.id },
        select: { status: true },
      });
      if (processing?.status !== "PROCESSING") {
        throw new Error("Follow-up reservation was lost.");
      }

      const latestRows = await tx.intakeAnswer.findMany({
        where: { intakeId: followUp.intakeId },
        select: { key: true, value: true },
      });
      const latestRaw = answersFromRows(latestRows);
      const latestAnswers = applyOperationalDefaults(latestRaw);
      const latestQuestions = clientFollowUpQuestions(
        parseFollowUpFieldKeys(followUp.fieldKeys),
        latestAnswers,
      );
      const latestKeys = new Set(latestQuestions.map((question) => question.key));
      const latestInput = Object.fromEntries(
        Object.entries(validated.answers).filter(([key]) => latestKeys.has(key)),
      );
      const latestSkipped = validated.skippedKeys.filter((key) => latestKeys.has(key));
      const latestValidated = validateFollowUpSubmission(
        latestQuestions,
        latestInput,
        { skippedKeys: latestSkipped },
      );
      if (!latestValidated.ok) throw new Error(latestValidated.error);

      await saveAnswersInTransaction(tx, followUp.intakeId, latestValidated.answers, {
        invalidationReason: "Client follow-up answers changed after signature capture.",
      });
      const merged = { ...latestRaw, ...latestValidated.answers };
      await syncStructuredRowsInTransaction(tx, followUp.intakeId, merged);
      const clientPatch = clientRecordPatchFromAnswerPatch(
        merged,
        Object.keys(latestValidated.answers),
      );
      if (Object.keys(clientPatch).length) {
        await tx.client.update({
          where: { id: currentIntake.clientId },
          data: clientPatch,
        });
      }
      const attestation = JSON.stringify({
        version: 1,
        followUpId: followUp.id,
        intakeId: followUp.intakeId,
        attestedAt: now.toISOString(),
        answers: Object.fromEntries(
          Object.entries(latestValidated.answers).sort(([left], [right]) => left.localeCompare(right)),
        ),
        skippedKeys: [...latestValidated.skippedKeys].sort(),
      });
      await tx.intakeFollowUp.update({
        where: { id: followUp.id },
        data: {
          status: "COMPLETED",
          completedAt: now,
          attestedAt: now,
          skippedKeys: JSON.stringify(latestValidated.skippedKeys),
          savedCount: Object.keys(latestValidated.answers).length,
          attestationJson: attestation,
          attestationSha256: crypto.createHash("sha256").update(attestation).digest("hex"),
        },
      });
      return {
        savedCount: Object.keys(latestValidated.answers).length,
        skippedCount: latestValidated.skippedKeys.length,
      };
    });
    await audit("follow_up_completed", {
      providerId: followUp.intake.providerId || undefined,
      intakeId: followUp.intakeId,
      ip: req.headers.get("x-forwarded-for") || undefined,
      detail: `${saved.savedCount} client follow-up answer${saved.savedCount === 1 ? "" : "s"} saved; ${saved.skippedCount} deferred to staff; client attested`,
    });
    return NextResponse.json({
      ok: true,
      savedCount: saved.savedCount,
      skippedCount: saved.skippedCount,
    }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    console.error("client follow-up save failed", error);
    if (error instanceof FollowUpClosedError) {
      await prisma.intakeFollowUp.updateMany({
        where: { id: followUp.id, status: "PROCESSING" },
        data: { status: "SUPERSEDED" },
      });
      return unavailableResponse(
        "This intake was closed or sent to DocuSign before your response finished. Contact your provider.",
        "INTAKE_CLOSED",
        409,
        provider,
      );
    }
    await prisma.intakeFollowUp.updateMany({
      where: { id: followUp.id, status: "PROCESSING" },
      data: { status: "OPEN" },
    });
    return NextResponse.json({
      error: "Your answers could not be saved. Please try again.",
    }, { status: 500, headers: PRIVATE_NO_STORE });
  }
}
