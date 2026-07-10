import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, mappingOverrides } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { appendCertificatePage } from "@/lib/certificate";
import { questionByKey } from "@/config/mooreDivineQuestions";

export async function generatePacketForIntake(intakeId: string, userId: string, providerId?: string) {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, ...(providerId ? { providerId } : {}) },
    include: { client: true, signatures: true },
  });
  if (!intake) return null;

  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  const consents = consentsFromAnswers(answers);
  const result = await fillPacket({
    answers,
    signatures,
    consents,
    overrides: await mappingOverrides(),
  });
  const consentLabels = Object.entries(consents)
    .filter(([, agreed]) => agreed)
    .map(([key]) => questionByKey(key)?.label || key);
  const { pdfBytes, sha256 } = await appendCertificatePage(result.pdfBytes, {
    clientName: intake.client.fullName,
    signers: intake.signatures.map((s) => ({
      role: s.role,
      printedName: s.printedName,
      relationship: s.relationship,
      signedDate: s.signedDate,
      dobVerified: s.dobVerified,
      ip: s.ip,
      createdAt: s.createdAt,
    })),
    consentLabels,
    generatedAt: new Date(),
  });
  const rel = `generated/${intake.id}/${Date.now()}-intake-packet.pdf`;
  saveFile(rel, Buffer.from(pdfBytes));
  await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: rel, sha256 } });
  const signed = signatures.client || signatures.guardian;
  if (signed && intake.status !== "COMPLETED") {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
  }
  await audit("pdf_generated", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    userId,
    detail: `${result.filled} fields filled`,
  });

  return { filled: result.filled, skipped: result.skipped.length };
}
