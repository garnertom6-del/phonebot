import { NextRequest, NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { createCorrectionSchema } from "@/lib/documentReviewTypes";
import { createDocumentCorrection } from "@/lib/documentReviews";
import { reviewError } from "@/lib/documentReviewResponse";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  const input = createCorrectionSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message || "Invalid correction." }, { status: 400 });
  try { return NextResponse.json(await createDocumentCorrection({ intakeId: id, providerId: provider!.id, userId: user!.id }, input.data), { status: 201 }); }
  catch (error) { return reviewError(error); }
}
