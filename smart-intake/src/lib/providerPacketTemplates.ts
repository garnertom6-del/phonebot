import fs from "fs";
import path from "path";
import { PACKET_MAP, TEMPLATE_FILE, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { loadTemplateBytes, mergedMap } from "./fillPdf";
import { prisma } from "./prisma";
import { readFile } from "./storage";

export const DEFAULT_PACKET_TEMPLATE_NAME = "Moore Divine Care Client Intake Package";

type MappingRow = {
  fieldKey: string;
  page: number;
  data: string;
};

type TemplateRow = {
  id: string;
  name: string;
  filePath: string;
  pageCount: number;
  pageWidth: number | null;
  pageHeight: number | null;
  providerId: string | null;
  originalFileName: string | null;
  fieldMappings: MappingRow[];
};

export type PacketTemplateSelection = {
  templateId: string | null;
  name: string;
  filePath: string | null;
  originalFileName: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  providerSpecific: boolean;
  bytes: Buffer;
  fields: FieldMapping[];
  overrides: FieldMapping[];
};

function assertRelativePath(filePath: string) {
  if (path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes("..")) {
    throw new Error("Unsafe template path");
  }
}

export function loadTemplateFile(filePath: string): Buffer {
  const normalized = filePath.replace(/\\/g, "/");
  assertRelativePath(normalized);

  if (normalized.startsWith("public/") || normalized === TEMPLATE_FILE) {
    const candidates = [
      path.join(process.cwd(), normalized),
      path.join(process.cwd(), "public", "templates", path.basename(normalized)),
      path.join(process.cwd(), path.basename(normalized)),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    }
    throw new Error(`Template PDF not found: ${filePath}`);
  }

  return readFile(normalized);
}

function parseMappings(rows: MappingRow[]): FieldMapping[] {
  return rows.map((m) => ({
    fieldKey: m.fieldKey,
    page: m.page,
    ...JSON.parse(m.data),
  }));
}

/**
 * Keep known placement repairs effective for provider maps saved before the
 * mapping review. These fields share stable labels in the Prayers of Care
 * packet, and old overrides placed all three page-3 values on one line.
 */
export function repairKnownPacketPlacements(fields: FieldMapping[], pageCount = PACKET_MAP.pageCount): FieldMapping[] {
  const repaired = fields.map((field) => {
    if (field.page === 3 && field.fieldKey === "screen_date") {
      return { ...field, x: 325 };
    }
    if (field.page === 3 && field.fieldKey === "qp_referred_to") {
      return { ...field, x: 448 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_female") {
      return { ...field, x: 74 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_male") {
      return { ...field, x: 123.5 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_transgender") {
      return { ...field, x: 163.7 };
    }
    if (field.page === 7 && field.fieldKey === "court_desc") {
      return { ...field, y: 299 };
    }
    if (field.page === 10 && field.fieldKey === "e_street") {
      return { ...field, width: 270 };
    }
    if (field.page === 10 && field.fieldKey === "ec1_street") {
      return { ...field, width: 270 };
    }
    return field;
  });
  if (pageCount !== 39) return repaired.filter((field) => field.page <= pageCount);

  // The 39-page Prayers of Care packet places this PCP collaboration form on
  // page 27, not page 29 in the 43-page base packet.
  const providerFields = repaired.map((field) => {
    if (field.fieldKey === "c_to") return { ...field, page: 27, x: 59, y: 604, width: 285 };
    if (field.fieldKey === "c_phone") return { ...field, page: 27, x: 398, y: 604, width: 130 };
    if (field.fieldKey === "c_address") return { ...field, page: 27, x: 82, y: 558, width: 250 };
    return field;
  });
  const toField = providerFields.find((field) => field.fieldKey === "c_to");
  if (toField) {
    providerFields.push({
      ...toField,
      fieldKey: "c_practice",
      x: 80,
      y: 581,
      width: 245,
      notes: "Prayers of Care PCP collaboration practice name",
    });
  }
  return providerFields.filter((field) => {
    if (field.page > pageCount) return false;
    if (field.page !== 27) return true;
    if (field.fieldKey === "hdr_location_p27") return false;
    return field.fieldKey.startsWith("hdr_") ||
      ["c_to", "c_phone", "c_address", "c_practice"].includes(field.fieldKey);
  });
}

async function defaultTemplate(): Promise<TemplateRow | null> {
  return prisma.pdfTemplate.findUnique({
    where: { name: DEFAULT_PACKET_TEMPLATE_NAME },
    include: { fieldMappings: true },
  });
}

export async function packetTemplateForProvider(providerId?: string | null): Promise<PacketTemplateSelection> {
  const providerTemplate = providerId
    ? await prisma.pdfTemplate.findFirst({
      where: { providerId, isActive: true },
      include: { fieldMappings: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
    : null;

  const template = providerTemplate ?? await defaultTemplate();
  const overrides = template ? parseMappings(template.fieldMappings) : [];

  const pageCount = template?.pageCount ?? PACKET_MAP.pageCount;
  const fields = repairKnownPacketPlacements(mergedMap(overrides), pageCount);
  return {
    templateId: template?.id ?? null,
    name: template?.name ?? DEFAULT_PACKET_TEMPLATE_NAME,
    filePath: template?.filePath ?? null,
    originalFileName: template?.originalFileName ?? TEMPLATE_FILE,
    pageCount,
    pageWidth: template?.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: template?.pageHeight ?? PACKET_MAP.pageHeight,
    providerSpecific: !!providerTemplate,
    bytes: template ? loadTemplateFile(template.filePath) : loadTemplateBytes(),
    // Provider packets inherit the base packet map unless a provider-specific
    // override replaces or deletes individual placements.
    fields,
    overrides,
  };
}
