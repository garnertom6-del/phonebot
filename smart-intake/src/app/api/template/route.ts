import { NextResponse } from "next/server";
import { requireMaster } from "@/lib/staffGuard";
import { loadTemplateBytes } from "@/lib/fillPdf";

export async function GET() {
  const { deny } = await requireMaster();
  if (deny) return deny;
  return new NextResponse(loadTemplateBytes() as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf" },
  });
}
