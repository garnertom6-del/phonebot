import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mergedMap } from "@/lib/fillPdf";
import { assessMapping } from "@/lib/mappingHealth";

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
  const fields = mergedMap(overrides);
  const health = assessMapping(fields, template.pageCount, template.pageWidth || PACKET_MAP.pageWidth, template.pageHeight || PACKET_MAP.pageHeight, overrides.length);
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
