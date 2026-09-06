import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { ccaConfigured, extractFromCca } from "@/lib/ccaExtract";
import { readFile } from "@/lib/storage";
import { applyCcaAnswers, CcaSignaturesWouldInvalidateError } from "@/lib/ccaApply";
import { appSnapshotFromAnswers, checkCcaSourceIdentity, finalizeCcaReview } from "@/lib/ccaMedicalNecessity";
import { loadAnswerSnapshot } from "@/lib/intakeData";
import { AnswerConflictError } from "@/lib/answerRevisions";

export const maxDuration = 300;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  if (!ccaConfigured()) return NextResponse.json({ error: "Automatic document reading is not configured." }, { status: 400 });

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true, uploadedDocuments: { where: { docType: "CCA" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const document = intake.uploadedDocuments[0];
  if (!document) return NextResponse.json({ error: "Upload a CCA before asking the system to re-scan it." }, { status: 400 });

  const form = await req.formData().catch(() => new FormData());
  const overwrite = form.get("overwrite") === "true";
  const confirmInvalidateSignatures = form.get("confirmInvalidateSignatures") === "true";
  let buffer: Buffer;
  try {
    buffer = readFile(document.filePath);
  } catch {
    return NextResponse.json({ error: "The saved CCA file is not available. Upload the CCA again." }, { status: 404 });
  }

  const baseline = await loadAnswerSnapshot(intake.id);
  let extraction;
  try {
    extraction = await extractFromCca(buffer, document.mimeType || "application/pdf");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CCA re-scan failed" }, { status: 502 });
  }

  const identity = checkCcaSourceIdentity(extraction.review, intake.client, extraction.extracted);
  if (!identity.matches) {
    return NextResponse.json({
      code: identity.code,
      error: identity.code === "CCA_IDENTITY_MISMATCH"
        ? "The saved CCA name or date of birth does not match this client. Upload the correct client's CCA. No answers or documents were changed."
        : "The saved CCA client's full name and date of birth could not both be verified. Upload a readable CCA with matching identity. No answers or documents were changed.",
      fields: identity.fields,
    }, { status: 409 });
  }

  extraction = {
    ...extraction,
    review: finalizeCcaReview(extraction.review, {
      app: appSnapshotFromAnswers(baseline.answers, intake.client),
    }),
  };

  let applied;
  try {
    applied = await applyCcaAnswers({
      intakeId: intake.id,
      baseline,
      expectedClientIdentity: intake.client,
      clientId: intake.clientId,
      currentMid: intake.client.midNumber,
      currentRecord: intake.client.recordNumber,
      currentPhone: intake.client.phone,
      currentEmail: intake.client.email,
      extracted: extraction.extracted,
      overwrite,
      confirmInvalidateSignatures,
    });
  } catch (error) {
    if (error instanceof AnswerConflictError) return NextResponse.json({ ...error.toJSON(), error: "The intake changed while the CCA was being read. Review the saved answers and retry the CCA scan." }, { status: 409 });
    if (error instanceof CcaSignaturesWouldInvalidateError) {
      return NextResponse.json({
        code: error.code,
        error: error.message,
        signatureCount: error.signatureCount,
        changedCount: error.changedCount,
      }, { status: 409 });
    }
    throw error;
  }

  await prisma.uploadedDocument.update({
    where: { id: document.id },
    data: { reviewJson: JSON.stringify(extraction.review) },
  });
  await prisma.intake.update({
    where: { id: intake.id },
    data: {
      lastActivityAt: new Date(),
    },
  });
  await prisma.intake.updateMany({ where: { id: intake.id, status: "SUBMITTED" }, data: { status: "NEEDS_REVIEW" } });
  await audit("cca_rescrubbed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `${applied.filled.length} fields filled from CCA re-scan (${applied.skipped.length} existing answers kept)`
      + (applied.signaturesInvalidated ? "; captured signatures marked for re-sign" : ""),
  });
  return NextResponse.json({
    ok: true,
    filled: applied.filled.length,
    skipped: applied.skipped.length,
    extracted: extraction.fieldCount,
    filledLabels: applied.filledLabels,
    signaturesInvalidated: applied.signaturesInvalidated,
    ccaReview: extraction.review,
  });
}
