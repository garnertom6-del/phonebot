import { NextRequest, NextResponse } from "next/server";
import { requireStaff, requireProviderAdmin } from "@/lib/staffGuard";
import { listPreparation, uploadPreparationFile, createPreparationSample } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ providerId: string }> };
export async function GET(_req: NextRequest, props: Props) {
  const { providerId } = await props.params;
  const { user, deny } = await requireStaff({ providerId }); if (deny) return deny;
  try { return NextResponse.json(await listPreparation({ providerId, userId: user!.id }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return adobeErrorResponse(error); }
}
export async function POST(req: NextRequest, props: Props) {
  const { providerId } = await props.params;
  const { user, deny } = await requireProviderAdmin({ providerId }); if (deny) return deny;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json();
      if (body.action !== "create_sample") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
      return NextResponse.json(await createPreparationSample({ providerId, userId: user!.id }), { status: 201 });
    }
    if (Number(req.headers.get("content-length")) > 26 * 1024 * 1024) return NextResponse.json({ error: "File too large. Maximum 25 MB." }, { status: 413 });
    const form = await req.formData(), file = form.get("file");
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Choose a file no larger than 25 MB." }, { status: 400 });
    const result = await uploadPreparationFile({ providerId, userId: user!.id }, Buffer.from(await file.arrayBuffer()), file.name, form.get("confirmedNoClientData") === "true", String(form.get("sourceFileId") || "") || undefined);
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return adobeErrorResponse(error); }
}
