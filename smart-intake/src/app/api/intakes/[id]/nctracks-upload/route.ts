import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswerSnapshot, saveAnswerSnapshotChanges } from "@/lib/intakeData";
import { AnswerConflictError } from "@/lib/answerRevisions";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { saveFile } from "@/lib/storage";
import { applyNcTracksResult, describeNcTracksFields } from "@/lib/ncTracksLookup";
import { extractFromNcTracksDocument, ncTracksDocumentConfigured } from "@/lib/ncTracksExtract";
import { maybeOcrUploadedPdf } from "@/lib/adobePdfServices";

export const maxDuration = 180;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  if (!ncTracksDocumentConfigured()) {
    return NextResponse.json(
      { error: "Automatic NC Tracks card reading is not set up yet. You can still paste notes by hand." },
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
  if (!file) return NextResponse.json({ error: "No NC Tracks file uploaded" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "File too large (15MB max)" }, { status: 400 });
  const mime = file.type || "application/pdf";
  if (!/^(application\/pdf|image\/(jpeg|png|gif|webp))$/.test(mime)) {
    return NextResponse.json({ error: "Upload the NC Tracks card as a PDF or photo (JPG/PNG)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const baseline = await loadAnswerSnapshot(intake.id);
  let extraction;
  try {
    const extractBytes = await maybeOcrUploadedPdf(buffer, mime);
    extraction = await extractFromNcTracksDocument(extractBytes, mime, {
      fullName: intake.client.fullName,
      dob: intake.client.dob,
      midNumber: intake.client.midNumber,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "NC Tracks document reading failed" }, { status: 502 });
  }

  const { next, filled } = applyNcTracksResult(baseline.answers, extraction.extracted);
  const withDefaults = applyOperationalDefaults(next);
  const details = describeNcTracksFields(withDefaults, filled);
  try {
    await saveAnswerSnapshotChanges(intake.id, baseline, filled.length ? withDefaults : {}, { syncClient: true, expectedClientIdentity: intake.client });
  } catch (error) {
    if (error instanceof AnswerConflictError) return NextResponse.json({ ...error.toJSON(), error: "The intake changed while the NC Tracks file was being read. Review the saved answers and retry the file." }, { status: 409 });
    throw error;
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/nctracks-${Date.now()}-${safeName}`;
  saveFile(rel, buffer);
  await prisma.uploadedDocument.create({
    data: { intakeId: intake.id, docType: "NC_TRACKS", fileName: `NC Tracks: ${file.name}`, filePath: rel, mimeType: mime },
  });
  await audit("document_uploaded", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `NC Tracks: ${file.name}`,
  });

  await audit("nctracks_lookup_completed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: filled.length ? `NC Tracks upload filled ${filled.join(", ")}` : "NC Tracks upload had no matching fields",
  });
  return NextResponse.json({
    ok: true,
    filled,
    count: filled.length,
    extracted: extraction.fieldCount,
    details,
  });
}
