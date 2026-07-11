import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { sendIntakeToDocuSign } from "@/lib/sendDocuSign";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const result = await sendIntakeToDocuSign({
    intakeId: params.id,
    providerId: provider!.id,
    userId: user!.id,
  });

  switch (result.status) {
    case "sent":
    case "already_sent":
      return NextResponse.json({ ok: true, envelopeId: result.envelopeId, message: result.message });
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "missing_email":
      return NextResponse.json({ error: "Client has no email on file" }, { status: 400 });
    case "not_configured":
      return NextResponse.json(
        { error: "DocuSign is not set up. Clients can still sign in the app. Ask your administrator to connect DocuSign." },
        { status: 400 },
      );
    default:
      return NextResponse.json(
        { error: "DocuSign could not send the packet. The client can still sign in the app. If this keeps happening, ask your administrator to check the DocuSign connection." },
        { status: 502 },
      );
  }
}
