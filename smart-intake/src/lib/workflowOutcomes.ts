export const WORKFLOW_STAGES = {
  CLIENT_RESPONSE: "Client response", CCA: "CCA", STAFF_REVIEW: "Staff review",
  QP_SIGNATURE: "QP signature", PACKET_SETUP: "Provider packet setup",
  PACKET_REGENERATION: "Packet generation / regeneration", DELIVERY: "Delivery",
  COMPLETE: "Complete", ABANDONED: "Abandoned", ARCHIVED: "Archived",
} as const;
export type WorkflowStage = keyof typeof WORKFLOW_STAGES;
export type WorkflowAction = {
  stage: WorkflowStage; label: string; reason: string; responsibleRole: string;
  href: string; since?: string | null; responsiblePerson?: string; packetId?: string | null;
};
export type WorkflowFacts = {
  id: string; status: string; submittedAt: Date | string | null;
  archived: boolean; abandonedAt?: Date | string | null;
  expectCca: boolean; hasCca: boolean; hasClientSignature: boolean;
  missingRequiredCount: number; hasStaffSignature: boolean; staffReviewed: boolean;
  providerPacketReady: boolean; packetState: "missing" | "current" | "stale";
  deliveryConfirmed: boolean; deliveryFailed: boolean; deliveryAttempted: boolean;
  openFollowUp: boolean;
  clientLinkExpired?: boolean; clientLinkReached?: boolean;
};

/** A single next step, ordered so work that invalidates signatures comes first. */
export function nextWorkflowAction(f: WorkflowFacts): WorkflowAction {
  const intake = `/intakes/${f.id}`;
  const action = (stage: WorkflowStage, label: string, reason: string, responsibleRole: string, href = intake): WorkflowAction => ({ stage, label, reason, responsibleRole, href });
  if (f.archived) return action("ARCHIVED", "Review archived intake", "This intake is archived.", "Assigned staff");
  if (f.abandonedAt) return action("ABANDONED", "Review or reopen intake", "Staff recorded intake abandonment. Reopen if the client resumes.", "Assigned staff");
  if (!f.submittedAt && f.clientLinkExpired) return action("STAFF_REVIEW", "Renew the client intake link", "The secure link expired before submission. Review the case and renew it before asking the client to continue.", "Assigned staff");
  if (!f.submittedAt && f.status === "NOT_STARTED" && f.clientLinkReached === false) return action("STAFF_REVIEW", "Prepare and send intake link", "No sent or opened intake link is recorded. Check insurance and contact details before sending.", "Assigned staff");
  if (!f.submittedAt) return action("CLIENT_RESPONSE", "Review client progress", f.status === "NOT_STARTED" ? "The client has not started or submitted the intake." : "The client has not submitted the intake.", "Client / guardian");
  if (f.expectCca && !f.hasCca) return action("CCA", "Upload and review CCA", "The expected clinician assessment is missing.", "Assigned staff / clinician", `${intake}#cca`);
  if (f.openFollowUp) return action("CLIENT_RESPONSE", "Review requested client answers", "A client follow-up is still open.", "Client / guardian");
  if (f.missingRequiredCount > 0 || !f.staffReviewed) return action("STAFF_REVIEW", "Review required information", f.missingRequiredCount ? `${f.missingRequiredCount} required item(s) need review. Request client answers only where needed.` : "The current answers need a staff review.", "Assigned staff", `${intake}/review`);
  if (!f.hasClientSignature) return action("CLIENT_RESPONSE", "Review client signature request", "A current client or guardian signature is required.", "Client / guardian");
  if (!f.hasStaffSignature) return action("QP_SIGNATURE", "Add current Staff / QP signature", "The current content needs the qualified professional's signature.", "Qualified professional", `${intake}/review`);
  if (!f.providerPacketReady) return action("PACKET_SETUP", "Review provider packet setup", "The provider packet must be mapped and approved.", "Master administrator");
  if (f.packetState !== "current") return action("PACKET_REGENERATION", f.packetState === "stale" ? "Regenerate updated packet" : "Generate reviewed packet", f.packetState === "stale" ? "The packet no longer matches the current answers, signatures, or template." : "A current packet has not been generated.", "Assigned staff");
  if (f.status !== "COMPLETED") return action("STAFF_REVIEW", "Complete final staff review", "Verify the packet and completion checks before marking completed.", "Assigned staff");
  if (!f.deliveryConfirmed) return action("DELIVERY", f.deliveryFailed ? "Resolve failed delivery" : f.deliveryAttempted ? "Verify copy delivery" : "Arrange completed-copy delivery", f.deliveryFailed ? "A completed-copy delivery failed. Review the destination and retry only after correcting it." : f.deliveryAttempted ? "A send was recorded; recipient delivery has not been confirmed." : "No completed-copy delivery has been recorded.", "Assigned staff");
  return action("COMPLETE", "View completed intake", "Completed-copy delivery is confirmed.", "No action due");
}

export const FAILURE_STATUSES = new Set(["failed", "undelivered", "canceled", "cancelled"]);
export function deliveryFacts(deliveries: Array<{status: string; purpose: string; createdAt: Date | string}>, logs: Array<{event: string; createdAt: Date | string; detail?: string | null}>, packetGeneratedAt?: Date | string | null, packetId?: string | null) {
  const cutoff = packetGeneratedAt ? new Date(packetGeneratedAt).getTime() : 0;
  const current = deliveries.filter(d => d.purpose === "completed_copies" && new Date(d.createdAt).getTime() >= cutoff);
  const currentLogs = logs.filter(l => new Date(l.createdAt).getTime() >= cutoff);
  const manualReceipt = currentLogs.some(l => {
    if (l.event !== "workflow_delivery_confirmed" || !packetId) return false;
    try { return JSON.parse(l.detail || "{}").packetId === packetId; } catch { return false; }
  });
  const confirmed = current.some(d => d.status === "delivered" || d.status === "read") || manualReceipt;
  // A later confirmed delivery resolves an earlier failed attempt; old failures remain in outcomes.
  const attempts = [
    ...current.map(d => ({at:+new Date(d.createdAt),failed:FAILURE_STATUSES.has(d.status)})),
    ...currentLogs.filter(l => ["copies_link_failed","copies_link_sent"].includes(l.event)).map(l => ({at:+new Date(l.createdAt),failed:l.event==="copies_link_failed"})),
  ].sort((a,b) => b.at-a.at);
  return { deliveryConfirmed: confirmed, deliveryFailed: !confirmed && !!attempts[0]?.failed, deliveryAttempted: attempts.length > 0 || manualReceipt };
}

export function waitingLabel(since?: string | null, now = Date.now()): string {
  if (!since) return "Measurement starts when first observed";
  const minutes = Math.max(0, Math.floor((now - +new Date(since)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function summarizeWorkflowIntervals(intervals: Array<{stage: string; startedAt: Date | string; endedAt: Date | string | null}>, now = new Date()) {
  return Object.entries(WORKFLOW_STAGES).filter(([stage]) => !["COMPLETE", "ARCHIVED", "ABANDONED"].includes(stage)).map(([stage,label]) => {
    const rows = intervals.filter(i => i.stage === stage);
    const totalHours = rows.reduce((sum,i) => sum + Math.max(0, +(i.endedAt ? new Date(i.endedAt) : now) - +new Date(i.startedAt))/3600000, 0);
    return {stage, label, visits: rows.length, active: rows.filter(i => !i.endedAt).length, totalHours: Math.round(totalHours*10)/10, averageHours: rows.length ? Math.round(totalHours/rows.length*10)/10 : 0};
  });
}
