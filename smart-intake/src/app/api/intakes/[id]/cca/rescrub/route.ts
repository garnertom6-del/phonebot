import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { ccaConfigured, extractFromCca } from "@/lib/ccaExtract";
import { readFile } from "@/lib/storage";
import { applyCcaAnswers, CcaSignaturesWouldInvalidateError } from "@/lib/ccaApply";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  let extraction;
  try {
    extraction = await extractFromCca(buffer, document.mimeType || "application/pdf");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CCA re-scan failed" }, { status: 502 });
  }

  let applied;
  try {
    applied = await applyCcaAnswers({
      intakeId: intake.id,
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
      status: intake.status === "SUBMITTED" ? "NEEDS_REVIEW" : intake.status,
      lastActivityAt: new Date(),
    },
  });
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
