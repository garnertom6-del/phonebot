import { NextRequest, NextResponse } from "next/server";
import { isMasterUser, requireProviderAdmin, requireStaffForIntake } from "@/lib/staffGuard";
import { reconcileDocuSignSend } from "@/lib/docuSignReconcile";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const scoped = await requireStaffForIntake(params.id);
  if (scoped.deny) return scoped.deny;
  const admin = await requireProviderAdmin({ providerId: scoped.provider!.id });
  if (admin.deny) return admin.deny;
  if (!isMasterUser(admin.user!) && admin.membership?.role !== "PROVIDER_ADMIN" && !isMasterUser(scoped.user!)) {
    return NextResponse.json({ error: "Only a provider admin can reconcile a pending DocuSign send." }, { status: 403 });
  }

  let body: { action?: string; envelopeId?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body.action;
  if (action !== "lookup" && action !== "attach" && action !== "mark_failed") {
    return NextResponse.json({ error: "Choose lookup, attach, or mark_failed." }, { status: 400 });
  }

  const result = await reconcileDocuSignSend({
    intakeId: params.id,
    providerId: scoped.provider!.id,
    userId: (admin.user || scoped.user)!.id,
    action,
    envelopeId: typeof body.envelopeId === "string" ? body.envelopeId : undefined,
  });

  switch (result.status) {
    case "lookup":
    case "attached":
    case "already_sent":
    case "marked_failed":
      return NextResponse.json({ ok: true, ...result });
    case "not_pending":
    case "not_configured":
      return NextResponse.json({ error: result.message, ...result }, { status: 409 });
    default:
      return NextResponse.json({ error: result.message, ...result }, { status: 502 });
  }
}
