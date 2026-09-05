import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { deleteFile, moveFile, saveFile } from "@/lib/storage";
import {
  clientSubmissionFinished,
  lockOpenClientIntake,
} from "@/lib/clientSubmissionState";

class UploadClosedError extends Error {}

const DOC_TYPES = ["birth_certificate", "insurance_card", "photo_id", "court_order", "ss_card",
  "iep_records", "medication_list", "pcp_plan", "immunization_records", "standing_orders", "other"];

// documents are photos or PDFs - anything else is refused
const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const ALLOWED_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|heif)$/i;

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    include: {
      provider: true,
      signatures: { select: { role: true, invalidatedAt: true } },
    },
  });
  if (!intake || intake.tokenExpiresAt < new Date() || (intake.provider && intake.provider.status !== "ACTIVE")) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  if (clientSubmissionFinished(intake)) {
    return NextResponse.json({
      error: "This intake has already been submitted. Contact your provider to add a document.",
    }, { status: 409 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const docType = String(form.get("docType") || "other");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: "Bad docType" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "File too large (15MB max)" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return NextResponse.json({ error: "Please upload a photo (JPG/PNG/HEIC) or a PDF." }, { status: 400 });
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const uniquePart = `${Date.now()}-${crypto.randomUUID()}`;
  const stagedRel = `uploads/.staging/${intake.id}-${uniquePart}-${safeName}`;
  const rel = `uploads/${intake.id}/${docType}-${uniquePart}-${safeName}`;
  try {
    saveFile(stagedRel, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    // A full or unmounted storage disk otherwise surfaces as a blank 500 and
    // the client can only say "failed". Name the cause in the server log.
    console.error("[upload] could not write the file to storage", error);
    return NextResponse.json({
      error: "The server could not save this file (document storage is unavailable). Tell your provider - nothing was lost on your end.",
    }, { status: 507 });
  }
  let moved = false;
  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockOpenClientIntake(tx, intake.id))) throw new UploadClosedError();
      moveFile(stagedRel, rel);
      moved = true;
      await tx.uploadedDocument.create({
        data: {
          intakeId: intake.id,
          docType,
          fileName: file.name,
          filePath: rel,
          mimeType: file.type || "application/octet-stream",
        },
      });
    });
  } catch (error) {
    deleteFile(stagedRel);
    if (moved) deleteFile(rel);
    if (error instanceof UploadClosedError) {
      return NextResponse.json({
        error: "This intake was submitted while the document was uploading. The signed record was not changed.",
      }, { status: 409 });
    }
    console.error("[upload] could not record the document", error);
    return NextResponse.json({
      error: "The server could not record this document. Please try again, and tell your provider if it keeps failing.",
    }, { status: 500 });
  }
  await audit("document_uploaded", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    detail: `${docType}: ${file.name}`,
  });
  return NextResponse.json({ ok: true, message: "Saved securely to the intake record." });
}
