import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { attachSelectedProviderCookie, requireStaffForIntake, requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, saveAnswersInTransaction, syncStructuredRows } from "@/lib/intakeData";
import { answersSchema, clientDetailsSchema, missingRequired, missingOptional, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { clientUpdateFromAnswers } from "@/lib/clientAnswerSync";
import { buildSignatureStatuses } from "@/lib/signatureStatus";
import { clientCcaAttestationReady, parseCcaReview } from "@/lib/ccaReview";
import { completionReadinessForIntake } from "@/lib/completionReadiness";
import { clientLinkRenewalData } from "@/lib/tokens";
import { clientDetailsAnswerPatch, clientDetailsRecordPatch } from "@/lib/clientDetails";
import { parseFollowUpFieldKeys } from "@/lib/clientFollowUp";
import { providerPacketReadiness } from "@/lib/providerPacketTemplates";
import { generationReadinessForIntake } from "@/lib/generationReadiness";
import { packetFreshnessForIntake } from "@/lib/packetFreshness";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { provider, deny } = await requireStaffForIntake(params.id);
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      provider: { select: { name: true, phone: true } },
      client: true,
      // never ship signature image blobs or server file paths to the browser
      signatures: {
        select: {
          role: true,
          printedName: true,
          signedDate: true,
          relationship: true,
          contentRevision: true,
          subjectNameSnapshot: true,
          subjectDobSnapshot: true,
          invalidatedAt: true,
          invalidatedReason: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      uploadedDocuments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, docType: true, fileName: true, createdAt: true, reviewJson: true },
      },
      generatedPdfs: {
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, sha256: true, packetVersion: true, contentRevision: true },
      },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, event: true, detail: true, createdAt: true } },
      followUps: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          token: true,
          fieldKeys: true,
          status: true,
          recipientRole: true,
          tokenExpiresAt: true,
          sentAt: true,
          completedAt: true,
          attestedAt: true,
          skippedKeys: true,
          savedCount: true,
          createdAt: true,
        },
      },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const [generationReadiness, packetFreshness] = await Promise.all([
    generationReadinessForIntake(intake.id, provider!.id),
    packetFreshnessForIntake(intake.id),
  ]);
  const signed = generationReadiness?.signatureStatuses.some((status) => (
    status.key === "client_guardian" && status.state === "captured"
  )) || false;
  const base = appBaseUrl(_req);
  const uploadedDocuments = intake.uploadedDocuments.map((document) => ({
    id: document.id,
    docType: document.docType,
    fileName: document.fileName,
    createdAt: document.createdAt,
    ccaReview: parseCcaReview(document.reviewJson),
  }));
  const latestCca = intake.uploadedDocuments.find((document) => document.docType.toUpperCase() === "CCA");
  const missingOptions = {
    skipClinicalAssessmentAttestation: !clientCcaAttestationReady(latestCca?.reviewJson),
  };
  const followUps = intake.followUps.map((followUp) => ({
    status: followUp.status,
    recipientRole: followUp.recipientRole,
    fieldKeys: parseFollowUpFieldKeys(followUp.fieldKeys),
    link: `${base}/follow-up/${followUp.token}`,
    tokenExpiresAt: followUp.tokenExpiresAt,
    sentAt: followUp.sentAt,
    completedAt: followUp.completedAt,
    attestedAt: followUp.attestedAt,
    skippedKeys: parseFollowUpFieldKeys(followUp.skippedKeys || "[]"),
    savedCount: followUp.savedCount,
    createdAt: followUp.createdAt,
  }));
  const packetReadiness = await providerPacketReadiness(provider!.id);
  const payload = NextResponse.json({
    intake: { ...intake, uploadedDocuments, followUps },
    answers,
    clientLink: `${base}/intake/${intake.token}`,
    percentComplete: percentComplete(answers),
    missingRequired: missingRequired(answers, signed, provider, missingOptions),
    missingOptional: missingOptional(answers, missingOptions),
    signatureStatuses: generationReadiness?.signatureStatuses || buildSignatureStatuses(intake.signatures),
    generationReadiness,
    packetFreshness,
    accuracyConflicts: generationReadiness?.conflicts || [],
    planCompleteness: generationReadiness?.planCompleteness || null,
    providerPacketReadiness: packetReadiness,
  });
  return attachSelectedProviderCookie(payload, provider!.id);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const body = await req.json();
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let completionDelivery: Record<string, unknown> | null = null;
  if (body.clientDetails) {
    const parsed = clientDetailsSchema.safeParse(body.clientDetails);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message || "Check the client details and try again.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const answerPatch = clientDetailsAnswerPatch(parsed.data);
    await prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id: intake.clientId },
        data: clientDetailsRecordPatch(parsed.data),
      });
      await saveAnswersInTransaction(tx, intake.id, answerPatch, {
        invalidationReason: "Client identity or contact details changed after signature capture.",
      });
      await tx.intake.update({
        where: { id: intake.id },
        data: { lastActivityAt: new Date() },
      });
    });
    await audit("answers_updated", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: "client details updated from dashboard",
    });
  }
  if (body.answers) {
    // Older intakes may contain JSON nulls for untouched fields. Treat those
    // as blanks while keeping the strict value validation for real answers.
    const answerPayload = typeof body.answers === "object" && body.answers !== null
      ? Object.fromEntries(Object.entries(body.answers).filter(([, value]) => value !== null && value !== undefined))
      : body.answers;
    const parsed = answersSchema.safeParse(answerPayload);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .slice(0, 6)
        .map((issue) => issue.path.join(".") || "answers")
        .join(", ");
      return NextResponse.json({ error: `Some answers could not be saved. Review: ${fields}.` }, { status: 400 });
    }
    // Staff screens send sparse patches. Saving only those keys prevents an
    // older open tab from overwriting newer answers from another section.
    const answers = parsed.data;
    await saveAnswers(intake.id, answers);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
    await prisma.client.update({
      where: { id: intake.clientId },
      data: clientUpdateFromAnswers(intake.client, answers),
    });
    await audit("answers_updated", { providerId: provider!.id, intakeId: intake.id, userId: user!.id, detail: "staff edit" });
    await audit("staff_reviewed", { providerId: provider!.id, intakeId: intake.id, userId: user!.id });
  }
  if (body.status) {
    const allowed = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"];
    if (!allowed.includes(body.status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
    if (body.status === "COMPLETED") {
      const readiness = await completionReadinessForIntake(intake.id, provider!.id);
      if (!readiness) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!readiness.ready) {
        return NextResponse.json({
          error: "This intake is not ready to complete.",
          blockers: readiness.blockers,
        }, { status: 409 });
      }
    }
    await prisma.intake.update({ where: { id: intake.id }, data: { status: body.status } });
    if (body.status === "COMPLETED") {
      try {
        completionDelivery = await autoSendCompletedCopiesIfEnabled({
          intakeId: intake.id,
          providerId: provider!.id,
          userId: user!.id,
          req,
        });
      } catch (e) {
        console.error("auto-send completed copies failed", e);
        completionDelivery = { error: "The intake was completed, but automatic delivery failed." };
      }
    }
  }
  if (body.extendToken) {
    await prisma.intake.update({
      where: { id: intake.id },
      data: clientLinkRenewalData(intake.tokenExpiresAt),
    });
  }
  if (body.archive !== undefined) {
    // real archiving: hide from the dashboard list without changing status
    await prisma.intake.update({ where: { id: intake.id }, data: { archived: !!body.archive } });
  }
  return NextResponse.json({ ok: true, completionDelivery });
}
