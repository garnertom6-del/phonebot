import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, mappingOverrides } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { appendCertificatePage } from "@/lib/certificate";
import { questionByKey } from "@/config/mooreDivineQuestions";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({
    where: { id: params.id }, include: { client: true, signatures: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  const consents = consentsFromAnswers(answers);
  const result = await fillPacket({
    answers, signatures, consents,
    overrides: await mappingOverrides(),
  });
  // append the signing certificate: who signed, identity check, when/where,
  // consents, and a tamper-evident fingerprint of the packet pages
  const consentLabels = Object.entries(consents)
    .filter(([, agreed]) => agreed)
    .map(([key]) => questionByKey(key)?.label || key);
  const { pdfBytes, sha256 } = await appendCertificatePage(result.pdfBytes, {
    clientName: intake.client.fullName,
    signers: intake.signatures.map((s) => ({
      role: s.role, printedName: s.printedName, relationship: s.relationship,
      signedDate: s.signedDate, dobVerified: s.dobVerified, ip: s.ip, createdAt: s.createdAt,
    })),
    consentLabels,
    generatedAt: new Date(),
  });
  const rel = `generated/${intake.id}/${Date.now()}-intake-packet.pdf`;
  saveFile(rel, Buffer.from(pdfBytes));
  await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: rel, sha256 } });
  // generating the packet reflects signed-ness, not completion - COMPLETED
  // is reserved for the end of the workflow (staff's Mark completed / DocuSign)
  const signed = signatures.client || signatures.guardian;
  if (signed && intake.status !== "COMPLETED") {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
  }
  await audit("pdf_generated", {
    intakeId: intake.id, userId: user!.id, detail: `${result.filled} fields filled`,
  });
  return NextResponse.json({ ok: true, filled: result.filled, skipped: result.skipped.length });
}
