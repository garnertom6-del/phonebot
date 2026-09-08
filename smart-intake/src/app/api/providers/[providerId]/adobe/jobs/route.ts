import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { startPreparationJob } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";
export const runtime = "nodejs";
export async function POST(req: NextRequest, props: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await props.params;
  const { user, deny } = await requireStaff({ providerId, write: true }); if (deny) return deny;
  try { return NextResponse.json(await startPreparationJob({ providerId, userId: user!.id }, await req.json()), { status: 202 }); }
  catch (error) { return adobeErrorResponse(error); }
}
