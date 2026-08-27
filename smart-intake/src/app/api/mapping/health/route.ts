import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { assessMapping } from "@/lib/mappingHealth";
import {
  loadTemplateFile,
  packetFieldsForTemplate,
  packetTemplateSha256,
} from "@/lib/providerPacketTemplates";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";

function parseMappings(rows: Array<{ fieldKey: string; page: number; data: string }>): FieldMapping[] {
  return rows.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) }));
}

export async function GET(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  const template = templateId
    ? await prisma.pdfTemplate.findUnique({ where: { id: templateId }, include: { fieldMappings: true } })
    : providerId
      ? await prisma.pdfTemplate.findFirst({
        where: { providerId }, include: { fieldMappings: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : null;
  if (!template) return NextResponse.json({ error: "Packet template not found." }, { status: 404 });

  const overrides = parseMappings(template.fieldMappings);
  const fields = packetFieldsForTemplate({
    name: template.name,
    originalFileName: template.originalFileName,
    pageCount: template.pageCount,
    providerSpecific: !!template.providerId,
    sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
  }, overrides);
  const health = assessMapping(
    fields,
    template.pageCount,
    template.pageWidth || PACKET_MAP.pageWidth,
    template.pageHeight || PACKET_MAP.pageHeight,
    fields.length,
  );
  const provider = template.providerId
    ? await prisma.provider.findUnique({ where: { id: template.providerId }, select: { name: true } })
    : null;
  const filenameWarning = packetFilenameWarning(provider?.name || "", template.originalFileName);
  if (filenameWarning) health.warnings.unshift(filenameWarning);
  return NextResponse.json({
    template: {
      id: template.id,
      providerId: template.providerId,
      originalFileName: template.originalFileName,
      isActive: template.isActive,
      mappingStatus: template.mappingStatus,
      mappingScore: template.mappingScore,
    },
    filenameWarning,
    health,
  });
}
