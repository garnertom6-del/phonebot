import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { saveFile } from "@/lib/storage";

const DOC_TYPES = ["birth_certificate", "insurance_card", "court_order", "ss_card",
  "iep_records", "medication_list", "pcp_plan", "immunization_records", "standing_orders", "other"];

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({ where: { token: params.token } });
  if (!intake || intake.tokenExpiresAt < new Date()) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const docType = String(form.get("docType") || "other");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (!DOC_TYPES.includes(docType)) return NextResponse.json({ error: "Bad docType" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "File too large (15MB max)" }, { status: 400 });
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const rel = `uploads/${intake.id}/${docType}-${Date.now()}-${safeName}`;
  saveFile(rel, Buffer.from(await file.arrayBuffer()));
  await prisma.uploadedDocument.create({
    data: { intakeId: intake.id, docType, fileName: file.name, filePath: rel, mimeType: file.type || "application/octet-stream" },
  });
  await audit("document_uploaded", { intakeId: intake.id, detail: `${docType}: ${file.name}` });
  return NextResponse.json({ ok: true });
}
