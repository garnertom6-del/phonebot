import { prisma } from "@/lib/prisma";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { loadAnswers } from "@/lib/intakeData";
import { missingRequired, type MissingField } from "@/lib/validation";
import {
  packetFreshnessForIntake,
  type PacketFreshness,
  type PacketFreshnessState,
} from "@/lib/packetFreshness";

export type CompletionBlockerCode =
  | "archived"
  | "not_submitted"
  | "required_fields"
  | "cca_missing"
  | "staff_signature_missing"
  | "packet_missing"
  | "packet_stale";

export type CompletionBlocker = {
  code: CompletionBlockerCode;
  message: string;
};

export type CompletionReadiness = {
  ready: boolean;
  blockers: CompletionBlocker[];
  packetState: PacketFreshnessState;
};

export function buildCompletionReadiness(input: {
  archived: boolean;
  submittedAt: Date | string | null;
  missingRequired: MissingField[];
  expectCca: boolean;
  hasCca: boolean;
  hasStaffSignature: boolean;
  packetState: PacketFreshnessState;
}): CompletionReadiness {
  const blockers: CompletionBlocker[] = [];

  if (input.archived) {
    blockers.push({ code: "archived", message: "Restore this intake before completing it." });
  }
  if (!input.submittedAt) {
    blockers.push({ code: "not_submitted", message: "The client has not submitted the intake yet." });
  }
  if (input.missingRequired.length) {
    const labels = input.missingRequired.slice(0, 4).map((item) => item.label).join(", ");
    const more = Math.max(0, input.missingRequired.length - 4);
    blockers.push({
      code: "required_fields",
      message: `Complete required information: ${labels}${more ? ` and ${more} more` : ""}.`,
    });
  }
  if (input.expectCca && !input.hasCca) {
    blockers.push({ code: "cca_missing", message: "Upload the clinician's CCA." });
  }
  if (!input.hasStaffSignature) {
    blockers.push({
      code: "staff_signature_missing",
      message: "Add the Staff / QP signature on the review screen.",
    });
  }
  if (input.packetState === "missing") {
    blockers.push({ code: "packet_missing", message: "Generate the completed packet." });
  } else if (input.packetState === "stale") {
    blockers.push({
      code: "packet_stale",
      message: "Answers or signatures changed after the packet was generated. Generate it again.",
    });
  }

  return { ready: blockers.length === 0, blockers, packetState: input.packetState };
}

export async function completionReadinessForIntake(
  intakeId: string,
  providerId: string,
): Promise<(CompletionReadiness & { packet: PacketFreshness }) | null> {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, providerId },
    include: {
      signatures: { select: { role: true } },
      uploadedDocuments: {
        where: { docType: "CCA" },
        select: { id: true },
        take: 1,
      },
      auditLogs: {
        where: { event: "docusign_completed" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!intake) return null;

  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const hasClientSignature = intake.auditLogs.length > 0 || intake.signatures.some((signature) =>
    signature.role === "client" || signature.role === "guardian");
  const hasStaffSignature = intake.signatures.some((signature) =>
    signature.role === "staff" || signature.role === "clinician");
  const packet = await packetFreshnessForIntake(intake.id);
  const readiness = buildCompletionReadiness({
    archived: intake.archived,
    submittedAt: intake.submittedAt,
    missingRequired: missingRequired(answers, hasClientSignature),
    expectCca: intake.expectCca,
    hasCca: intake.uploadedDocuments.length > 0,
    hasStaffSignature,
    packetState: packet.state,
  });

  return { ...readiness, packet };
}
