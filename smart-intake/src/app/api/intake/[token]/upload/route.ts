import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { saveFile } from "@/lib/storage";

const DOC_TYPES = ["birth_certificate", "insurance_card", "photo_id", "court_order", "ss_card",
  "iep_records", "medication_list", "pcp_plan", "immunization_records", "standing_orders", "other"];

// documents are photos or PDFs - anything else is refused
const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const ALLOWED_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|heif)$/i;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({ where: { token: params.token }, include: { provider: true } });
  if (!intake || intake.tokenExpiresAt < new Date() || (intake.provider && intake.provider.status !== "ACTIVE")) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const docType = String(form.get("docType") || "other");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: "Bad docType" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "File too large (15MB max)" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return NextResponse.json({ error: "Please upload a photo (JPG/PNG/HEIC) or a PDF." }, { status: 400 });
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/${docType}-${Date.now()}-${safeName}`;
  saveFile(rel, Buffer.from(await file.arrayBuffer()));
  await prisma.uploadedDocument.create({
    data: { intakeId: intake.id, docType, fileName: file.name, filePath: rel, mimeType: file.type || "application/octet-stream" },
  });
  await audit("document_uploaded", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id,
    detail: `${docType}: ${file.name}`,
  });
  return NextResponse.json({ ok: true });
}
