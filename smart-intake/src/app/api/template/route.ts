import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { loadTemplateBytes } from "@/lib/fillPdf";

export async function GET() {
  const { deny } = await requireStaff();
  if (deny) return deny;
  return new NextResponse(loadTemplateBytes() as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf" },
  });
}
