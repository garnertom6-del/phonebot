import { prisma } from "@/lib/prisma";
import { ELIGIBILITY_KEYS } from "@/lib/eligibilityState";
import { STAFF_PREFILLED_CLIENT_FIELDS_KEY } from "@/config/mooreDivineQuestions";
import { fileExists } from "@/lib/storage";
import { providerPacketReadiness } from "@/lib/providerPacketTemplates";

export type PacketFreshnessState = "missing" | "current" | "stale";

export type PacketFreshness = {
  state: PacketFreshnessState;
  pdfId: string | null;
  filePath: string | null;
  generatedAt: Date | null;
  sourceUpdatedAt: Date | null;
};

const IGNORED_ANSWER_KEYS = [
  "auto_send_completed_copies",
  "auto_email_provider_packet",
  "hipaa_copy",
  "welcome_letter_ack",
  "staff_helper_notes",
  "clinician_name",
  "c_clinician",
  "cca_provider_credentials",
  "dis_prepared_by",
  ...Object.values(ELIGIBILITY_KEYS),
  STAFF_PREFILLED_CLIENT_FIELDS_KEY,
];

export function evaluatePacketFreshness(input: {
  latestPdf?: { id: string; filePath?: string | null; createdAt: Date; contentRevision?: number | null } | null;
  latestAnswerUpdatedAt?: Date | null;
  latestSignatureUpdatedAt?: Date | null;
  packetTemplateUpdatedAt?: Date | null;
  currentContentRevision?: number | null;
}): PacketFreshness {
  const latestPdf = input.latestPdf || null;
  const sourceDates = [input.latestAnswerUpdatedAt, input.latestSignatureUpdatedAt, input.packetTemplateUpdatedAt]
    .filter((value): value is Date => value instanceof Date);
  const sourceUpdatedAt = sourceDates.length
    ? new Date(Math.max(...sourceDates.map((value) => value.getTime())))
    : null;

  if (!latestPdf) {
    return {
      state: "missing",
      pdfId: null,
      filePath: null,
      generatedAt: null,
      sourceUpdatedAt,
    };
  }

  return {
    state: (
      input.currentContentRevision != null
      && latestPdf.contentRevision != null
      && latestPdf.contentRevision !== input.currentContentRevision
    ) || (sourceUpdatedAt && sourceUpdatedAt.getTime() > latestPdf.createdAt.getTime())
      ? "stale"
      : "current",
    pdfId: latestPdf.id,
    filePath: latestPdf.filePath || null,
    generatedAt: latestPdf.createdAt,
    sourceUpdatedAt,
  };
}

export async function packetFreshnessForIntake(intakeId: string): Promise<PacketFreshness> {
  const [pdfCandidates, latestAnswer, latestSignatureAudit, intake] = await Promise.all([
    prisma.generatedPdf.findMany({
      where: { intakeId },
      orderBy: { createdAt: "desc" },
      select: { id: true, filePath: true, createdAt: true, contentRevision: true },
      take: 5,
    }),
    prisma.intakeAnswer.findFirst({
      where: { intakeId, key: { notIn: IGNORED_ANSWER_KEYS } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { intakeId, event: "signature_captured" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.intake.findUnique({
      where: { id: intakeId },
      select: { providerId: true, contentRevision: true },
    }),
  ]);
  const latestPdf = pdfCandidates.find((candidate) => fileExists(candidate.filePath)) || null;
  const providerPacket = intake?.providerId
    ? await providerPacketReadiness(intake.providerId)
    : null;
  const packetTemplateUpdatedAt = providerPacket?.ready && providerPacket.templateUpdatedAt
    ? new Date(providerPacket.templateUpdatedAt)
    : null;

  return evaluatePacketFreshness({
    latestPdf,
    latestAnswerUpdatedAt: latestAnswer?.updatedAt,
    latestSignatureUpdatedAt: latestSignatureAudit?.createdAt,
    packetTemplateUpdatedAt,
    currentContentRevision: intake?.contentRevision,
  });
}

export function packetFreshnessIgnoredAnswerKeys(): string[] {
  return [...IGNORED_ANSWER_KEYS];
}
