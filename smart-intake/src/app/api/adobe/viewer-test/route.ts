import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requireStaff } from "@/lib/staffGuard";

export async function GET() {
  const { deny } = await requireStaff();
  if (deny) return deny;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText("Smart Intake - Adobe connection test", { x: 40, y: 730, size: 22 });
  page.drawText("This sample contains no client information.", { x: 40, y: 680, size: 14 });
  page.drawText("If you can read this page, PDF viewing is working.", { x: 40, y: 650, size: 14 });
  return new NextResponse(new Uint8Array(await pdf.save()), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Smart-Intake-Document-State": "REVIEW_COPY" } });
}
