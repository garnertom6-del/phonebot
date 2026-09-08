import { NextRequest, NextResponse } from "next/server";
import { requireStaffForIntake, requireWritableStaffForIntake } from "@/lib/staffGuard";
import { createReviewSchema } from "@/lib/documentReviewTypes";
import { createDocumentReview, listDocumentReviews } from "@/lib/documentReviews";
import { reviewError } from "@/lib/documentReviewResponse";
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { user, provider, deny } = await requireStaffForIntake(id);
  if (deny) return deny;
  try { return NextResponse.json(await listDocumentReviews({ intakeId: id, providerId: provider!.id, userId: user!.id }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return reviewError(error); }
}
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  const input = createReviewSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.issues[0]?.message || "Invalid review copy." }, { status: 400 });
  try { return NextResponse.json(await createDocumentReview({ intakeId: id, providerId: provider!.id, userId: user!.id }, input.data), { status: 201 }); }
  catch (error) { return reviewError(error); }
}
