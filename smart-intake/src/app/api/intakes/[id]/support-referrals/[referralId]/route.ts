import { NextRequest, NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { updateSupportReferralSchema } from "@/lib/supportReferralTypes";
import { updateSupportReferral, SupportReferralError } from "@/lib/supportReferrals";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; referralId: string }> }) {
  const { id, referralId } = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  const parsed = updateSupportReferralSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid referral update." }, { status: 400 });
  try {
    const referral = await updateSupportReferral({ intakeId: id, providerId: provider!.id, userId: user!.id }, referralId, parsed.data);
    return NextResponse.json({ referral });
  } catch (error) {
    if (error instanceof SupportReferralError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "The referral update could not be confirmed. Reload it before retrying." }, { status: 500 });
  }
}
