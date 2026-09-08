import { NextRequest, NextResponse } from "next/server";
import { requireProviderAdmin } from "@/lib/staffGuard";
import { uploadPreparationFile } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";

export const runtime = "nodejs";
export async function POST(req: NextRequest, props: { params: Promise<{ providerId: string; fileId: string }> }) {
  const { providerId, fileId } = await props.params;
  const { user, deny } = await requireProviderAdmin({ providerId });
  if (deny) return deny;
  try {
    if (Number(req.headers.get("content-length")) > 26 * 1024 * 1024) return NextResponse.json({ error: "Maximum upload size is 25 MB." }, { status: 413 });
    const form = await req.formData(), file = form.get("file");
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Choose a PDF no larger than 25 MB." }, { status: 400 });
    const result = await uploadPreparationFile({ providerId, userId: user!.id }, Buffer.from(await file.arrayBuffer()), file.name, form.get("confirmedNoClientData") === "true", fileId, true);
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) { return adobeErrorResponse(error); }
}
