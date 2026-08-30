import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { audit } from "@/lib/auditLog";
import { appendPcpPlanSignaturePage, pcpIddDocumented } from "@/lib/pcpPlanSignaturePage";
import { parseCcaReview } from "@/lib/ccaReview";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, nonMaterialAnswerKeys } from "@/lib/intakeData";
import { saveFile } from "@/lib/storage";
import { appendCertificatePage } from "@/lib/certificate";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { requireProviderPacketForCompletion } from "@/lib/providerPacketTemplates";
import { brandText } from "@/lib/providerBranding";
import {
  buildSignatureStatuses,
  mappedSignatureSlotsFromFields,
  requiredSignatureSlotsFromFields,
} from "@/lib/signatureStatus";
import { normalizeDate as normalizeRecordDate, normalizeIdentityName as normalizeRecordIdentityName } from "@/lib/recordIntegrity";
import { extractPdfText } from "@/lib/pdfText";

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

function assertPacketIdentity(
  intake: { client: { fullName: string; dob: string } },
  answers: Record<string, unknown>,
) {
  const answerName = normalizedName(answers.client_full_name);
  const recordName = normalizedName(intake.client.fullName);
  const identityNameMatch = normalizeRecordIdentityName(answerName) === normalizeRecordIdentityName(recordName);
  const nameMismatch = !!(answerName && recordName && !identityNameMatch);
  if (nameMismatch) {
    throw new PacketIdentityMismatchError(intake.client.fullName, String(answers.client_full_name));
  }
  // Use the same date/name normalizers the readiness gate uses, so a client
  // record typed as 10/21/2026 and a date-box answer of 2026-10-21 are treated
  // as the same day instead of dead-ending generation with an identity error.
  const answerDob = normalizeRecordDate(answers.dob);
  const recordDob = normalizeRecordDate(intake.client.dob);
  if (answerDob && recordDob && answerDob !== recordDob) {
    throw new Error(
      `Packet identity check failed: client DOB does not match the intake record. Review the DOB before generating.`,
    );
  }
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

const PACKET_VERSION_RETRY_LIMIT = 5;

function retryablePacketVersionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
}

async function createVersionedPdfRecord(input: {
  intakeId: string;
  filePath: string;
  sha256: string;
  contentRevision: number;
}): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PACKET_VERSION_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const latestVersion = await tx.generatedPdf.findFirst({
          where: { intakeId: input.intakeId },
          orderBy: { packetVersion: "desc" },
          select: { packetVersion: true },
        });
        const packetVersion = (latestVersion?.packetVersion || 0) + 1;
        await tx.generatedPdf.create({
          data: {
            intakeId: input.intakeId,
            filePath: input.filePath,
            sha256: input.sha256,
            packetVersion,
            contentRevision: input.contentRevision,
          },
        });
        return packetVersion;
      });
    } catch (error) {
      if (!retryablePacketVersionError(error) || attempt === PACKET_VERSION_RETRY_LIMIT - 1) throw error;
      lastError = error;
      const exponential = Math.min(20 * (2 ** attempt), 250);
      const jitter = Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }
  }
  throw lastError || new Error("Could not reserve a packet version.");
}

