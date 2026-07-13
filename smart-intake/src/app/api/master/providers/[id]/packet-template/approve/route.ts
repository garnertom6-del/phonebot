import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mergedMap } from "@/lib/fillPdf";
import { assessMapping } from "@/lib/mappingHealth";

function parseMappings(rows: Array<{ fieldKey: string; page: number; data: string }>): FieldMapping[] {
  return rows.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) }));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });

  const template = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, providerId: params.id },
    include: { fieldMappings: true },
  });
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });

  const overrides = parseMappings(template.fieldMappings);
  const fields = mergedMap(overrides);
  const health = assessMapping(fields, template.pageCount, template.pageWidth || PACKET_MAP.pageWidth, template.pageHeight || PACKET_MAP.pageHeight, overrides.length);
  if (!health.ready) {
    return NextResponse.json({
      error: "This packet is not ready for approval. Fix the blocking mapping items first.",
      health,
    }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.pdfTemplate.updateMany({ where: { providerId: params.id, isActive: true }, data: { isActive: false } });
    await tx.pdfTemplate.update({
      where: { id: template.id },
      data: {
        isActive: true,
        mappingStatus: "APPROVED",
        mappingScore: health.score,
        mappingIssues: JSON.stringify({ blockingIssues: health.blockingIssues, warnings: health.warnings }),
        approvedAt: new Date(),
        approvedByUserId: user!.id,
      },
    });
  });
  await audit("provider_packet_approved", {
    providerId: params.id,
    userId: user!.id,
    detail: `${template.originalFileName || template.name}; score ${health.score}; ${health.warnings.length} warning(s)`,
  });
  return NextResponse.json({ ok: true, health });
}
