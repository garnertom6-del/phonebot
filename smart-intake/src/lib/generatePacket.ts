import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { appendCertificatePage } from "@/lib/certificate";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { packetTemplateForProvider } from "@/lib/providerPacketTemplates";

export interface GeneratePacketOptions {
  skipAutoCompletedCopies?: boolean;
}

export async function generatePacketForIntake(
  intakeId: string,
  userId: string,
  providerId?: string,
  options: GeneratePacketOptions = {},
) {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, ...(providerId ? { providerId } : {}) },
    include: { client: true, signatures: true },
  });
  if (!intake) return null;

  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  const consents = consentsFromAnswers(answers);
  const packetTemplate = await packetTemplateForProvider(intake.providerId);
  const result = await fillPacket({
    answers,
    signatures,
    consents,
    templateBytes: packetTemplate.bytes,
    fields: packetTemplate.fields,
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
    detail: `${result.filled} fields filled using ${packetTemplate.originalFileName}`,
  });
  if (signed && intake.providerId && !options.skipAutoCompletedCopies) {
    try {
      await autoSendCompletedCopiesIfEnabled({
        intakeId: intake.id,
        providerId: intake.providerId,
        userId,
      });
    } catch (e) {
      console.error("auto-send completed copies failed", e);
    }
  }

  return { filled: result.filled, skipped: result.skipped.length };
}
