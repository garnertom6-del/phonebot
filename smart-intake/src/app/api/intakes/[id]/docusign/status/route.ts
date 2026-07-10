import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { checkDocuSignStatus, downloadDocuSignDocument, docusignConfigured } from "@/lib/docusign";
import { saveFile } from "@/lib/storage";

const FRIENDLY: Record<string, string> = {
  sent: "Sent - waiting for the client to open it.",
  delivered: "The client opened it but has not signed yet.",
  completed: "Signed! The signed copy was saved to this intake.",
  declined: "The client declined to sign.",
  voided: "This envelope was voided in DocuSign.",
};

/** Check the DocuSign envelope; when completed, pull the signed PDF into the record. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
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
    if (status === "completed") {
      const signedPdf = await downloadDocuSignDocument(intake.docusignEnvelopeId);
      const rel = `generated/${intake.id}/${Date.now()}-docusign-signed.pdf`;
      saveFile(rel, signedPdf);
      await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: rel } });
      await prisma.intake.update({ where: { id: intake.id }, data: { status: "COMPLETED" } });
      await audit("docusign_completed", {
        providerId: provider!.id,
        intakeId: intake.id,
        userId: user!.id,
        detail: intake.docusignEnvelopeId,
      });
    }
    return NextResponse.json({ ok: true, status, message: FRIENDLY[status] || `DocuSign status: ${status}` });
  } catch (e) {
    console.error("DocuSign status check failed", e);
    return NextResponse.json(
      { error: "Could not reach DocuSign to check. Try again in a minute." },
      { status: 502 },
    );
  }
}
