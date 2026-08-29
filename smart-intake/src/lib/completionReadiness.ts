import type { MissingField } from "@/lib/validation";
import {
  packetFreshnessForIntake,
  type PacketFreshness,
  type PacketFreshnessState,
} from "@/lib/packetFreshness";
import {
  generationReadinessForIntake,
  type GenerationBlockerCode,
} from "@/lib/generationReadiness";

export type CompletionBlockerCode =
  | GenerationBlockerCode
  | "archived"
  | "not_submitted"
  | "required_fields"
  | "cca_missing"
  | "staff_signature_missing"
  | "provider_packet_not_ready"
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
  providerPacketReady: boolean;
  providerPacketMessage?: string;
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
  if (!input.providerPacketReady) {
    blockers.push({
      code: "provider_packet_not_ready",
      message: input.providerPacketMessage || "The provider packet must be uploaded, mapped, reviewed, approved, and activated by a master administrator.",
    });
  } else if (input.packetState === "missing") {
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
  const generation = await generationReadinessForIntake(intakeId, providerId);
  if (!generation) return null;
  const packet = await packetFreshnessForIntake(intakeId);
  const blockers: CompletionBlocker[] = generation.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
  }));
  if (packet.state === "missing") {
    blockers.push({ code: "packet_missing", message: "Generate the completed packet." });
  } else if (packet.state === "stale") {
    blockers.push({ code: "packet_stale", message: "Answers, signatures, or the packet template changed. Generate a new packet version." });
  }
  return { ready: blockers.length === 0, blockers, packetState: packet.state, packet };
}
