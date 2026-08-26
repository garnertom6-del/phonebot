import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { assessMapping } from "@/lib/mappingHealth";
import {
  DEFAULT_PACKET_TEMPLATE_NAME,
  loadTemplateFile,
  packetFieldsForTemplate,
  packetTemplateSha256,
} from "@/lib/providerPacketTemplates";

function parseMappings(rows: Array<{ fieldKey: string; page: number; data: string }>): FieldMapping[] {
  return rows.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) }));
}

async function templateFromRequest(req: NextRequest) {
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  return templateId
    ? prisma.pdfTemplate.findUnique({ where: { id: templateId }, include: { fieldMappings: true } })
    : providerId
      ? prisma.pdfTemplate.findFirst({
        where: { providerId }, include: { fieldMappings: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : prisma.pdfTemplate.findUnique({
        where: { name: DEFAULT_PACKET_TEMPLATE_NAME },
        include: { fieldMappings: true },
      });
}

function healthFor(template: {
  name: string;
  originalFileName: string | null;
  pageCount: number;
  pageWidth: number | null;
  pageHeight: number | null;
  providerId: string | null;
  filePath: string;
  fieldMappings: Array<{ fieldKey: string; page: number; data: string }>;
}, liveFields?: FieldMapping[]) {
  const overrides = parseMappings(template.fieldMappings);
  const fields = liveFields && liveFields.length
    ? liveFields
    : packetFieldsForTemplate({
      name: template.name,
      originalFileName: template.originalFileName,
      pageCount: template.pageCount,
      providerSpecific: !!template.providerId,
      sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
    }, overrides);
  return assessMapping(
    fields,
    template.pageCount,
    template.pageWidth || PACKET_MAP.pageWidth,
    template.pageHeight || PACKET_MAP.pageHeight,
    liveFields ? liveFields.length : template.fieldMappings.length,
  );
}

export async function GET(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const template = await templateFromRequest(req);
  if (!template) return NextResponse.json({ error: "Packet template not found." }, { status: 404 });
  const health = healthFor(template);
  return NextResponse.json({
    template: {
      id: template.id,
      providerId: template.providerId,
      originalFileName: template.originalFileName,
      isActive: template.isActive,
      mappingStatus: template.mappingStatus,
      mappingScore: template.mappingScore,
    },
    health,
  });
}

export async function POST(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const liveFields = Array.isArray(body.fields) ? body.fields as FieldMapping[] : undefined;
  const template = await templateFromRequest(req);
  if (!template) {
    if (!liveFields) return NextResponse.json({ error: "Packet template not found." }, { status: 404 });
    return NextResponse.json({
      health: assessMapping(liveFields, PACKET_MAP.pageCount, PACKET_MAP.pageWidth, PACKET_MAP.pageHeight, liveFields.length),
    });
  }
  const health = healthFor(template, liveFields);
  return NextResponse.json({ health });
}
