import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireProviderAdmin } from "@/lib/staffGuard";
import { saveFile } from "@/lib/storage";
import { audit } from "@/lib/auditLog";
import { DEFAULT_PACKET_TEMPLATE_NAME } from "@/lib/providerPacketTemplates";

export const runtime = "nodejs";

const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;

function safeFileName(value: string) {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "provider-intake-packet.pdf";
}

function templateResponse(template: {
  id: string;
  name: string;
  originalFileName: string | null;
  pageCount: number;
  pageWidth: number | null;
  pageHeight: number | null;
  isActive: boolean;
  mappingStatus: string;
  mappingScore: number | null;
  mappingIssues: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null) {
  return {
    template: template
      ? {
        id: template.id,
        name: template.name,
        originalFileName: template.originalFileName,
        pageCount: template.pageCount,
        pageWidth: template.pageWidth,
        pageHeight: template.pageHeight,
        isActive: template.isActive,
        mappingStatus: template.mappingStatus,
        mappingScore: template.mappingScore,
        mappingIssues: template.mappingIssues,
        approvedAt: template.approvedAt,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      }
      : null,
    fallbackTemplateName: DEFAULT_PACKET_TEMPLATE_NAME,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider: currentProvider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  if (!isMasterUser(user!) && currentProvider!.id !== params.id) {
    return NextResponse.json({ error: "You can only view packet templates for your provider." }, { status: 403 });
  }

  const targetProvider = await prisma.provider.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!targetProvider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const template = await prisma.pdfTemplate.findFirst({
    where: { providerId: targetProvider.id, isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(templateResponse(template));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider: currentProvider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  if (!isMasterUser(user!) && currentProvider!.id !== params.id) {
    return NextResponse.json({ error: "You can only upload packet templates for your provider." }, { status: 403 });
  }

  const targetProvider = await prisma.provider.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!targetProvider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "PDF file is required" }, { status: 400 });
  }

  const originalFileName = safeFileName(file.name || "provider-intake-packet.pdf");
  if (!originalFileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF packet templates are supported" }, { status: 400 });
  }
  if (file.size > MAX_TEMPLATE_BYTES) {
    return NextResponse.json({ error: "PDF is too large. Maximum size is 25 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let pageCount = 0;
  let pageWidth = 0;
  let pageHeight = 0;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pageCount = pdf.getPageCount();
    const firstPage = pdf.getPage(0);
    pageWidth = firstPage.getWidth();
    pageHeight = firstPage.getHeight();
  } catch {
    return NextResponse.json({ error: "Uploaded file is not a valid PDF" }, { status: 400 });
  }
  if (pageCount < 1) {
    return NextResponse.json({ error: "Uploaded PDF has no pages" }, { status: 400 });
  }

  const stamp = Date.now();
  const relPath = `templates/providers/${targetProvider.id}/${stamp}-${originalFileName}`;
  saveFile(relPath, bytes);

  const template = await prisma.$transaction(async (tx) => {
    return tx.pdfTemplate.create({
      data: {
        providerId: targetProvider.id,
        name: `Provider Intake Packet ${targetProvider.id} ${stamp}`,
        filePath: relPath,
        pageCount,
        pageWidth,
        pageHeight,
        originalFileName,
        // Keep the current approved packet active until this new packet is
        // mapped, tested, and explicitly approved by a master user.
        isActive: false,
        mappingStatus: "DRAFT",
      },
    });
  });

  await audit("provider_packet_uploaded", {
    providerId: targetProvider.id,
    userId: user!.id,
    detail: `${targetProvider.name}: ${originalFileName} (${pageCount} pages)`,
  });

  return NextResponse.json(templateResponse(template), { status: 201 });
}
