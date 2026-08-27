import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { assessMapping } from "@/lib/mappingHealth";
import { mappingContextFrom } from "@/lib/mappingCatalog";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";
import {
  loadTemplateFile,
  packetFieldsForTemplate,
  packetTemplateSha256,
} from "@/lib/providerPacketTemplates";

function parseMappings(rows: Array<{ fieldKey: string; page: number; data: string }>): FieldMapping[] {
  return rows.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) }));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const overrideReason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
  const filenameAcknowledged = body.filenameAcknowledged === true;
  if (!templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });

  const template = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, providerId: params.id },
    include: { fieldMappings: true, provider: { select: { name: true, slug: true } } },
  });
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });

  const otherProviders = (await prisma.provider.findMany({
    where: { id: { not: params.id } },
    select: { name: true },
  })).map((row) => row.name);
  const filenameWarning = packetFilenameWarning(
    template.originalFileName,
    template.provider?.name || "",
    otherProviders,
  );
  if (filenameWarning && !filenameAcknowledged && overrideReason.length < 8) {
    return NextResponse.json({
      error: filenameWarning.message,
      filenameWarning,
    }, { status: 409 });
  }

  const overrides = parseMappings(template.fieldMappings);
  const fields = packetFieldsForTemplate({
    name: template.name,
    originalFileName: template.originalFileName,
    pageCount: template.pageCount,
    providerSpecific: true,
    sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
  }, overrides);
  const health = assessMapping(
    fields,
    template.pageCount,
    template.pageWidth || PACKET_MAP.pageWidth,
    template.pageHeight || PACKET_MAP.pageHeight,
    template.fieldMappings.length,
    mappingContextFrom(template),
  );
  if (!health.ready && overrideReason.length < 8) {
    return NextResponse.json({
      error: "This packet is not ready for approval. Map the missing required fields, or send an override reason of at least 8 characters.",
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
        mappingIssues: JSON.stringify({
          blockingIssues: health.blockingIssues,
          warnings: health.warnings,
          missingRequired: health.missingRequired,
          overrideReason: overrideReason || null,
          filenameWarning: filenameWarning?.message || null,
        }),
        approvedAt: new Date(),
        approvedByUserId: user!.id,
      },
    });
  });
  await audit("provider_packet_approved", {
    providerId: params.id,
    userId: user!.id,
    detail: `${template.originalFileName || template.name}; score ${health.score}; ${health.warnings.length} warning(s)${overrideReason ? `; override: ${overrideReason.slice(0, 180)}` : ""}`,
  });
  return NextResponse.json({ ok: true, health, overridden: !!overrideReason });
}
