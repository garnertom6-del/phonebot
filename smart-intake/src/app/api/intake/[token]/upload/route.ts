import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { deleteFile, moveFile, saveFile } from "@/lib/storage";
import {
  clientSubmissionFinished,
  lockOpenClientIntake,
} from "@/lib/clientSubmissionState";
import { checkClientUpload, safeUploadName } from "@/lib/uploadGuards";

class UploadClosedError extends Error {}


export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
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
  const allowed = checkClientUpload({
    docType, fileName: file.name, fileSize: file.size, fileType: file.type,
  });
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });
  const safeName = safeUploadName(file.name);
  const uniquePart = `${Date.now()}-${crypto.randomUUID()}`;
  const stagedRel = `uploads/.staging/${intake.id}-${uniquePart}-${safeName}`;
  const rel = `uploads/${intake.id}/${docType}-${uniquePart}-${safeName}`;
  saveFile(stagedRel, Buffer.from(await file.arrayBuffer()));
  let moved = false;
  try {
    await prisma.$transaction(async (tx) => {
      if (!await lockOpenClientIntake(tx, intake.id)) throw new UploadClosedError();
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
    throw error;
  }
  await audit("document_uploaded", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    detail: `${docType}: ${file.name}`,
  });
  return NextResponse.json({ ok: true, message: "Saved securely to the intake record." });
}
