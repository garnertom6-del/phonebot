import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { downloadDocuSignDocument } from "./docusign";
import { recordDocuSignPacket } from "./docuSignPacket";
import { saveFile, deleteFile } from "./storage";
import { observeIntakeWorkflow } from "./workflowTracking";
import { autoSendCompletedCopiesIfEnabled } from "./sendCompletedCopies";
import { ensureCompletedCopyToken } from "./copyTokens";
import { completionReadinessForIntake } from "./completionReadiness";

export const DOCUSIGN_STATUS_FRIENDLY: Record<string, string> = {
  sent: "Sent - waiting for the client to open it.",
  delivered: "The client opened it but has not signed yet.",
  completed: "Signed! The signed copy was saved to this intake.",
  declined: "The client declined to sign.",
  voided: "This envelope was voided in DocuSign.",
};

export async function recordDocuSignRemoteStatus(input: {
  intakeId: string;
  providerId: string;
  envelopeId: string;
  status: string;
  userId?: string | null;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${input.intakeId} AND "providerId" = ${input.providerId}`;
    const current = await tx.intake.findFirst({ where: { id: input.intakeId, providerId: input.providerId } });
    if (!current || current.docusignEnvelopeId !== input.envelopeId) return false;
    const detail = JSON.stringify({ envelopeId: input.envelopeId, status: input.status });
    const last = await tx.auditLog.findFirst({
      where: { intakeId: input.intakeId, providerId: input.providerId, event: "docusign_status" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (last?.detail !== detail) {
      await tx.auditLog.create({
        data: {
          intakeId: input.intakeId,
          providerId: input.providerId,
          userId: input.userId || undefined,
          event: "docusign_status",
          detail,
        },
      });
    }
    return true;
  });
}

export async function importCompletedDocuSignEnvelope(input: {
  intakeId: string;
  providerId: string;
  envelopeId: string;
  userId?: string | null;
  contentRevision: number;
}): Promise<
  | { ok: true; message: string; blockers?: Array<{ code: string; message: string }>; delivery?: unknown }
  | { ok: false; error: string; httpStatus: number }
> {
  const alreadySaved = await prisma.auditLog.findFirst({
    where: {
      providerId: input.providerId,
      intakeId: input.intakeId,
      event: "docusign_completed",
      detail: input.envelopeId,
    },
    select: { id: true },
  });
  if (!alreadySaved) {
    const signedPdf = await downloadDocuSignDocument(input.envelopeId);
    const rel = `generated/${input.intakeId}/${Date.now()}-${randomUUID()}-docusign-signed.pdf`;
    saveFile(rel, signedPdf);
    try {
      const imported = await recordDocuSignPacket({
        providerId: input.providerId,
        intakeId: input.intakeId,
        userId: input.userId || undefined,
        envelopeId: input.envelopeId,
        filePath: rel,
        sha256: createHash("sha256").update(signedPdf).digest("hex"),
      });
      if (!imported.saved) deleteFile(rel);
    } catch (error) {
      deleteFile(rel);
      throw error;
    }
    await observeIntakeWorkflow(input.intakeId).catch((error) => console.error("workflow observation failed", error));
  }

  const readiness = await completionReadinessForIntake(input.intakeId, input.providerId);
  if (!readiness) return { ok: false, error: "Not found", httpStatus: 404 };
  if (!readiness.ready) {
    await prisma.intake.updateMany({
      where: {
        id: input.intakeId,
        providerId: input.providerId,
        docusignEnvelopeId: input.envelopeId,
        contentRevision: input.contentRevision,
        archived: false,
        status: { notIn: ["COMPLETED", "NEEDS_REVIEW"] },
      },
      data: { status: "SIGNED" },
    });
    return {
      ok: true,
      message: [
        "The signed PDF was saved from DocuSign. Smart Intake is not complete.",
        readiness.blockers.some((blocker) => ["client_signature_missing", "client_signature_invalid"].includes(blocker.code))
          ? "Capture a current client or guardian signature in the secure intake app; the DocuSign PDF does not satisfy that app requirement."
          : "",
        `Remaining checks: ${readiness.blockers.map((blocker) => blocker.message).join(" ")}`,
      ].filter(Boolean).join(" "),
      blockers: readiness.blockers,
    };
  }

  const completed = await prisma.intake.updateMany({
    where: {
      id: input.intakeId,
      providerId: input.providerId,
      docusignEnvelopeId: input.envelopeId,
      contentRevision: input.contentRevision,
      archived: false,
    },
    data: { status: "COMPLETED" },
  });
  if (!completed.count) {
    return {
      ok: false,
      error: "The intake changed while DocuSign was checked. Review the current packet before completing it.",
      httpStatus: 409,
    };
  }
  await ensureCompletedCopyToken(input.intakeId);
  const delivery = await autoSendCompletedCopiesIfEnabled({
    intakeId: input.intakeId,
    providerId: input.providerId,
    userId: input.userId || undefined,
  }).catch((error) => {
    console.error("auto-send completed copies failed", error);
    return { error: "Automatic delivery failed after DocuSign completion." };
  });
  return { ok: true, message: DOCUSIGN_STATUS_FRIENDLY.completed, delivery };
}

export async function applyDocuSignEnvelopeUpdate(input: {
  intakeId: string;
  providerId: string;
  envelopeId: string;
  status: string;
  userId?: string | null;
  contentRevision: number;
}): Promise<
  | { ok: true; status: string; message: string; blockers?: Array<{ code: string; message: string }>; delivery?: unknown }
  | { ok: false; error: string; httpStatus: number }
> {
  const recorded = await recordDocuSignRemoteStatus(input);
  if (!recorded) {
    return { ok: false, error: "The DocuSign envelope changed. Refresh the intake before checking it.", httpStatus: 409 };
  }
  if (input.status === "completed") {
    const imported = await importCompletedDocuSignEnvelope(input);
    if (!imported.ok) return imported;
    return { ok: true, status: input.status, message: imported.message, blockers: imported.blockers, delivery: imported.delivery };
  }
  return {
    ok: true,
    status: input.status,
    message: DOCUSIGN_STATUS_FRIENDLY[input.status] || `DocuSign status: ${input.status}`,
  };
}
