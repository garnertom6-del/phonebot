import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { refreshPreparationJob } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";
export const runtime = "nodejs";
export async function POST(_req: NextRequest, props: { params: Promise<{ providerId: string; jobId: string }> }) {
  const { providerId, jobId } = await props.params;
  const { user, deny } = await requireStaff({ providerId, write: true }); if (deny) return deny;
  try { await refreshPreparationJob({ providerId, userId: user!.id }, jobId); return NextResponse.json({ ok: true }); }
  catch (error) { return adobeErrorResponse(error); }
}
