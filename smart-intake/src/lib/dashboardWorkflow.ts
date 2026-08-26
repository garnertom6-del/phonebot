export const NEEDS_ACTION_STATUSES = ["SUBMITTED", "NEEDS_REVIEW", "SIGNED"] as const;

export type DashboardReadiness = {
  state: string;
  tone: "good" | "warn" | "brand";
  issues: string[];
};

type DashboardWorkflowInput = {
  status: string;
  missingRequiredCount: number;
  packetState: "missing" | "current" | "stale";
  hasCca: boolean;
  expectCca: boolean;
  hasStaffSignature: boolean;
  providerPacketReady: boolean;
};

export function needsStaffAction(
  status: string,
  readiness?: Pick<DashboardReadiness, "tone" | "state">,
): boolean {
  if (readiness?.tone === "warn") return true;
  return NEEDS_ACTION_STATUSES.includes(status as (typeof NEEDS_ACTION_STATUSES)[number]);
}

export function buildDashboardReadiness(input: DashboardWorkflowInput): DashboardReadiness {
  if (input.status === "NOT_STARTED") {
    return {
      state: "Waiting for client to start",
      tone: "brand",
      issues: ["Send a reminder if the client has not received the secure link."],
    };
  }

  if (input.status === "IN_PROGRESS") {
    return {
      state: "Waiting for client to finish",
      tone: "brand",
      issues: ["The client started the intake but has not submitted it."],
    };
  }

  if (input.missingRequiredCount > 0) {
    return {
      state: "Complete required information",
      tone: "warn",
      issues: [
        `${input.missingRequiredCount} required item${input.missingRequiredCount === 1 ? "" : "s"} need attention.`,
      ],
    };
  }

  if (input.expectCca && !input.hasCca) {
    return {
      state: "Upload the CCA",
      tone: "warn",
      issues: ["The clinician assessment is expected and has not been uploaded."],
    };
  }

  if (!input.hasStaffSignature) {
    return {
      state: "Add the Staff / QP signature",
      tone: "warn",
      issues: ["Open Review / edit and capture the qualified professional's signature."],
    };
  }

  if (!input.providerPacketReady) {
    return {
      state: "Provider packet setup required",
      tone: "warn",
      issues: ["A master administrator must upload, map, review, approve, and activate this provider's packet before PDF or DocuSign."],
    };
  }

  if (input.packetState === "missing") {
    return {
      state: "Generate the completed packet",
      tone: "brand",
      issues: ["Required information is complete. Review the answers, run preflight, and generate the PDF."],
    };
  }

  if (input.packetState === "stale") {
    return {
      state: "Regenerate the updated packet",
      tone: "warn",
      issues: ["Answers or signatures changed after the current PDF was generated."],
    };
  }

  if (input.status === "COMPLETED") {
    return {
      state: "Completed",
      tone: "good",
      issues: ["No workflow action is due."],
    };
  }

  return {
    state: "Ready for final staff review",
    tone: "good",
    issues: ["Confirm staff signatures and packet accuracy, then mark the intake completed."],
  };
}
