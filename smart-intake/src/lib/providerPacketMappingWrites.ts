import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mappingContextFrom } from "@/lib/mappingCatalog";
import { assessMapping } from "@/lib/mappingHealth";
import {
  loadTemplateFile,
  packetFieldsForTemplate,
  packetTemplateSha256,
} from "@/lib/providerPacketTemplates";
import { prisma } from "./prisma";

export type ProviderPacketMappingWrite = {
  fieldKey?: unknown;
  page?: unknown;
  [key: string]: unknown;
};

function parseStoredMappings(rows: Array<{ fieldKey: string; page: number; data: string }>): FieldMapping[] {
  return rows.map((row) => ({ fieldKey: row.fieldKey, page: row.page, ...JSON.parse(row.data) }));
}

export async function saveProviderPacketMappings(input: {
  templateId: string;
  fields: ProviderPacketMappingWrite[];
  replaceExisting: boolean;
}): Promise<number> {
  const fields = input.fields.flatMap((field) => {
    if (
      typeof field.fieldKey !== "string"
      || !field.fieldKey
      || typeof field.page !== "number"
      || !Number.isInteger(field.page)
      || field.page < 1
    ) {
      return [];
    }
    const { fieldKey, page, ...data } = field;
    return [{ fieldKey, page, data }];
  });

  await prisma.$transaction(async (tx) => {
    if (input.replaceExisting) {
      await tx.pdfFieldMapping.deleteMany({ where: { templateId: input.templateId } });
    }
    for (const field of fields) {
      await tx.pdfFieldMapping.upsert({
        where: {
          templateId_fieldKey: {
            templateId: input.templateId,
            fieldKey: field.fieldKey,
          },
        },
        create: {
          templateId: input.templateId,
          fieldKey: field.fieldKey,
          page: field.page,
          data: JSON.stringify(field.data),
        },
        update: { page: field.page, data: JSON.stringify(field.data) },
      });
    }

    if (input.replaceExisting || fields.length > 0) {
      const template = await tx.pdfTemplate.findUnique({
        where: { id: input.templateId },
        include: {
          fieldMappings: true,
          provider: { select: { name: true, slug: true } },
        },
      });
      let mappingScore: number | null = null;
      let mappingIssues: string | null = null;
      if (template) {
        const overrides = parseStoredMappings(template.fieldMappings);
        const liveFields = packetFieldsForTemplate({
          name: template.name,
          originalFileName: template.originalFileName,
          pageCount: template.pageCount,
          providerSpecific: !!template.providerId,
          sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
        }, overrides);
        const health = assessMapping(
          liveFields,
          template.pageCount,
          template.pageWidth || PACKET_MAP.pageWidth,
          template.pageHeight || PACKET_MAP.pageHeight,
          template.fieldMappings.length,
          mappingContextFrom({
            originalFileName: template.originalFileName,
            provider: template.provider,
          }),
        );
        mappingScore = health.score;
        mappingIssues = JSON.stringify({
          score: health.score,
          blockingIssues: health.blockingIssues,
          warnings: health.warnings,
          missingRequired: health.missingRequired,
        });
      }
      await tx.pdfTemplate.update({
        where: { id: input.templateId },
        data: {
          mappingStatus: "DRAFT",
          mappingScore,
          mappingIssues,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    }
  });

  return fields.length;
}
