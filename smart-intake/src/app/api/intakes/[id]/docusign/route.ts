import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { createDocuSignEnvelope, docusignConfigured } from "@/lib/docusign";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, mappingOverrides } from "@/lib/intakeData";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  if (!docusignConfigured()) {
    return NextResponse.json(
      { error: "DocuSign not configured - see README_DOCUSIGN.md. In-app signature capture is active instead." },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!intake.client.email) return NextResponse.json({ error: "Client has no email on file" }, { status: 400 });
  const answers = await loadAnswers(intake.id);
  const result = await fillPacket({
    answers, signatures: await loadSignatures(intake.id),
    consents: consentsFromAnswers(answers), overrides: await mappingOverrides(),
  });
  const { envelopeId } = await createDocuSignEnvelope(
    Buffer.from(result.pdfBytes), intake.client.email, intake.client.fullName,
  );
  await audit("docusign_sent", { intakeId: intake.id, userId: user!.id, detail: envelopeId });
  return NextResponse.json({ ok: true, envelopeId });
}
