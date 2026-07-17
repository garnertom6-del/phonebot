import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { loadTemplateFile } from "@/lib/providerPacketTemplates";
import { mappingAiConfigured, suggestPacketMappings } from "@/lib/mappingAi";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mergedMap } from "@/lib/fillPdf";
import { assessMapping } from "@/lib/mappingHealth";
import { audit } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  if (!mappingAiConfigured()) return NextResponse.json({ error: "System AI is not configured." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  const template = templateId
    ? await prisma.pdfTemplate.findUnique({ where: { id: templateId }, include: { fieldMappings: true } })
    : providerId
      ? await prisma.pdfTemplate.findFirst({
        where: { providerId }, include: { fieldMappings: true }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : null;
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
  try {
    const result = await suggestPacketMappings(loadTemplateFile(template.filePath));
    if (!apply) {
      return NextResponse.json({ ...result, templateId: template.id, warning: "AI suggestions are not saved or approved. Review every box, save the map, run the quality check, and approve only after visual testing." });
    }

    const existing = template.fieldMappings.map((row) => ({
      fieldKey: row.fieldKey,
      page: row.page,
      ...JSON.parse(row.data),
    })) as FieldMapping[];
    await prisma.$transaction(async (tx) => {
      for (const field of result.suggestions) {
        const { fieldKey, page, ...data } = field;
        await tx.pdfFieldMapping.upsert({
          where: { templateId_fieldKey: { templateId: template.id, fieldKey } },
          create: { templateId: template.id, fieldKey, page, data: JSON.stringify(data) },
          update: { page, data: JSON.stringify(data) },
        });
      }
    });

    const overrides = [...existing.filter((field) => !result.suggestions.some((suggestion) => suggestion.fieldKey === field.fieldKey)), ...result.suggestions];
    const fields = mergedMap(overrides);
    const health = assessMapping(
      fields,
      template.pageCount,
      template.pageWidth || PACKET_MAP.pageWidth,
      template.pageHeight || PACKET_MAP.pageHeight,
      overrides.length,
    );
    await prisma.pdfTemplate.update({
      where: { id: template.id },
      data: {
        mappingScore: health.score,
        mappingIssues: JSON.stringify({ blockingIssues: health.blockingIssues, warnings: health.warnings }),
      },
    });
    await audit("provider_packet_ai_mapped", {
      providerId: template.providerId || undefined,
      userId: user!.id,
      detail: `${template.originalFileName || template.name}: ${result.suggestions.length} AI field suggestion(s); score ${health.score}`,
    });
    return NextResponse.json({
      ...result,
      templateId: template.id,
      appliedCount: result.suggestions.length,
      health,
      warning: "AI mappings were saved as a draft. Review the packet visually before approval or signatures.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI mapping failed." }, { status: 502 });
  }
}
