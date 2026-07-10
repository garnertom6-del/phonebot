import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { sendCompletedCopiesLink } from "@/lib/sendCompletedCopies";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const result = await sendCompletedCopiesLink({
    intakeId: params.id,
    providerId: provider!.id,
    userId: user!.id,
    req,
  });
  return NextResponse.json(result.body, { status: result.status });
}
