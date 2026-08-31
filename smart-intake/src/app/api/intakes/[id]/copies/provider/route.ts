import { NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { sendCompletedPacketToProvider } from "@/lib/sendCompletedCopies";

/** Sends the latest completed packet to the provider's configured email address. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const result = await sendCompletedPacketToProvider({
    intakeId: params.id,
    providerId: provider!.id,
    userId: user!.id,
    req,
    allowResend: true,
  });
  if (result.skipped) return NextResponse.json({ ok: false, ...result }, { status: 400 });
  return NextResponse.json({ ok: result.sent === true, ...result }, { status: result.sent ? 200 : 502 });
}
