import { NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { CompletedCopyLinkError, prepareCompletedCopyLink } from "@/lib/completedCopyLink";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { provider, deny } = await requireWritableStaffForIntake(id);
  if (deny) return deny;
  try {
    const access = await prepareCompletedCopyLink(id, provider!.id, req);
    return NextResponse.json(access, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof CompletedCopyLinkError) return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: error.status });
    return NextResponse.json({ error: "The copies link could not be prepared. Open the saved intake and try again." }, { status: 500 });
  }
}
