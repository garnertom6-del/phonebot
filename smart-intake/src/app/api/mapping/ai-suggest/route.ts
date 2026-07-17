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

function parseIssues(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function findTemplate(req: NextRequest, includeMappings = false) {
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  const include = includeMappings ? { fieldMappings: true } : undefined;
  return templateId
    ? prisma.pdfTemplate.findUnique({ where: { id: templateId }, include })
    : providerId
      ? prisma.pdfTemplate.findFirst({
        where: { providerId }, include, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : null;
}

function mappingStatusResponse(template: { id: string; mappingStatus: string; mappingScore: number | null; mappingIssues: string | null }) {
  const issues = parseIssues(template.mappingIssues);
  const status = typeof issues.status === "string" ? issues.status : template.mappingStatus === "MAPPING" ? "MAPPING" : "IDLE";
  const blockingIssues = Array.isArray(issues.blockingIssues) ? issues.blockingIssues : [];
  const warnings = Array.isArray(issues.warnings) ? issues.warnings : [];
  return {
    templateId: template.id,
    mappingStatus: template.mappingStatus,
    mappingScore: template.mappingScore,
    mappingIssues: issues,
    status,
    appliedCount: typeof issues.appliedCount === "number" ? issues.appliedCount : 0,
    health: {
      ready: status === "COMPLETE" && blockingIssues.length === 0,
      score: template.mappingScore,
      blockingIssues,
      warnings,
    },
  };
}

async function applyPacketMapping(templateId: string, userId: string) {
  try {
    const template = await prisma.pdfTemplate.findUnique({ where: { id: templateId }, include: { fieldMappings: true } });
    if (!template) throw new Error("Provider packet template not found.");

    const result = await suggestPacketMappings(loadTemplateFile(template.filePath));
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
        mappingStatus: "DRAFT",
        mappingScore: health.score,
        mappingIssues: JSON.stringify({ status: "COMPLETE", appliedCount: result.suggestions.length, blockingIssues: health.blockingIssues, warnings: health.warnings }),
      },
    });
    await audit("provider_packet_ai_mapped", {
      providerId: template.providerId || undefined,
      userId,
      detail: `${template.originalFileName || template.name}: ${result.suggestions.length} AI field suggestion(s); score ${health.score}`,
    });
  } catch (error) {
    await prisma.pdfTemplate.update({
      where: { id: templateId },
      data: { mappingStatus: "DRAFT", mappingIssues: JSON.stringify({ status: "ERROR", error: error instanceof Error ? error.message : "AI mapping failed." }) },
    }).catch(() => undefined);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const template = await findTemplate(req);
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
  return NextResponse.json(mappingStatusResponse(template));
}

export async function POST(req: NextRequest) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  if (!mappingAiConfigured()) return NextResponse.json({ error: "System AI is not configured." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;
  const background = body?.background === true;
  const template = await findTemplate(req, apply && !background);
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });

  if (apply && background) {
    if (template.mappingStatus === "MAPPING") return NextResponse.json({ ...mappingStatusResponse(template), queued: true });
    await prisma.pdfTemplate.update({
      where: { id: template.id },
      data: { mappingStatus: "MAPPING", mappingScore: null, mappingIssues: JSON.stringify({ status: "MAPPING", startedAt: new Date().toISOString() }) },
    });
    void applyPacketMapping(template.id, user!.id).catch(() => undefined);
    return NextResponse.json({ queued: true, templateId: template.id, mappingStatus: "MAPPING" }, { status: 202 });
  }

  try {
    const detailedTemplate = apply && !background
      ? await prisma.pdfTemplate.findUnique({ where: { id: template.id }, include: { fieldMappings: true } })
      : null;
    if (apply && !background && !detailedTemplate) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
    const result = await suggestPacketMappings(loadTemplateFile(template.filePath));
    if (!apply) {
      return NextResponse.json({ ...result, templateId: template.id, warning: "AI suggestions are not saved or approved. Review every box, save the map, run the quality check, and approve only after visual testing." });
    }
    const existing = detailedTemplate!.fieldMappings.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) })) as FieldMapping[];
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
    const health = assessMapping(mergedMap(overrides), template.pageCount, template.pageWidth || PACKET_MAP.pageWidth, template.pageHeight || PACKET_MAP.pageHeight, overrides.length);
    await prisma.pdfTemplate.update({ where: { id: template.id }, data: { mappingStatus: "DRAFT", mappingScore: health.score, mappingIssues: JSON.stringify({ status: "COMPLETE", appliedCount: result.suggestions.length, blockingIssues: health.blockingIssues, warnings: health.warnings }) } });
    await audit("provider_packet_ai_mapped", { providerId: template.providerId || undefined, userId: user!.id, detail: `${template.originalFileName || template.name}: ${result.suggestions.length} AI field suggestion(s); score ${health.score}` });
    return NextResponse.json({ ...result, templateId: template.id, appliedCount: result.suggestions.length, health, warning: "AI mappings were saved as a draft. Review the packet visually before approval or signatures." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI mapping failed." }, { status: 502 });
  }
}
