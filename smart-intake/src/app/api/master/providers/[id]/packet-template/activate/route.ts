import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  const template = await prisma.pdfTemplate.findFirst({ where: { id: templateId, providerId: params.id } });
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
  if (template.mappingStatus !== "APPROVED") {
    return NextResponse.json({ error: "Only an approved packet can be activated." }, { status: 409 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.pdfTemplate.updateMany({ where: { providerId: params.id, isActive: true }, data: { isActive: false } });
    await tx.pdfTemplate.update({ where: { id: template.id }, data: { isActive: true } });
  });
  await audit("provider_packet_rolled_back", {
    providerId: params.id,
    userId: user!.id,
    detail: `Activated ${template.originalFileName || template.name}`,
  });
  return NextResponse.json({ ok: true });
}
