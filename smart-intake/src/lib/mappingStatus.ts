export type PacketDisplayStatus = "draft" | "needs_review" | "approved_active" | "mapping";

export type PacketStatusView = {
  key: PacketDisplayStatus;
  label: string;
  detail: string;
  scoreLabel: string;
  className: string;
};

export type PacketStatusInput = {
  mappingStatus?: string | null;
  mappingScore?: number | null;
  mappingIssues?: string | null;
  isActive?: boolean;
  approvedAt?: Date | string | null;
  originalFileName?: string | null;
  pageCount?: number | null;
};

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function parseIssues(value: string | null | undefined): {
  blockingIssues?: unknown;
  warnings?: unknown;
  missingRequired?: unknown;
  overrideReason?: unknown;
} {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * One badge for a provider packet. Never combine Approved with Not ready.
 * draft = uploaded, not reviewed. needs_review = mapped but not live.
 * approved_active = signature-ready. mapping = AI still running.
 */
export function packetDisplayStatus(template: PacketStatusInput | null | undefined): PacketStatusView {
  if (!template) {
    return {
      key: "draft",
      label: "No packet",
      detail: "Upload the provider's blank intake packet",
      scoreLabel: "Missing",
      className: "bg-red-100 text-red-800",
    };
  }

  if (template.mappingStatus === "MAPPING") {
    return {
      key: "mapping",
      label: "AI mapping",
      detail: "Mapping is running in the background",
      scoreLabel: "Working",
      className: "bg-sky-100 text-sky-800",
    };
  }

  const approvedLive = template.mappingStatus === "APPROVED"
    && template.isActive === true
    && validScore(template.mappingScore)
    && !!template.approvedAt;

  if (approvedLive) {
    const issues = parseIssues(template.mappingIssues);
    const missingRequired = Array.isArray(issues.missingRequired) ? issues.missingRequired.length : 0;
    const overrideReason = typeof issues.overrideReason === "string" && issues.overrideReason.trim()
      ? issues.overrideReason.trim()
      : null;
    if (missingRequired > 0) {
      return {
        key: "needs_review",
        label: overrideReason ? "Active with override" : "Unresolved mappings",
        detail: `${missingRequired} required mapping${missingRequired === 1 ? " is" : "s are"} still missing.${overrideReason ? ` Recorded override: ${overrideReason}` : ""}`,
        scoreLabel: `${missingRequired} missing`,
        className: "bg-amber-100 text-amber-900",
      };
    }
    return {
      key: "approved_active",
      label: "Approved-active",
      detail: `Live packet${validScore(template.mappingScore) ? ` at ${template.mappingScore}/100` : ""}`,
      scoreLabel: validScore(template.mappingScore) ? `${template.mappingScore}/100` : "Active",
      className: "bg-emerald-100 text-emerald-800",
    };
  }

  if (template.mappingStatus === "APPROVED") {
    return {
      key: "needs_review",
      label: "Needs review",
      detail: template.isActive
        ? "Marked approved but missing a valid score or approval timestamp. Re-check mapping before use."
        : "Approved history exists, but this file is not the live packet.",
      scoreLabel: validScore(template.mappingScore) ? `${template.mappingScore}/100` : "Review",
      className: "bg-amber-100 text-amber-900",
    };
  }

  const issues = parseIssues(template.mappingIssues);
  const blocking = Array.isArray(issues.blockingIssues) ? issues.blockingIssues.length : 0;
  if (validScore(template.mappingScore) || blocking > 0) {
    return {
      key: "needs_review",
      label: "Needs review",
      detail: validScore(template.mappingScore)
        ? `Mapping score ${template.mappingScore}/100. Review missing fields, then approve.`
        : "Review mapping and approve before use",
      scoreLabel: validScore(template.mappingScore) ? `${template.mappingScore}/100` : "Draft",
      className: "bg-amber-100 text-amber-900",
    };
  }

  return {
    key: "draft",
    label: "Draft",
    detail: "Map required intake fields, run the quality check, then approve.",
    scoreLabel: "Draft",
    className: "bg-slate-200 text-slate-700",
  };
}
