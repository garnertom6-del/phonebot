import { prisma } from "@/lib/prisma";
import { createDocuSignEnvelope, docusignConfigured, DocuSignEnvelopeError } from "@/lib/docusign";
import { randomUUID } from "node:crypto";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswerSnapshot, loadSignatures } from "@/lib/intakeData";
import { docuSignSendDetail } from "./docuSignPacket";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";
import { applyOperationalDefaults } from "./answerDefaults";
import { resolveDocuSignRecipients } from "./docuSignRecipients";

export type DocuSignSendResult =
  | { status: "sent"; envelopeId: string; message: string }
  | { status: "already_sent"; envelopeId: string; message: string }
  | { status: "not_configured"; message: string }
  | { status: "missing_email"; message: string }
  | { status: "unsupported_recipient"; message: string }
  | { status: "packet_not_ready"; message: string }
  | { status: "not_found"; message: string }
  | { status: "pending"; message: string }
  | { status: "failed"; message: string };

export interface SendIntakeToDocuSignOptions {
  intakeId: string;
  providerId: string;
  userId: string;
}

export async function sendIntakeToDocuSign(opts: SendIntakeToDocuSignOptions): Promise<DocuSignSendResult> {
  const intake = await prisma.intake.findFirst({
    where: { id: opts.intakeId, providerId: opts.providerId },
    include: { client: true, provider: true },
  });
  if (!intake) {
    return { status: "not_found", message: "Intake not found." };
  }
  let packetTemplate: Awaited<ReturnType<typeof requireProviderPacketForCompletion>>;
  try {
    packetTemplate = await requireProviderPacketForCompletion(opts.providerId);
  } catch (error) {
    if (error instanceof ProviderPacketNotReadyError) {
      return { status: "packet_not_ready", message: error.message };
    }
    throw error;
  }
  if (!docusignConfigured()) {
    return {
      status: "not_configured",
      message: "DocuSign is not set up yet, so the packet stayed in the intake app.",
    };
  }
  const snapshot = await loadAnswerSnapshot(intake.id);
  if (snapshot.contentRevision !== intake.contentRevision) {
    return { status: "failed", message: "The intake changed. Review it again before sending DocuSign." };
  }
  const answers = snapshot.answers;
  const effective = applyOperationalDefaults({ ...answers, dob: intake.client.dob });
  const consents = consentsFromAnswers(answers);
  const signatures = await loadSignatures(intake.id);
  if (!signatures.staff) {
    return { status: "unsupported_recipient", message: "Capture the current Staff / QP signature in the review screen first. DocuSign does not route staff signatures." };
  }
  const recipients = resolveDocuSignRecipients(intake.client, effective, consents, packetTemplate.fields);
  if (!recipients.ok) {
    return { status: recipients.status, message: recipients.message };
  }
  if (intake.docusignEnvelopeId) {
    return {
      status: "already_sent",
      envelopeId: intake.docusignEnvelopeId,
      message: "DocuSign was already sent for this intake.",
    };
  }
  delete signatures.client;
  delete signatures.guardian;

  const result = await fillPacket({
    answers,
    signatures,
    consents,
    templateBytes: packetTemplate.bytes,
    fields: packetTemplate.fields,
  });

  const attemptId = randomUUID();
  // Reserve before contacting DocuSign. The database lock serializes two
  // staff tabs; an unanswered create request stays reserved for reconciliation.
  const reservation = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intake.id} AND "providerId" = ${opts.providerId}`;
    const current = await tx.intake.findFirstOrThrow({ where: { id: intake.id, providerId: opts.providerId } });
    if (current.docusignEnvelopeId) return { envelopeId: current.docusignEnvelopeId };
    const pending = await tx.auditLog.findFirst({ where: { intakeId: intake.id, providerId: opts.providerId, event: "docusign_send_pending" } });
    if (pending) return { pending: true as const };
    if (current.archived || current.contentRevision !== snapshot.contentRevision) return { changed: true as const };
    const attempt = await tx.auditLog.create({ data: {
      providerId: opts.providerId, intakeId: intake.id, userId: opts.userId, event: "docusign_send_pending",
      detail: JSON.stringify({ transactionId: attemptId, contentRevision: snapshot.contentRevision }),
    } });
    return { auditId: attempt.id };
  });
  if ("envelopeId" in reservation && reservation.envelopeId) return { status: "already_sent", envelopeId: reservation.envelopeId, message: "DocuSign was already sent for this intake." };
  const pendingMessage = "A DocuSign send is in progress or its result is unconfirmed. Do not resend. Ask your administrator to reconcile the pending transaction in DocuSign before retrying.";
  if ("pending" in reservation) return { status: "pending", message: pendingMessage };
  if ("changed" in reservation) return { status: "failed", message: "The intake changed. Review it again before sending DocuSign." };
  let envelopeCreated = false;
  try {
    const { envelopeId } = await createDocuSignEnvelope(
      Buffer.from(result.pdfBytes),
      recipients.signers,
      answers,
      consents,
      packetTemplate.fields,
      intake.provider?.name || "Moore Divine Care, Inc.",
      packetTemplate.pageHeight,
      attemptId,
      recipients.documentName,
    );
    envelopeCreated = true;
    await prisma.$transaction(async (tx) => {
      await tx.intake.update({ where: { id: intake.id }, data: { docusignEnvelopeId: envelopeId } });
      await tx.auditLog.update({ where: { id: reservation.auditId }, data: { event: "docusign_send_resolved" } });
      await tx.auditLog.create({ data: {
        event: "docusign_sent", providerId: opts.providerId, intakeId: intake.id, userId: opts.userId,
        detail: docuSignSendDetail(envelopeId, snapshot.contentRevision),
      } });
    });
    return {
      status: "sent",
      envelopeId,
      message: recipients.signers.every((signer) => signer.role === "guardian")
        ? "DocuSign was sent to the guardian email. The signed PDF is saved for reference; Smart Intake still enforces its in-app signature and completion checks."
        : recipients.signers.some((signer) => signer.role === "guardian")
          ? "DocuSign was sent to the client, then the guardian. The signed PDF is saved for reference; Smart Intake still enforces its in-app signature and completion checks."
          : "DocuSign was sent to the client email. The signed PDF is saved for reference; Smart Intake still enforces its in-app signature and completion checks.",
    };
  } catch (error) {
    console.error("DocuSign send failed", error);
    if (envelopeCreated || error instanceof DocuSignEnvelopeError && error.mayHaveSent) {
      return { status: "pending", message: pendingMessage };
    }
    await prisma.auditLog.update({ where: { id: reservation.auditId }, data: { event: "docusign_send_failed" } });
    return {
      status: "failed",
      message: "Packet generated, but DocuSign could not send automatically. You can retry after checking the DocuSign connection.",
    };
  }
}
