import { isValidProviderPacketMappingScore } from "@/lib/packetMappingScore";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";

export type PacketDisplayTemplate = {
  originalFileName?: string | null;
  name?: string | null;
  pageCount?: number | null;
  isActive: boolean;
  mappingStatus: string;
  mappingScore?: number | null;
  approvedAt?: string | Date | null;
};

export type PacketDisplayStatus = {
  label: string;
  scoreLabel: string;
  detail: string;
  className: string;
  badge: string;
  filenameWarning: string | null;
};

const SCORE_UNAVAILABLE = "Score unavailable";

function scoreLabelFor(template: PacketDisplayTemplate, fallback: string): string {
  if (isValidProviderPacketMappingScore(template.mappingScore)) {
    return `${template.mappingScore}%`;
  }
  return fallback;
}

function badge(label: string, scoreLabel: string): string {
  return `${label} · ${scoreLabel}`;
}

/**
 * One packet badge for the master provider list. Missing scores must never
 * render the word "Review" as if it were a mapping score.
 */
export function packetDisplayStatus(
  template: PacketDisplayTemplate | null | undefined,
  providerName = "",
): PacketDisplayStatus {
  if (!template) {
    return {
      label: "No packet uploaded",
      scoreLabel: SCORE_UNAVAILABLE,
      detail: "Upload the provider's blank intake packet",
      className: "bg-red-100 text-red-800",
      badge: badge("No packet uploaded", SCORE_UNAVAILABLE),
      filenameWarning: null,
    };
  }

  const filenameWarning = packetFilenameWarning(providerName, template.originalFileName);
  const validScore = isValidProviderPacketMappingScore(template.mappingScore);

  if (template.isActive && (template.mappingStatus !== "APPROVED" || !validScore || !template.approvedAt)) {
    const label = "Not ready - approval required";
    const scoreLabel = scoreLabelFor(template, SCORE_UNAVAILABLE);
    return {
      label,
      scoreLabel,
      detail: validScore ? `Mapping score ${template.mappingScore}/100` : "Mapping score and approval timestamp are missing.",
      className: "bg-amber-100 text-amber-900",
      badge: badge(label, scoreLabel),
      filenameWarning,
    };
  }

  if (template.isActive) {
    const label = "Active";
    const scoreLabel = scoreLabelFor(template, SCORE_UNAVAILABLE);
    return {
      label,
      scoreLabel,
      detail: validScore ? `Approved active packet at ${template.mappingScore}/100` : "Approved active packet. Mapping score is missing.",
      className: "bg-emerald-100 text-emerald-800",
      badge: badge(label, scoreLabel),
      filenameWarning,
    };
  }

  if (template.mappingStatus === "MAPPING") {
    const label = "AI mapping...";
    return {
      label,
      scoreLabel: "Working",
      detail: "Mapping is running in the background",
      className: "bg-sky-100 text-sky-800",
      badge: badge(label, "Working"),
      filenameWarning,
    };
  }

  if (template.mappingStatus === "APPROVED") {
    const label = "Approved history";
    const scoreLabel = scoreLabelFor(template, SCORE_UNAVAILABLE);
    return {
      label,
      scoreLabel,
      detail: "Approved but not the active packet",
      className: "bg-slate-200 text-slate-700",
      badge: badge(label, scoreLabel),
      filenameWarning,
    };
  }

  const label = "Needs review";
  const scoreLabel = scoreLabelFor(template, SCORE_UNAVAILABLE);
  return {
    label,
    scoreLabel,
    detail: validScore ? `Mapping score ${template.mappingScore}/100` : "Mapping score is missing. Open packet mapping to check this draft.",
    className: "bg-amber-100 text-amber-900",
    badge: badge(label, scoreLabel),
    filenameWarning,
  };
}
