import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster, requireProviderAdmin } from "@/lib/staffGuard";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { mappingOverrides } from "@/lib/intakeData";
import { saveProviderPacketMappings } from "@/lib/providerPacketMappingWrites";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";
import { packetDisplayStatus } from "@/lib/mappingStatus";
import {
  DEFAULT_PACKET_TEMPLATE_NAME,
  isWelliancePacket,
  loadTemplateFile,
  packetFieldsForTemplate,
  packetTemplateSha256,
} from "@/lib/providerPacketTemplates";

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

async function requireMappingReadAccess(req: NextRequest) {
  const providerId = req.nextUrl.searchParams.get("providerId");
  const templateId = req.nextUrl.searchParams.get("templateId");
  let targetProviderId = providerId;
  if (!targetProviderId && templateId) {
    const template = await prisma.pdfTemplate.findUnique({
      where: { id: templateId },
      select: { providerId: true },
    });
    targetProviderId = template?.providerId || null;
  }
  if (!targetProviderId) {
    const master = await requireMaster();
    if (master.deny) return master;
    return { user: master.user, provider: null, membership: null, deny: null as NextResponse | null };
  }
  return requireProviderAdmin({ providerId: targetProviderId });
}

export async function GET(req: NextRequest) {
  const { deny } = await requireMappingReadAccess(req);
  if (deny) return deny;
  const target = await templateByRequest(req);
  if (target.providerSpecific && !target.template) {
    return NextResponse.json({ error: "Upload this provider's packet before mapping it." }, { status: 404 });
  }

  const overrides = target.providerSpecific
    ? parseMappings(target.template?.fieldMappings ?? [])
    : await mappingOverrides();
  const pageCount = target.template?.pageCount ?? PACKET_MAP.pageCount;
  const templateName = target.template?.name ?? DEFAULT_PACKET_TEMPLATE_NAME;
  const originalFileName = target.template?.originalFileName ?? "MooreDivineCare_Intake_Packet-1.pdf";
  const sha256 = target.template
    ? packetTemplateSha256(loadTemplateFile(target.template.filePath))
    : null;
  const fields = packetFieldsForTemplate({
    name: templateName,
    originalFileName,
    pageCount,
    providerSpecific: target.providerSpecific,
    sha256,
  }, overrides);
  const provider = target.template?.providerId
    ? await prisma.provider.findUnique({ where: { id: target.template.providerId }, select: { name: true } })
    : null;
  const otherProviders = provider
    ? (await prisma.provider.findMany({ where: { id: { not: target.template!.providerId! } }, select: { name: true } })).map((row) => row.name)
    : [];
  const filenameWarning = packetFilenameWarning(originalFileName, provider?.name || "", otherProviders);
  const displayStatus = packetDisplayStatus({
    mappingStatus: target.template?.mappingStatus ?? "APPROVED",
    mappingScore: target.template?.mappingScore ?? null,
    mappingIssues: target.template?.mappingIssues ?? null,
    isActive: target.template?.isActive ?? true,
    approvedAt: target.template?.approvedAt ?? new Date(),
    originalFileName,
  });

  return NextResponse.json({
    templateId: target.template?.id ?? null,
    templateName,
    originalFileName,
    filenameWarning,
    providerName: provider?.name ?? null,
    providerId: target.template?.providerId ?? target.requestedProvider,
    providerSpecific: target.providerSpecific,
    isActive: target.template?.isActive ?? true,
    approvedAt: target.template?.approvedAt ?? null,
    pageCount,
    pageWidth: target.template?.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: target.template?.pageHeight ?? PACKET_MAP.pageHeight,
    mappingStatus: target.template?.mappingStatus ?? "APPROVED",
    mappingScore: target.template?.mappingScore ?? null,
    mappingIssues: target.template?.mappingIssues ?? null,
    savedMappingCount: target.template?.fieldMappings.length ?? 0,
    displayStatus,
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

  const identity = {
    name: template.name,
    originalFileName: template.originalFileName,
    pageCount: template.pageCount,
    providerSpecific: !!template.providerId,
    sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
  };
  if (isWelliancePacket(identity)) {
    const allowed = new Set(packetFieldsForTemplate(identity).map((field) => field.fieldKey));
    const unknown = body.fields
      .map((field: { fieldKey?: unknown }) => typeof field.fieldKey === "string" ? field.fieldKey : "")
      .filter((fieldKey: string) => fieldKey && !allowed.has(fieldKey));
    if (unknown.length) {
      return NextResponse.json({
        error: `The verified Welliance map does not accept new field keys: ${unknown.slice(0, 5).join(", ")}.`,
      }, { status: 400 });
    }
  }

  const saved = await saveProviderPacketMappings({
    templateId: template.id,
    fields: body.fields,
    replaceExisting: body.replace === true,
  });
  return NextResponse.json({ ok: true, saved });
}
