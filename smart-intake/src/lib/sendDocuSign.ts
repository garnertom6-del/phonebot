import { prisma } from "@/lib/prisma";
import { createDocuSignEnvelope, docusignConfigured } from "@/lib/docusign";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswerSnapshot, loadSignatures } from "@/lib/intakeData";
import { docuSignSendDetail } from "./docuSignPacket";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";
import { answeredClientFields } from "@/lib/clientAnswerSync";
import { applyOperationalDefaults } from "./answerDefaults";
import { preferredIntakeDeliveryRole } from "./clientDeliveryContacts";

export type DocuSignSendResult =
  | { status: "sent"; envelopeId: string; message: string }
  | { status: "already_sent"; envelopeId: string; message: string }
  | { status: "not_configured"; message: string }
  | { status: "missing_email"; message: string }
  | { status: "unsupported_recipient"; message: string }
  | { status: "packet_not_ready"; message: string }
  | { status: "not_found"; message: string }
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
  if (preferredIntakeDeliveryRole(intake.client, effective) === "guardian") {
    return { status: "unsupported_recipient", message: "DocuSign currently sends only to the client's email. Collect the guardian signature through the secure intake app." };
  }
  const answeredClient = answeredClientFields(answers);
  const clientEmail = intake.client.email || answeredClient.email;
  const clientName = intake.client.fullName || answeredClient.fullName;
  if (!clientEmail) {
    return {
      status: "missing_email",
      message: "Add a client email before DocuSign can be sent automatically.",
    };
  }
  if (intake.docusignEnvelopeId) {
    return {
      status: "already_sent",
      envelopeId: intake.docusignEnvelopeId,
      message: "DocuSign was already sent for this intake.",
    };
  }
  const consents = consentsFromAnswers(answers);
  const signatures = await loadSignatures(intake.id);
  if (signatures.guardian && !signatures.client) {
    return { status: "unsupported_recipient", message: "DocuSign currently sends only to the client's email. Collect the guardian signature through the secure intake app." };
  }
  if (!signatures.staff) {
    return { status: "unsupported_recipient", message: "Capture the current Staff / QP signature in the review screen first. DocuSign does not route staff signatures." };
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

  try {
    const { envelopeId } = await createDocuSignEnvelope(
      Buffer.from(result.pdfBytes),
      clientEmail,
      clientName,
      answers,
      consents,
      packetTemplate.fields,
      intake.provider?.name || "Moore Divine Care, Inc.",
      packetTemplate.pageHeight,
    );
    await prisma.$transaction(async (tx) => {
      await tx.intake.update({ where: { id: intake.id }, data: { docusignEnvelopeId: envelopeId } });
      await tx.auditLog.create({ data: {
        event: "docusign_sent", providerId: opts.providerId, intakeId: intake.id, userId: opts.userId,
        detail: docuSignSendDetail(envelopeId, snapshot.contentRevision),
      } });
    });
    return {
      status: "sent",
      envelopeId,
      message: "DocuSign was sent to the client email. The signed PDF is saved for reference; Smart Intake still enforces its in-app signature and completion checks.",
    };
  } catch (error) {
    console.error("DocuSign send failed", error);
    return {
      status: "failed",
      message: "Packet generated, but DocuSign could not send automatically. You can retry after checking the DocuSign connection.",
    };
  }
}
