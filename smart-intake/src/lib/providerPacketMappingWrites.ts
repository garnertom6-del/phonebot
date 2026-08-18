import { prisma } from "./prisma";

export type ProviderPacketMappingWrite = {
  fieldKey?: unknown;
  page?: unknown;
  [key: string]: unknown;
};

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
      await tx.pdfTemplate.update({
        where: { id: input.templateId },
        data: {
          mappingStatus: "DRAFT",
          mappingScore: null,
          approvedAt: null,
          approvedByUserId: null,
        },
      });
    }
  });

  return fields.length;
}
