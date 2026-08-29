import type { SignatureStatus } from "@/lib/signatureStatus";
import { missingRequiredSignatures } from "@/lib/signatureStatus";

export type CaseStatusTone = "warn" | "brand" | "good";

export type CaseWorkflowStep = {
  key: string;
  label: string;
  done: boolean;
  skipped?: boolean;
};

export type CasePageStatus = {
  headline: string;
  detail: string;
  tone: CaseStatusTone;
  sendCopiesAllowed: boolean;
  steps: CaseWorkflowStep[];
};

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function signatureHeadline(missing: SignatureStatus[]): string {
  const labels = missing.map((status) => status.label);
  if (labels.length === 1 && missing[0]?.key === "client_guardian") {
    return "Need client / guardian signature";
  }
  if (labels.length === 1) return `Need ${labels[0]} signature`;
  return `Need ${joinLabels(labels)} signatures`;
}

function firstOpenStep(steps: CaseWorkflowStep[]): CaseWorkflowStep | undefined {
  return steps.find((step) => !step.done && !step.skipped);
}

/**
 * One staff-facing truth for the case header, stepper, and send-copies gate.
 * Never reports packet-complete / signed-complete while CCA or required
 * signatures are still missing.
 */
export function buildCasePageStatus(input: {
  status: string;
  missingRequiredCount: number;
  expectCca: boolean;
  hasCca: boolean;
  signatureStatuses: SignatureStatus[];
  generatedPdfCount: number;
  providerPacketReady: boolean;
  copiesSent: boolean;
  reviewed: boolean;
  providerPacketMessage?: string;
}): CasePageStatus {
  const missingSignatures = missingRequiredSignatures(input.signatureStatuses);
  const signaturesDone = missingSignatures.length === 0;
  const ccaDone = !input.expectCca || input.hasCca;
  const packetGenerated = input.generatedPdfCount > 0 && ccaDone;
  const sendCopiesAllowed = (
    ["SIGNED", "COMPLETED"].includes(input.status)
    && signaturesDone
    && ccaDone
    && packetGenerated
    && input.providerPacketReady
  );

  const steps: CaseWorkflowStep[] = [
    { key: "send_link", label: "Send link", done: input.status !== "NOT_STARTED" },
    {
      key: "client_answers",
      label: "Client answers",
      done: ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(input.status),
    },
    { key: "cca", label: "Add CCA", done: input.hasCca, skipped: !input.expectCca },
    { key: "review", label: "Review answers", done: input.reviewed },
    { key: "signatures", label: "Signatures", done: signaturesDone },
    { key: "generate", label: "Generate packet", done: packetGenerated },
    { key: "send", label: "Send records", done: input.copiesSent },
  ];

  if (input.status === "NOT_STARTED") {
    return {
      headline: "Waiting for client to start",
      detail: "Send or renew the secure link so the client can begin.",
      tone: "brand",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (input.status === "IN_PROGRESS") {
    return {
      headline: "Waiting for client to finish",
      detail: "The client started the intake but has not submitted it.",
      tone: "brand",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (input.missingRequiredCount > 0) {
    return {
      headline: `Need ${input.missingRequiredCount} required answer${input.missingRequiredCount === 1 ? "" : "s"}`,
      detail: "Required packet items are still blank. Ask the client or fill them in Review / edit.",
      tone: "warn",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (!ccaDone) {
    return {
      headline: "Need CCA",
      detail: "Upload the clinician assessment before treating generate or send as finished.",
      tone: "warn",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (!signaturesDone) {
    return {
      headline: signatureHeadline(missingSignatures),
      detail: "Send copies stays blocked until the required signature roles for this packet are captured.",
      tone: "warn",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (!input.providerPacketReady) {
    return {
      headline: "Provider packet setup required",
      detail: input.providerPacketMessage
        || "A master administrator must approve and activate this provider's packet before generate or send.",
      tone: "warn",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (!packetGenerated) {
    return {
      headline: "Generate the packet",
      detail: "Required answers, CCA, and signatures are in. Generate the completed PDF next.",
      tone: "brand",
      sendCopiesAllowed: false,
      steps,
    };
  }
  if (input.copiesSent || input.status === "COMPLETED") {
    return {
      headline: input.status === "COMPLETED" ? "Completed" : "Copies sent",
      detail: "Required packet items and signatures are present.",
      tone: "good",
      sendCopiesAllowed,
      steps,
    };
  }
  const next = firstOpenStep(steps);
  return {
    headline: "Ready to send copies",
    detail: next?.key === "send"
      ? "Required signatures are on the case. Send client copies when staff review is finished."
      : "Required packet items and signatures are present.",
    tone: "good",
    sendCopiesAllowed,
    steps,
  };
}
