import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { checkDocuSignStatus, docusignConfigured } from "@/lib/docusign";
import { applyDocuSignEnvelopeUpdate } from "@/lib/docuSignStatus";

/** Check the DocuSign envelope; when completed, pull the signed PDF into the record. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  if (!docusignConfigured()) {
    return NextResponse.json({ error: "DocuSign is not set up." }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({ where: { id: params.id, providerId: provider!.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!intake.docusignEnvelopeId) {
    return NextResponse.json({ error: "Nothing has been sent to DocuSign for this client yet." }, { status: 400 });
  }
  try {
    const status = await checkDocuSignStatus(intake.docusignEnvelopeId);
    const result = await applyDocuSignEnvelopeUpdate({
      intakeId: intake.id,
      providerId: provider!.id,
      envelopeId: intake.docusignEnvelopeId,
      status,
      userId: user!.id,
      contentRevision: intake.contentRevision,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json({
      ok: true,
      status: result.status,
      message: result.message,
      ...(result.blockers ? { blockers: result.blockers } : {}),
      ...(result.delivery ? { delivery: result.delivery } : {}),
    });
  } catch (e) {
    console.error("DocuSign status check failed", e);
    return NextResponse.json(
      { error: "Could not reach DocuSign to check. Try again in a minute." },
      { status: 502 },
    );
  }
}
