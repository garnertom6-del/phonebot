import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mappingOverrides } from "@/lib/intakeData";
import { mergedMap } from "@/lib/fillPdf";
import { DEFAULT_PACKET_TEMPLATE_NAME } from "@/lib/providerPacketTemplates";

type MappingRow = {
  fieldKey: string;
  page: number;
  data: string;
};

function parseMappings(rows: MappingRow[]): FieldMapping[] {
  return rows.map((m) => ({ fieldKey: m.fieldKey, page: m.page, ...JSON.parse(m.data) }));
}

async function activeProviderTemplate(providerId: string) {
  return prisma.pdfTemplate.findFirst({
    where: { providerId, isActive: true },
    include: { fieldMappings: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function templateByRequest(req: NextRequest) {
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  if (templateId) {
    const template = await prisma.pdfTemplate.findUnique({
      where: { id: templateId },
      include: { fieldMappings: true },
    });
    return { template, providerSpecific: !!template?.providerId, requestedProvider: providerId };
  }
  if (providerId) {
    const template = await activeProviderTemplate(providerId);
    return { template, providerSpecific: true, requestedProvider: providerId };
  }
  const template = await prisma.pdfTemplate.findUnique({
    where: { name: DEFAULT_PACKET_TEMPLATE_NAME },
    include: { fieldMappings: true },
  });
  return { template, providerSpecific: false, requestedProvider: null };
}

export async function GET(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const target = await templateByRequest(req);
  if (target.providerSpecific && !target.template) {
    return NextResponse.json({ error: "Upload this provider's packet before mapping it." }, { status: 404 });
  }

  const overrides = target.providerSpecific
    ? parseMappings(target.template?.fieldMappings ?? [])
    : await mappingOverrides();
  const fields = mergedMap(overrides);

  return NextResponse.json({
    templateId: target.template?.id ?? null,
    templateName: target.template?.name ?? DEFAULT_PACKET_TEMPLATE_NAME,
    originalFileName: target.template?.originalFileName ?? "MooreDivineCare_Intake_Packet-1.pdf",
    providerId: target.template?.providerId ?? target.requestedProvider,
    providerSpecific: target.providerSpecific,
    pageCount: target.template?.pageCount ?? PACKET_MAP.pageCount,
    pageWidth: target.template?.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: target.template?.pageHeight ?? PACKET_MAP.pageHeight,
    fields,
    overrideKeys: overrides.map((o: { fieldKey: string }) => o.fieldKey),
  });
}

export async function PUT(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json();
  if (!Array.isArray(body.fields)) return NextResponse.json({ error: "fields[] required" }, { status: 400 });

  const target = await templateByRequest(req);
  if (target.providerSpecific && !target.template) {
    return NextResponse.json({ error: "Upload this provider's packet before mapping it." }, { status: 404 });
  }
  const template = target.template ?? await prisma.pdfTemplate.upsert({
    where: { name: DEFAULT_PACKET_TEMPLATE_NAME },
    create: {
      name: DEFAULT_PACKET_TEMPLATE_NAME,
      filePath: "public/templates/MooreDivineCare_Intake_Packet-1.pdf",
      pageCount: PACKET_MAP.pageCount,
      pageWidth: PACKET_MAP.pageWidth,
      pageHeight: PACKET_MAP.pageHeight,
      originalFileName: "MooreDivineCare_Intake_Packet-1.pdf",
    },
    update: {},
  });

  if (body.replace === true && target.providerSpecific) {
    await prisma.pdfFieldMapping.deleteMany({ where: { templateId: template.id } });
  }

  for (const f of body.fields) {
    if (!f.fieldKey || !f.page) continue;
    const { fieldKey, page, ...data } = f;
    if (data.deleted && target.providerSpecific) {
      await prisma.pdfFieldMapping.deleteMany({ where: { templateId: template.id, fieldKey } });
      continue;
    }
    await prisma.pdfFieldMapping.upsert({
      where: { templateId_fieldKey: { templateId: template.id, fieldKey } },
      create: { templateId: template.id, fieldKey, page, data: JSON.stringify(data) },
      update: { page, data: JSON.stringify(data) },
    });
  }
  return NextResponse.json({ ok: true, saved: body.fields.length });
}
