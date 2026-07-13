import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { ccaConfigured, extractFromCca, mergeCcaAnswers } from "@/lib/ccaExtract";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { readFile } from "@/lib/storage";
import { questionByKey } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  if (!ccaConfigured()) return NextResponse.json({ error: "Automatic document reading is not configured." }, { status: 400 });

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true, uploadedDocuments: { where: { docType: "CCA" }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const document = intake.uploadedDocuments[0];
  if (!document) return NextResponse.json({ error: "Upload a CCA before asking the system to re-scan it." }, { status: 400 });

  const overwrite = (await req.formData().catch(() => new FormData())).get("overwrite") === "true";
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

  await prisma.uploadedDocument.update({
    where: { id: document.id },
    data: { reviewJson: JSON.stringify(extraction.review) },
  });

  const current = await loadAnswers(intake.id);
  const { merged, filled, skipped } = mergeCcaAnswers(current, extraction.extracted, overwrite);
  const withDefaults = applyOperationalDefaults({ ...current, ...merged });
  const ccaDate = extraction.extracted.cca_assessment_date;
  if (typeof ccaDate === "string" && ccaDate.trim()) {
    for (const key of ["assess_date", "initial_assessment_date"]) {
      withDefaults[key] = ccaDate;
      if (!filled.includes(key)) filled.push(key);
    }
  }
  if (filled.length) {
    await saveAnswers(intake.id, withDefaults);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
    await prisma.client.update({
      where: { id: intake.clientId },
      data: {
        midNumber: typeof withDefaults.mid_number === "string" && withDefaults.mid_number.trim() ? withDefaults.mid_number.trim() : intake.client.midNumber,
        recordNumber: typeof withDefaults.record_number === "string" && withDefaults.record_number.trim() ? withDefaults.record_number.trim() : intake.client.recordNumber,
        phone: typeof withDefaults.client_phone_cell === "string" && withDefaults.client_phone_cell.trim() ? withDefaults.client_phone_cell.trim() : intake.client.phone,
        email: typeof withDefaults.client_email === "string" && withDefaults.client_email.trim() ? withDefaults.client_email.trim() : intake.client.email,
      },
    });
  }
  await prisma.intake.update({ where: { id: intake.id }, data: { status: "NEEDS_REVIEW" } });
  await audit("cca_rescrubbed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `${filled.length} fields filled from CCA re-scan (${skipped.length} existing answers kept)`,
  });
  const label = (key: string) => questionByKey(key)?.label || key;
  return NextResponse.json({
    ok: true,
    filled: filled.length,
    skipped: skipped.length,
    extracted: extraction.fieldCount,
    filledLabels: filled.map(label).slice(0, 60),
    ccaReview: extraction.review,
  });
}
