import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { sendCompletedPacketToProvider } from "@/lib/sendCompletedCopies";

/** Sends the latest completed packet to the provider's configured email address. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const result = await sendCompletedPacketToProvider({
    intakeId: params.id,
    providerId: provider!.id,
    userId: user!.id,
    req,
  });
  if (result.skipped) return NextResponse.json({ ok: false, ...result }, { status: 400 });
  return NextResponse.json({ ok: result.sent === true, ...result }, { status: result.sent ? 200 : 502 });
}
