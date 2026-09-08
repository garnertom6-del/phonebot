import { NextRequest, NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { updateCorrectionSchema } from "@/lib/documentReviewTypes";
import { updateDocumentCorrection } from "@/lib/documentReviews";
import { reviewError } from "@/lib/documentReviewResponse";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; correctionId: string }> }) {
  const { id, correctionId } = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  const input = updateCorrectionSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message || "Invalid correction update." }, { status: 400 });
  try { return NextResponse.json(await updateDocumentCorrection({ intakeId: id, providerId: provider!.id, userId: user!.id }, correctionId, input.data)); }
  catch (error) { return reviewError(error); }
}
