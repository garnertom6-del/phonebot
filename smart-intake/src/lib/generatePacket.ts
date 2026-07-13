import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { appendCertificatePage } from "@/lib/certificate";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { packetTemplateForProvider } from "@/lib/providerPacketTemplates";
import { brandText } from "@/lib/providerBranding";
import { buildSignatureStatuses } from "@/lib/signatureStatus";
import { extractPdfText } from "@/lib/pdfText";

export interface GeneratePacketOptions {
  skipAutoCompletedCopies?: boolean;
  allowNameMismatch?: boolean;
}

export class PacketIdentityMismatchError extends Error {
  code = "IDENTITY_MISMATCH" as const;
  recordName: string;
  answerName: string;

  constructor(recordName: string, answerName: string) {
    super(
      `Packet identity check failed: client record is "${recordName}" but intake answers say "${answerName}". Review the client record before generating.`,
    );
    this.name = "PacketIdentityMismatchError";
    this.recordName = recordName;
    this.answerName = answerName;
  }
}

function normalizedName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedIdentityName(value: unknown): string {
  return normalizedName(value).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function normalizedDate(value: unknown): string {
  const raw = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return iso ? `${iso[1]}${iso[2]}${iso[3]}` : raw.replace(/\D/g, "");
}

function assertPacketIdentity(
  intake: { client: { fullName: string; dob: string } },
  answers: Record<string, unknown>,
  options: { allowNameMismatch?: boolean } = {},
) {
  const answerName = normalizedName(answers.client_full_name);
  const recordName = normalizedName(intake.client.fullName);
  const identityNameMatch = normalizedIdentityName(answerName) === normalizedIdentityName(recordName);
  const nameMismatch = !!(answerName && recordName && !identityNameMatch);
  if (nameMismatch && !options.allowNameMismatch) {
    throw new PacketIdentityMismatchError(intake.client.fullName, String(answers.client_full_name));
  }
  const answerDob = normalizedDate(answers.dob);
  const recordDob = normalizedDate(intake.client.dob);
  if (answerDob && recordDob && answerDob !== recordDob) {
    throw new Error(
      `Packet identity check failed: client DOB does not match the intake record. Review the DOB before generating.`,
    );
  }
  return { nameMismatch };
}

function assertRenderedPacketText(text: string, expectedClientName: string, providerName: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const expectedName = normalizedName(expectedClientName);
  const conflictingNames = ["john snipes", "markey washington"]
    .filter((name) => name !== expectedName && normalized.includes(name));
  if (conflictingNames.length) {
    throw new Error(
      `Packet identity check failed: rendered packet contains another client name (${conflictingNames.join(", ")}) besides "${expectedClientName}". Review the provider template and client record before generating.`,
    );
  }
  const staleProviders = ["seanar achievement center", "seanar", "moore divine care"]
    .filter((name) => !normalizedName(providerName).includes(name) && normalized.includes(name));
  if (staleProviders.length) {
    throw new Error(
      `Packet template check failed: the rendered packet contains older provider text. No packet was generated. To fix it, upload the correct clean ${providerName} packet in Master Dashboard > Provider Packet Setup, activate/approve that packet, then try Generate Completed Packet again.`,
    );
  }
}

export async function generatePacketForIntake(
  intakeId: string,
  userId: string,
  providerId?: string,
  options: GeneratePacketOptions = {},
) {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, ...(providerId ? { providerId } : {}) },
    include: { client: true, provider: true, signatures: true },
  });
  if (!intake) return null;

  const answers = await loadAnswers(intake.id);
  const identity = assertPacketIdentity(intake, answers, options);
  const packetClientName = identity.nameMismatch
    ? String(answers.client_full_name || intake.client.fullName)
    : intake.client.fullName;
  if (identity.nameMismatch && options.allowNameMismatch) {
    await audit("packet_identity_override", {
      providerId: intake.providerId || undefined,
      intakeId: intake.id,
      userId,
      detail: "Staff confirmed a client-name mismatch before packet generation",
    });
  }
  const providerName = intake.provider?.name?.trim() || "Provider";
  answers.provider_name = providerName;
  answers.provider_staff_signature_label = `${providerName} Staff Signature`;
  answers.provider_staff_witness_label = `${providerName} Staff Witness:`;
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
  const signatureStatuses = buildSignatureStatuses(intake.signatures);
  const signatureFieldKeys = new Set(
    packetTemplate.fields
      .filter((field) => field.type === "signature" || field.type === "signature_small")
      .map((field) => field.fieldKey),
  );
  const skippedSignatureSlots = result.skipped.filter((fieldKey) => signatureFieldKeys.has(fieldKey));
  const missingSignatureStatuses = signatureStatuses.filter((status) => status.state === "missing");
  const signatureAudit = {
    captured: signatureStatuses.filter((status) => status.state === "captured").length,
    missing: missingSignatureStatuses.length,
    requiredMissing: missingSignatureStatuses.filter((status) => status.required).length,
    missingLabels: missingSignatureStatuses.map((status) => status.label),
    mappedSignatureSlots: signatureFieldKeys.size,
    skippedSignatureSlots: skippedSignatureSlots.length,
    skippedSignatureFields: skippedSignatureSlots.slice(0, 20),
  };
  await audit("signature_audited", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    userId,
    detail: `${signatureAudit.captured} captured, ${signatureAudit.missing} role(s) missing, ${signatureAudit.skippedSignatureSlots} PDF signature slot(s) blank`,
  });
  assertRenderedPacketText(
    await extractPdfText(result.pdfBytes),
    packetClientName,
    providerName,
  );
  const consentLabels = Object.entries(consents)
    .filter(([, agreed]) => agreed)
    .map(([key]) => brandText(questionByKey(key)?.label || key, {
      name: intake.provider?.name,
      phone: intake.provider?.phone,
    }));
  const { pdfBytes, sha256 } = await appendCertificatePage(result.pdfBytes, {
    clientName: packetClientName,
    providerName: intake.provider?.name || undefined,
    signers: intake.signatures.map((s) => ({
      role: s.role,
      printedName: s.printedName,
      relationship: s.relationship,
      signedDate: s.signedDate,
      dobVerified: s.dobVerified,
      ip: s.ip,
      createdAt: s.createdAt,
    })),
    signatureStatuses,
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

  return { filled: result.filled, skipped: result.skipped.length, signatureAudit };
}
