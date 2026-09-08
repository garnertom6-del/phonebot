import { prisma } from "./prisma";
import { checkDocuSignStatus, docusignConfigured, lookupEnvelopeByTransactionId } from "./docusign";
import { docuSignSendDetail } from "./docuSignPacket";

export type DocuSignPendingSend = {
  auditId: string;
  transactionId: string;
  contentRevision: number;
};

export function parsePendingSendDetail(detail: string | null | undefined): { transactionId: string; contentRevision: number } | null {
  try {
    const source = JSON.parse(detail || "");
    if (typeof source.transactionId !== "string" || !source.transactionId.trim()) return null;
    const contentRevision = Number(source.contentRevision);
    if (!Number.isSafeInteger(contentRevision) || contentRevision < 0) return null;
    return { transactionId: source.transactionId.trim(), contentRevision };
  } catch {
    return null;
  }
}

export async function loadPendingDocuSignSend(intakeId: string, providerId: string): Promise<DocuSignPendingSend | null> {
  const pending = await prisma.auditLog.findFirst({
    where: { intakeId, providerId, event: "docusign_send_pending" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return null;
  const parsed = parsePendingSendDetail(pending.detail);
  if (!parsed) return null;
  return { auditId: pending.id, ...parsed };
}

export type ReconcileResult =
  | { status: "lookup"; found: false; transactionId: string; message: string }
  | { status: "lookup"; found: true; transactionId: string; envelopeId: string; envelopeStatus: string; message: string }
  | { status: "attached"; envelopeId: string; contentRevision: number; message: string }
  | { status: "already_sent"; envelopeId: string; message: string }
  | { status: "marked_failed"; message: string }
  | { status: "not_pending"; message: string }
  | { status: "not_configured"; message: string }
  | { status: "failed"; message: string };

const EMPTY_LOOKUP_MESSAGE =
  "No envelope was found for this transaction yet. DocuSign keeps lookup IDs for seven days. Do not mark the send failed until you confirm DocuSign never created the envelope.";

export async function reconcileDocuSignSend(input: {
  intakeId: string;
  providerId: string;
  userId: string;
  action: "lookup" | "attach" | "mark_failed";
  envelopeId?: string;
}): Promise<ReconcileResult> {
  if (!docusignConfigured() && input.action !== "mark_failed") {
    return { status: "not_configured", message: "DocuSign is not set up, so the pending send cannot be looked up." };
  }
  const intake = await prisma.intake.findFirst({
    where: { id: input.intakeId, providerId: input.providerId },
    select: { id: true, docusignEnvelopeId: true },
  });
  if (!intake) return { status: "failed", message: "Intake not found." };
  if (intake.docusignEnvelopeId) {
    return {
      status: "already_sent",
      envelopeId: intake.docusignEnvelopeId,
      message: "This intake already has a DocuSign envelope. Use Check DocuSign status instead of sending another.",
    };
  }
  const pending = await loadPendingDocuSignSend(input.intakeId, input.providerId);
  if (!pending) {
    return { status: "not_pending", message: "There is no unconfirmed DocuSign send to reconcile on this intake." };
  }

  if (input.action === "lookup") {
    try {
      const found = await lookupEnvelopeByTransactionId(pending.transactionId);
      await prisma.auditLog.create({
        data: {
          providerId: input.providerId,
          intakeId: input.intakeId,
          userId: input.userId,
          event: "docusign_reconcile_lookup",
          detail: JSON.stringify({
            transactionId: pending.transactionId,
            contentRevision: pending.contentRevision,
            envelopeId: found?.envelopeId || null,
            envelopeStatus: found?.status || null,
          }),
        },
      });
      if (!found) {
        return { status: "lookup", found: false, transactionId: pending.transactionId, message: EMPTY_LOOKUP_MESSAGE };
      }
      return {
        status: "lookup",
        found: true,
        transactionId: pending.transactionId,
        envelopeId: found.envelopeId,
        envelopeStatus: found.status,
        message: `DocuSign has envelope ${found.envelopeId} (${found.status}). Attach it to finish reconciliation without sending another envelope.`,
      };
    } catch (error) {
      console.error("DocuSign reconcile lookup failed", error);
      return { status: "failed", message: "Could not look up the pending DocuSign transaction. Try again in a minute." };
    }
  }

  if (input.action === "mark_failed") {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${input.intakeId} AND "providerId" = ${input.providerId}`;
      const current = await tx.intake.findFirstOrThrow({ where: { id: input.intakeId, providerId: input.providerId } });
      if (current.docusignEnvelopeId) throw new Error("already_sent");
      const stillPending = await tx.auditLog.findFirst({ where: { id: pending.auditId, event: "docusign_send_pending" } });
      if (!stillPending) throw new Error("not_pending");
      await tx.auditLog.update({ where: { id: pending.auditId }, data: { event: "docusign_send_failed" } });
      await tx.auditLog.create({
        data: {
          providerId: input.providerId,
          intakeId: input.intakeId,
          userId: input.userId,
          event: "docusign_reconcile_failed",
          detail: JSON.stringify({ transactionId: pending.transactionId, contentRevision: pending.contentRevision }),
        },
      });
    }).catch((error) => {
      if (error instanceof Error && error.message === "already_sent") return;
      if (error instanceof Error && error.message === "not_pending") return;
      throw error;
    });
    const after = await prisma.intake.findFirst({ where: { id: input.intakeId, providerId: input.providerId } });
    if (after?.docusignEnvelopeId) {
      return {
        status: "already_sent",
        envelopeId: after.docusignEnvelopeId,
        message: "This intake already has a DocuSign envelope. Use Check DocuSign status instead of sending another.",
      };
    }
    return {
      status: "marked_failed",
      message: "The unconfirmed send was marked failed. Staff can retry DocuSign. Only do this after confirming DocuSign never created the envelope.",
    };
  }

  const requested = (input.envelopeId || "").trim();
  let envelopeId = requested;
  let envelopeStatus = "unknown";
  try {
    if (envelopeId) {
      envelopeStatus = await checkDocuSignStatus(envelopeId);
    } else {
      const found = await lookupEnvelopeByTransactionId(pending.transactionId);
      if (!found) {
        await prisma.auditLog.create({
          data: {
            providerId: input.providerId,
            intakeId: input.intakeId,
            userId: input.userId,
            event: "docusign_reconcile_lookup",
            detail: JSON.stringify({
              transactionId: pending.transactionId,
              contentRevision: pending.contentRevision,
              envelopeId: null,
              action: "attach",
            }),
          },
        });
        return { status: "lookup", found: false, transactionId: pending.transactionId, message: EMPTY_LOOKUP_MESSAGE };
      }
      envelopeId = found.envelopeId;
      envelopeStatus = found.status;
    }
  } catch (error) {
    console.error("DocuSign reconcile attach lookup failed", error);
    return { status: "failed", message: "Could not confirm the recovered DocuSign envelope. Try again in a minute." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${input.intakeId} AND "providerId" = ${input.providerId}`;
      const current = await tx.intake.findFirstOrThrow({ where: { id: input.intakeId, providerId: input.providerId } });
      if (current.docusignEnvelopeId) throw new Error("already_sent");
      const stillPending = await tx.auditLog.findFirst({ where: { id: pending.auditId, event: "docusign_send_pending" } });
      if (!stillPending) throw new Error("not_pending");
      await tx.intake.update({ where: { id: input.intakeId }, data: { docusignEnvelopeId: envelopeId } });
      await tx.auditLog.update({ where: { id: pending.auditId }, data: { event: "docusign_send_resolved" } });
      await tx.auditLog.create({
        data: {
          event: "docusign_sent",
          providerId: input.providerId,
          intakeId: input.intakeId,
          userId: input.userId,
          detail: docuSignSendDetail(envelopeId, pending.contentRevision),
        },
      });
      await tx.auditLog.create({
        data: {
          event: "docusign_reconcile_attached",
          providerId: input.providerId,
          intakeId: input.intakeId,
          userId: input.userId,
          detail: JSON.stringify({
            transactionId: pending.transactionId,
            envelopeId,
            envelopeStatus,
            contentRevision: pending.contentRevision,
          }),
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "already_sent") {
      const current = await prisma.intake.findFirst({ where: { id: input.intakeId, providerId: input.providerId } });
      return {
        status: "already_sent",
        envelopeId: current?.docusignEnvelopeId || envelopeId,
        message: "This intake already has a DocuSign envelope. Use Check DocuSign status instead of sending another.",
      };
    }
    throw error;
  }
  return {
    status: "attached",
    envelopeId,
    contentRevision: pending.contentRevision,
    message: `Recovered envelope ${envelopeId} was attached using the original content revision ${pending.contentRevision}.`,
  };
}
