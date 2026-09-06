import { prisma } from "./prisma";

export function docuSignSendDetail(envelopeId: string, contentRevision: number): string {
  return JSON.stringify({ envelopeId, contentRevision });
}

function sentRevision(details: Array<{ detail: string | null }>, envelopeId: string): number {
  for (const log of details) {
    try {
      const source = JSON.parse(log.detail || "");
      if (source.envelopeId === envelopeId && Number.isSafeInteger(source.contentRevision) && source.contentRevision > 0) {
        return source.contentRevision;
      }
    } catch { /* Legacy envelope audit rows did not record the signed revision. */ }
  }
  // Zero can never be a current intake revision. Do not certify a legacy
  // envelope against content that may have changed since it was sent.
  return 0;
}

/** Import once, reserving a version and its completion audit under the intake lock. */
export async function recordDocuSignPacket(input: {
  intakeId: string; providerId: string; envelopeId: string; filePath: string; sha256: string; userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${input.intakeId} AND "providerId" = ${input.providerId}`;
    const intake = await tx.intake.findFirst({ where: { id: input.intakeId, providerId: input.providerId } });
    if (!intake || intake.docusignEnvelopeId !== input.envelopeId) throw new Error("The DocuSign envelope changed. Refresh the intake before importing it.");
    const existing = await tx.auditLog.findFirst({ where: {
      providerId: input.providerId, intakeId: input.intakeId, event: "docusign_completed", detail: input.envelopeId,
    } });
    if (existing) return { saved: false, contentRevision: null, packetVersion: null };
    const sent = await tx.auditLog.findMany({ where: {
      providerId: input.providerId, intakeId: input.intakeId, event: "docusign_sent",
    }, orderBy: { createdAt: "desc" }, select: { detail: true } });
    const contentRevision = sentRevision(sent, input.envelopeId);
    const latest = await tx.generatedPdf.findFirst({ where: { intakeId: input.intakeId }, orderBy: { packetVersion: "desc" }, select: { packetVersion: true } });
    const packetVersion = (latest?.packetVersion || 0) + 1;
    await tx.generatedPdf.create({ data: {
      intakeId: input.intakeId, filePath: input.filePath, sha256: input.sha256, contentRevision, packetVersion,
    } });
    await tx.auditLog.create({ data: {
      providerId: input.providerId, intakeId: input.intakeId, userId: input.userId,
      event: "docusign_completed", detail: input.envelopeId,
    } });
    return { saved: true, contentRevision, packetVersion };
  });
}
