import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { isValidProviderPacketMappingScore } from "@/lib/providerPacketTemplates";
import { packetFilenameWarning } from "@/lib/packetFilenameGuard";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const filenameAcknowledged = body.filenameAcknowledged === true;
  if (!templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  const template = await prisma.pdfTemplate.findFirst({
    where: { id: templateId, providerId: params.id },
    include: { provider: { select: { name: true } } },
  });
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
  if (
    template.mappingStatus !== "APPROVED"
    || !isValidProviderPacketMappingScore(template.mappingScore)
    || template.approvedAt === null
  ) {
    return NextResponse.json({
      error: "Only a packet that passed mapping review and master approval can be activated.",
    }, { status: 409 });
  }
  const otherProviders = (await prisma.provider.findMany({
    where: { id: { not: params.id } },
    select: { name: true },
  })).map((row) => row.name);
  const filenameWarning = packetFilenameWarning(template.originalFileName, template.provider?.name || "", otherProviders);
  if (filenameWarning && !filenameAcknowledged) {
    return NextResponse.json({
      error: filenameWarning.message,
      filenameWarning,
    }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.pdfTemplate.updateMany({ where: { providerId: params.id, isActive: true }, data: { isActive: false } });
    await tx.pdfTemplate.update({
      where: { id: template.id },
      data: { isActive: true, approvedAt: new Date(), approvedByUserId: user!.id },
    });
  });
  await audit("provider_packet_rolled_back", {
    providerId: params.id,
    userId: user!.id,
    detail: `Activated ${template.originalFileName || template.name}`,
  });
  return NextResponse.json({ ok: true });
}
