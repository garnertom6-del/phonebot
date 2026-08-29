export const NEEDS_ACTION_STATUSES = ["SUBMITTED", "NEEDS_REVIEW", "SIGNED"] as const;

export const INTAKE_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  NEEDS_REVIEW: "In staff review",
  SIGNED: "Client signed",
  COMPLETED: "Completed",
};

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

export type DashboardQueueRow = {
  status: string;
  archived?: boolean;
  readiness?: Pick<DashboardReadiness, "tone" | "state">;
  hasCca?: boolean;
  completionReady?: boolean;
};

/**
 * Needs staff action is open staff work only. Completed intakes never belong
 * here, even when a stale packet or missing CCA still shows a warn next-step.
 * Not-started and in-progress intakes stay in Waiting on client.
 */
export function needsStaffAction(
  status: string,
  readiness?: Pick<DashboardReadiness, "tone" | "state">,
): boolean {
  if (status === "COMPLETED") return false;
  if (NEEDS_ACTION_STATUSES.includes(status as (typeof NEEDS_ACTION_STATUSES)[number])) return true;
  if (status === "NOT_STARTED" || status === "IN_PROGRESS") return false;
  return readiness?.tone === "warn";
}

export function matchesDashboardTab(row: DashboardQueueRow, tab: string): boolean {
  if (tab === "archived") return !!row.archived;
  if (row.archived) return false;
  switch (tab) {
    case "action":
      return needsStaffAction(row.status, row.readiness);
    case "waiting":
      return row.status === "NOT_STARTED" || row.status === "IN_PROGRESS";
    case "signed":
      return row.status === "SIGNED";
    case "done":
      return row.status === "COMPLETED";
    case "packet":
      return row.status !== "COMPLETED" && !!row.completionReady;
    case "cca":
      return !!row.hasCca;
    case "copies":
      return row.status === "SIGNED" || row.status === "COMPLETED";
    case "all":
      return true;
    default:
      return true;
  }
}

export function countDashboardTab(rows: DashboardQueueRow[], tab: string): number {
  return rows.filter((row) => matchesDashboardTab(row, tab)).length;
}

/** Card, tab, and visible list must share this count when search is empty. */
export function staffActionQueueCount(rows: DashboardQueueRow[]): number {
  return countDashboardTab(rows, "action");
}

/** Count intakes that belong in the shared staff-review queue. Archived rows must be omitted before calling this. */
export function staffReviewCountFromSummary(summary?: Record<string, number> | null): number {
  return NEEDS_ACTION_STATUSES.reduce((total, status) => total + (summary?.[status] || 0), 0);
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
