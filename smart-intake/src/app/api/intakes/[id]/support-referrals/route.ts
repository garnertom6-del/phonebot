import { NextRequest, NextResponse } from "next/server";
import { requireStaffForIntake, requireWritableStaffForIntake } from "@/lib/staffGuard";
import { createSupportReferralSchema } from "@/lib/supportReferralTypes";
import { createSupportReferral, listSupportReferrals, SupportReferralError } from "@/lib/supportReferrals";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { user, provider, deny } = await requireStaffForIntake(id);
  if (deny) return deny;
  try {
    const result = await listSupportReferrals({ intakeId: id, providerId: provider!.id, userId: user!.id });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupportReferralError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Referral tracking could not be loaded. Please try again." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  const parsed = createSupportReferralSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid referral." }, { status: 400 });
  try {
    const referral = await createSupportReferral({ intakeId: id, providerId: provider!.id, userId: user!.id }, parsed.data);
    return NextResponse.json({ referral }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportReferralError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "The referral could not be saved. Reload the list before retrying." }, { status: 500 });
  }
}
