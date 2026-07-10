import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { saveFile } from "@/lib/storage";
import { applyNcTracksResult, describeNcTracksFields } from "@/lib/ncTracksLookup";
import { extractFromNcTracksDocument, ncTracksDocumentConfigured } from "@/lib/ncTracksExtract";

export const maxDuration = 180;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  if (!ncTracksDocumentConfigured()) {
    return NextResponse.json(
      { error: "Automatic NC Tracks card reading is not set up yet. You can still paste notes by hand." },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
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
  let extraction;
  try {
    extraction = await extractFromNcTracksDocument(buffer, mime, {
      fullName: intake.client.fullName,
      dob: intake.client.dob,
      midNumber: intake.client.midNumber,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "NC Tracks document reading failed" }, { status: 502 });
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/nctracks-${Date.now()}-${safeName}`;
  saveFile(rel, buffer);
  await prisma.uploadedDocument.create({
    data: { intakeId: intake.id, docType: "NC_TRACKS", fileName: `NC Tracks: ${file.name}`, filePath: rel, mimeType: mime },
  });
  await audit("document_uploaded", { intakeId: intake.id, userId: user!.id, detail: `NC Tracks: ${file.name}` });

  const current = await loadAnswers(intake.id);
  const { next, filled } = applyNcTracksResult(current, extraction.extracted);
  const withDefaults = applyOperationalDefaults(next);
  const details = describeNcTracksFields(withDefaults, filled);
  if (filled.length) {
    await saveAnswers(intake.id, withDefaults);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
    await prisma.client.update({
      where: { id: intake.clientId },
      data: {
        midNumber: s(withDefaults.mid_number) || intake.client.midNumber,
        recordNumber: s(withDefaults.record_number) || intake.client.recordNumber,
        phone: s(withDefaults.client_phone_cell) || intake.client.phone,
      },
    });
  }
  await audit("nctracks_lookup_completed", {
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
