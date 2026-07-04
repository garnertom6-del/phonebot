import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, mappingOverrides } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  const result = await fillPacket({
    answers, signatures, consents: consentsFromAnswers(answers),
    overrides: await mappingOverrides(),
  });
  const rel = `generated/${intake.id}/${Date.now()}-intake-packet.pdf`;
  saveFile(rel, Buffer.from(result.pdfBytes));
  await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: rel } });
  const done = signatures.client || signatures.guardian;
  await prisma.intake.update({
    where: { id: intake.id },
    data: { status: done ? "COMPLETED" : intake.status },
  });
  await audit("pdf_generated", {
    intakeId: intake.id, userId: user!.id, detail: `${result.filled} fields filled`,
  });
  return NextResponse.json({ ok: true, filled: result.filled, skipped: result.skipped.length });
}
