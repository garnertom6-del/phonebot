import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { createDocuSignEnvelope, docusignConfigured } from "@/lib/docusign";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { packetTemplateForProvider } from "@/lib/providerPacketTemplates";

export type DocuSignSendResult =
  | { status: "sent"; envelopeId: string; message: string }
  | { status: "already_sent"; envelopeId: string; message: string }
  | { status: "not_configured"; message: string }
  | { status: "missing_email"; message: string }
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
  if (!docusignConfigured()) {
    return {
      status: "not_configured",
      message: "DocuSign is not set up yet, so the packet stayed in the intake app.",
    };
  }
  if (!intake.client.email) {
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

  const answers = await loadAnswers(intake.id);
  const consents = consentsFromAnswers(answers);
  const signatures = await loadSignatures(intake.id);
  delete signatures.client;
  delete signatures.guardian;

  const packetTemplate = await packetTemplateForProvider(opts.providerId);
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
      intake.client.email,
      intake.client.fullName,
      answers,
      consents,
      packetTemplate.fields,
      intake.provider?.name || "Moore Divine Care, Inc.",
      packetTemplate.pageHeight,
    );
    await prisma.intake.update({ where: { id: intake.id }, data: { docusignEnvelopeId: envelopeId } });
    await audit("docusign_sent", {
      providerId: opts.providerId,
      intakeId: intake.id,
      userId: opts.userId,
      detail: envelopeId,
    });
    return {
      status: "sent",
      envelopeId,
      message: "DocuSign was sent automatically as the final signing step.",
    };
  } catch (error) {
    console.error("DocuSign send failed", error);
    return {
      status: "failed",
      message: "Packet generated, but DocuSign could not send automatically. You can retry after checking the DocuSign connection.",
    };
  }
}
