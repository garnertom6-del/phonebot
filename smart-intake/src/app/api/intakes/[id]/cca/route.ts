import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { ccaConfigured, extractFromCca } from "@/lib/ccaExtract";
import { saveFile } from "@/lib/storage";
import { applyCcaAnswers, CcaSignaturesWouldInvalidateError } from "@/lib/ccaApply";

export const maxDuration = 300; // CCA reading can take a couple of minutes

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  if (!ccaConfigured()) {
    return NextResponse.json(
      { error: "Automatic document reading is not set up yet. Please ask your administrator to finish setup." },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const overwrite = form.get("overwrite") === "true";
  const confirmInvalidateSignatures = form.get("confirmInvalidateSignatures") === "true";
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: "File too large (30MB max)" }, { status: 400 });
  const mime = file.type || "application/pdf";
  if (!/^(application\/pdf|image\/(jpeg|png|gif|webp))$/.test(mime)) {
    return NextResponse.json({ error: "Upload the CCA as a PDF or a photo (JPG/PNG)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extraction;
  try {
    extraction = await extractFromCca(buffer, mime);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "CCA reading failed" }, { status: 502 });
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

  // Keep a copy only after answers are applied, so a cancelled signature
  // warning does not mark the CCA complete.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/cca-${Date.now()}-${safeName}`;
  saveFile(rel, buffer);
  await prisma.uploadedDocument.create({
    data: {
      intakeId: intake.id,
      docType: "CCA",
      fileName: `CCA: ${file.name}`,
      filePath: rel,
      mimeType: mime,
      reviewJson: JSON.stringify(extraction.review),
    },
  });

  await prisma.intake.update({
    where: { id: intake.id },
    data: {
      status: intake.status === "SUBMITTED" ? "NEEDS_REVIEW" : intake.status,
      lastActivityAt: new Date(),
    },
  });
  await audit("cca_imported", {
    providerId: provider!.id,
    intakeId: intake.id, userId: user!.id,
    detail: `${applied.filled.length} fields filled from CCA (${applied.skipped.length} kept existing answers)`
      + (applied.signaturesInvalidated ? "; captured signatures marked for re-sign" : ""),
  });
  return NextResponse.json({
    ok: true,
    filled: applied.filled.length,
    skipped: applied.skipped.length,
    extracted: extraction.fieldCount,
    filledLabels: applied.filledLabels,
    skippedLabels: applied.skippedLabels,
    signaturesInvalidated: applied.signaturesInvalidated,
    ccaReview: extraction.review,
  });
}
