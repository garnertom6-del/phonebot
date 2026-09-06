import { clientLinkExpired } from "@/lib/clientLinkState";
import type { SignatureStatus } from "@/lib/signatureStatus";
import { missingRequiredSignatures } from "@/lib/signatureStatus";

export type CaseTimelineTone = "done" | "current" | "pending" | "warn";

export type CaseTimelineEvent = {
  key: string;
  label: string;
  detail?: string;
  at?: string | null;
  tone: CaseTimelineTone;
};

function formatWhen(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString();
}

/** Light timeline from existing case facts. Does not invent events or timestamps. */
export function buildCaseStatusTimeline(input: {
  linkSentAt?: string | Date | null;
  lastOpenedAt?: string | Date | null;
  missingRequiredCount: number;
  signatureStatuses: SignatureStatus[];
  tokenExpiresAt?: string | Date | null;
  status: string;
  now?: number;
}): CaseTimelineEvent[] {
  const now = input.now ?? Date.now();
  const expired = input.tokenExpiresAt ? clientLinkExpired(input.tokenExpiresAt, now) : false;
  const missingSignatures = missingRequiredSignatures(input.signatureStatuses);
  const events: CaseTimelineEvent[] = [];

  events.push({
    key: "link_sent",
    label: input.linkSentAt ? "Link sent" : "Link not sent yet",
    at: input.linkSentAt ? String(input.linkSentAt) : null,
    detail: formatWhen(input.linkSentAt),
    tone: input.linkSentAt ? "done" : "pending",
  });

  if (input.lastOpenedAt) {
    events.push({
      key: "client_progress",
      label: "Client opened the link",
      at: String(input.lastOpenedAt),
      detail: formatWhen(input.lastOpenedAt),
      tone: "done",
    });
  } else if (["IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(input.status)) {
    events.push({
      key: "client_progress",
      label: "Client started or submitted answers",
      tone: "done",
    });
  } else {
    events.push({
      key: "client_progress",
      label: "Waiting for client progress",
      tone: "pending",
    });
  }

  events.push({
    key: "missing",
    label: input.missingRequiredCount > 0
      ? `${input.missingRequiredCount} required answer${input.missingRequiredCount === 1 ? "" : "s"} missing`
      : "Required answers filled",
    tone: input.missingRequiredCount > 0 ? "current" : "done",
  });

  events.push({
    key: "signatures",
    label: missingSignatures.length > 0
      ? `Need ${missingSignatures.length} signature${missingSignatures.length === 1 ? "" : "s"}`
      : "Required signatures captured",
    tone: missingSignatures.length > 0 ? "current" : "done",
  });

  if (input.tokenExpiresAt) {
    events.push({
      key: "expiry",
      label: expired ? "Link expired" : "Link expires",
      at: String(input.tokenExpiresAt),
      detail: formatWhen(input.tokenExpiresAt),
      tone: expired ? "warn" : "pending",
    });
  }

  return events;
}
