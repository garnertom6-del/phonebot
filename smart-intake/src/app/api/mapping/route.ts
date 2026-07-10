import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { PACKET_MAP } from "@/config/mooreDivinePacketMap";
import { mappingOverrides } from "@/lib/intakeData";
import { mergedMap } from "@/lib/fillPdf";

const TEMPLATE_NAME = "Moore Divine Care Client Intake Package";

export async function GET() {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const overrides = await mappingOverrides();
  return NextResponse.json({
    pageCount: PACKET_MAP.pageCount, pageWidth: PACKET_MAP.pageWidth, pageHeight: PACKET_MAP.pageHeight,
    fields: mergedMap(overrides), overrideKeys: overrides.map((o: { fieldKey: string }) => o.fieldKey),
  });
}

export async function PUT(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json();
  if (!Array.isArray(body.fields)) return NextResponse.json({ error: "fields[] required" }, { status: 400 });
  const template = await prisma.pdfTemplate.upsert({
    where: { name: TEMPLATE_NAME },
    create: { name: TEMPLATE_NAME, filePath: "public/templates/MooreDivineCare_Intake_Packet-1.pdf", pageCount: PACKET_MAP.pageCount },
    update: {},
  });
  for (const f of body.fields) {
    if (!f.fieldKey || !f.page) continue;
    const { fieldKey, page, ...data } = f;
    await prisma.pdfFieldMapping.upsert({
      where: { templateId_fieldKey: { templateId: template.id, fieldKey } },
      create: { templateId: template.id, fieldKey, page, data: JSON.stringify(data) },
      update: { page, data: JSON.stringify(data) },
    });
  }
  return NextResponse.json({ ok: true, saved: body.fields.length });
}