export async function generatePacketForIntake(
  intakeId: string,
  userId: string,
  providerId?: string,
) {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, ...(providerId ? { providerId } : {}) },
    include: { client: true, provider: true, signatures: true },
  });
  if (!intake) return null;

  const answers = await loadAnswers(intake.id);
  assertPacketIdentity(intake, answers);
  const packetClientName = intake.client.fullName;
  const providerName = intake.provider?.name?.trim() || "Provider";
  answers.provider_name = providerName;
  answers.provider_staff_signature_label = `${providerName} Staff Signature`;
  answers.provider_staff_witness_label = `${providerName} Staff Witness:`;
  const signatures = await loadSignatures(intake.id);
  const latestMaterialAnswer = await prisma.intakeAnswer.findFirst({
    where: { intakeId: intake.id, key: { notIn: nonMaterialAnswerKeys() } },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  const consents = consentsFromAnswers(answers);
  const packetTemplate = await requireProviderPacketForCompletion(intake.providerId!);
  const result = await fillPacket({
    answers,
    signatures,
    consents,
    templateBytes: packetTemplate.bytes,
    fields: packetTemplate.fields,
  });
  const signatureStatuses = buildSignatureStatuses(intake.signatures, {
    client: intake.client,
    currentContentRevision: intake.contentRevision,
    latestMaterialUpdatedAt: latestMaterialAnswer?.updatedAt,
    mappedSlots: mappedSignatureSlotsFromFields(packetTemplate.fields),
    requiredSlots: requiredSignatureSlotsFromFields(packetTemplate.fields),
  });
  const signatureFieldKeys = new Set(
    packetTemplate.fields
      .filter((field) => field.type === "signature" || field.type === "signature_small")
      .map((field) => field.fieldKey),
  );
  const skippedSignatureSlots = result.skipped.filter((fieldKey) => signatureFieldKeys.has(fieldKey));
  const missingSignatureStatuses = signatureStatuses.filter((status) => (
    status.state !== "captured" && status.required
  ));
  const signatureAudit = {
    captured: signatureStatuses.filter((status) => status.state === "captured").length,
    missing: missingSignatureStatuses.length,
    requiredMissing: missingSignatureStatuses.length,
    missingLabels: missingSignatureStatuses.map((status) => status.label),
    mappedSignatureSlots: signatureFieldKeys.size,
    skippedSignatureSlots: skippedSignatureSlots.length,
    skippedSignatureFields: skippedSignatureSlots.slice(0, 20),
  };
  await audit("signature_audited", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    userId,
    detail: `${signatureAudit.captured} captured, ${signatureAudit.missing} required role(s) missing, ${signatureAudit.skippedSignatureSlots} optional or inapplicable PDF signature line(s) left blank`,
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
  // Only sign-off rows that are still valid at this content revision are drawn
  // on the packet, so the certificate must list those same rows - not a
  // superseded/invalidated signature the pages never show.
  const validSignatureRows = intake.signatures.filter((s) => (
    Object.prototype.hasOwnProperty.call(signatures, s.role)
  ));
  // The state PLAN SIGNATURES page is appended before the certificate so the
  // certificate's fingerprint covers it like every other packet page.
  const latestCcaDocument = await prisma.document.findFirst({
    where: { intakeId: intake.id, docType: "cca", reviewJson: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { reviewJson: true },
  });
  const pcp = await appendPcpPlanSignaturePage(result.pdfBytes, {
    clientName: packetClientName,
    dob: intake.client.dob || String(answers.dob || ""),
    midNumber: String(answers.mid_number || ""),
    recordNumber: String(answers.record_number || ""),
    caseManagementAgency: intake.provider?.name || "",
    clientIsOwnLegalRepresentative: String(answers.is_minor_or_incompetent || "").toLowerCase() !== "yes",
    guardianRelationship: String(answers.guardian_relationship || ""),
    iddDocumented: pcpIddDocumented(parseCcaReview(latestCcaDocument?.reviewJson)),
    signatures,
  });

  const { pdfBytes, sha256 } = await appendCertificatePage(pcp.pdfBytes, {
    clientName: packetClientName,
    providerName: intake.provider?.name || undefined,
    signers: validSignatureRows.map((s) => ({
      role: s.role,
      printedName: s.printedName,
      relationship: s.relationship,
      signedDate: s.signedDate,
      dobVerified: s.dobVerified,
      ip: s.ip,
      // Signature rows are replaced in place on re-sign. updatedAt is the
      // current capture time; createdAt belongs to the superseded signature.
      capturedAt: s.updatedAt,
    })),
    signatureStatuses,
    consentLabels,
    generatedAt: new Date(),
  });
  const rel = `generated/${intake.id}/${Date.now()}-${randomUUID()}-intake-packet.pdf`;
  saveFile(rel, Buffer.from(pdfBytes));
  const packetVersion = await createVersionedPdfRecord({
    intakeId: intake.id,
    filePath: rel,
    sha256,
    contentRevision: intake.contentRevision,
  });
  const signed = signatures.client || signatures.guardian;
  if (signed && intake.status !== "COMPLETED") {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
  }
  const warningCount = result.warnings?.length || 0;
  await audit("pdf_generated", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    userId,
    detail: `${result.filled} fields filled using ${packetTemplate.originalFileName}`
      + (warningCount ? `; ${warningCount} field(s) could not be drawn and were left blank: ${result.warnings!.slice(0, 10).join("; ")}` : "")
      + (pcp.signedBy ? `; PLAN SIGNATURES page signed by ${pcp.signedBy}` : "")
      + (pcp.warnings.length ? `; ${pcp.warnings.join("; ")}` : ""),
  });
  return {
    filled: result.filled,
    skipped: result.skipped.length,
    signatureAudit,
    packetVersion,
    contentRevision: intake.contentRevision,
  };
}
