import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { ccaConfigured, extractFromCca, mergeCcaAnswers } from "@/lib/ccaExtract";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { questionByKey } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

export const maxDuration = 300; // CCA reading can take a couple of minutes

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  if (!ccaConfigured()) {
    return NextResponse.json(
      { error: "AI document reading is not configured - add ANTHROPIC_API_KEY in your host's environment, then try again." },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findUnique({ where: { id: params.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const overwrite = form.get("overwrite") === "true";
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
  // Keep a copy only after the reader succeeds, so failed imports do not look completed.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/cca-${Date.now()}-${safeName}`;
  saveFile(rel, buffer);
  await prisma.uploadedDocument.create({
    data: { intakeId: intake.id, docType: "CCA", fileName: `CCA: ${file.name}`, filePath: rel, mimeType: mime },
  });

  const current = await loadAnswers(intake.id);
  const { merged, filled, skipped } = mergeCcaAnswers(current, extraction.extracted, overwrite);
  const withDefaults = applyOperationalDefaults({ ...current, ...merged });
  if (filled.length) {
    await saveAnswers(intake.id, withDefaults);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
  }
  await prisma.intake.update({ where: { id: intake.id }, data: { status: "NEEDS_REVIEW" } });
  await audit("cca_imported", {
    intakeId: intake.id, userId: user!.id,
    detail: `${filled.length} fields filled from CCA (${skipped.length} kept existing answers)`,
  });
  const label = (k: string) => questionByKey(k)?.label || k;
  return NextResponse.json({
    ok: true,
    filled: filled.length,
    skipped: skipped.length,
    extracted: extraction.fieldCount,
    filledLabels: filled.map(label).slice(0, 60),
    skippedLabels: skipped.map(label).slice(0, 30),
  });
}
