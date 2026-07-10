import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { loadTemplateBytes } from "@/lib/fillPdf";
import { loadTemplateFile } from "@/lib/providerPacketTemplates";

export async function GET(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");

  const template = templateId
    ? await prisma.pdfTemplate.findUnique({ where: { id: templateId } })
    : providerId
      ? await prisma.pdfTemplate.findFirst({
        where: { providerId, isActive: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : null;

  if ((templateId || providerId) && !template) {
    return NextResponse.json({ error: "Provider packet template not found. Upload the provider packet first." }, { status: 404 });
  }

  const bytes = template ? loadTemplateFile(template.filePath) : loadTemplateBytes();
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf" },
  });
}
