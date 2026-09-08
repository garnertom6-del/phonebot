import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { promotePreparationFile } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";
export const runtime = "nodejs";
export async function POST(req: NextRequest, props: { params: Promise<{ providerId: string; fileId: string }> }) {
  const { providerId, fileId } = await props.params;
  const { user, deny } = await requireStaff({ providerId, write: true }); if (deny) return deny;
  try { const body = await req.json(); return NextResponse.json(await promotePreparationFile({ providerId, userId: user!.id }, fileId, body.confirmedProviderForm === true)); }
  catch (error) { return adobeErrorResponse(error); }
}
