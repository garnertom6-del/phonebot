import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { loadTemplateFile } from "@/lib/providerPacketTemplates";
import { mappingAiConfigured, suggestPacketMappings } from "@/lib/mappingAi";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  if (!mappingAiConfigured()) return NextResponse.json({ error: "System AI is not configured." }, { status: 503 });
  const templateId = req.nextUrl.searchParams.get("templateId");
  const providerId = req.nextUrl.searchParams.get("providerId");
  const template = templateId
    ? await prisma.pdfTemplate.findUnique({ where: { id: templateId } })
    : providerId
      ? await prisma.pdfTemplate.findFirst({
        where: { providerId }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
      : null;
  if (!template) return NextResponse.json({ error: "Provider packet template not found." }, { status: 404 });
  try {
    const result = await suggestPacketMappings(loadTemplateFile(template.filePath));
    return NextResponse.json({ ...result, templateId: template.id, warning: "AI suggestions are not saved or approved. Review every box, save the map, run the quality check, and approve only after visual testing." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI mapping failed." }, { status: 502 });
  }
}
