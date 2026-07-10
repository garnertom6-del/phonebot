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

  return {
    templateId: template?.id ?? null,
    name: template?.name ?? DEFAULT_PACKET_TEMPLATE_NAME,
    filePath: template?.filePath ?? null,
    originalFileName: template?.originalFileName ?? TEMPLATE_FILE,
    pageCount: template?.pageCount ?? PACKET_MAP.pageCount,
    pageWidth: template?.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: template?.pageHeight ?? PACKET_MAP.pageHeight,
    providerSpecific: !!providerTemplate,
    bytes: template ? loadTemplateFile(template.filePath) : loadTemplateBytes(),
    fields: mergedMap(overrides),
    overrides,
  };
}
