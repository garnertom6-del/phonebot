import { staffReviewCountFromSummary } from "@/lib/dashboardWorkflow";
import { packetDisplayStatus, type PacketDisplayStatus, type PacketDisplayTemplate } from "@/lib/packetDisplayStatus";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";

export type MasterProviderListPacket = PacketDisplayStatus & {
  originalFileName: string | null;
  pageCount: number | null;
};

export type MasterProviderListExtras = {
  staffReviewCount: number;
  packetDisplay: MasterProviderListPacket;
  filenameWarning: string | null;
};

export function visiblePacketTemplate<T extends { isActive: boolean; updatedAt: string | Date }>(
  templates: T[],
): T | null {
  const active = templates.find((template) => template.isActive);
  if (active) return active;
  return templates.reduce<T | null>((latest, template) => {
    if (!latest) return template;
    return new Date(template.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? template : latest;
  }, null);
}

/**
 * Fields the master provider list and its tests share. Keep this in sync with
 * the GET /api/master/providers payload extras.
 */
export function buildMasterProviderListExtras(input: {
  name: string;
  intakeSummary?: Record<string, number> | null;
  packetTemplate?: PacketDisplayTemplate | null;
  otherProviderNames?: string[];
}): MasterProviderListExtras {
  const packetDisplay = packetDisplayStatus(
    input.packetTemplate,
    input.name,
    input.otherProviderNames,
  );
  return {
    staffReviewCount: staffReviewCountFromSummary(input.intakeSummary),
    packetDisplay: {
      ...packetDisplay,
      originalFileName: input.packetTemplate?.originalFileName || input.packetTemplate?.name || null,
      pageCount: input.packetTemplate?.pageCount ?? null,
    },
    filenameWarning: packetDisplay.filenameWarning
      || packetFilenameWarning(
        input.packetTemplate?.originalFileName,
        input.name,
        input.otherProviderNames,
      )?.message
      || null,
  };
}
