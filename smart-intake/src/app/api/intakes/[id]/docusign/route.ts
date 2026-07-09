import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { createDocuSignEnvelope, docusignConfigured } from "@/lib/docusign";
import { fillPacket, mergedMap } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures, mappingOverrides } from "@/lib/intakeData";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  if (!docusignConfigured()) {
    return NextResponse.json(
      { error: "DocuSign is not set up. Clients can still sign in the app. Ask your administrator to connect DocuSign." },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!intake.client.email) return NextResponse.json({ error: "Client has no email on file" }, { status: 400 });
  const answers = await loadAnswers(intake.id);
  const consents = consentsFromAnswers(answers);
  const signatures = await loadSignatures(intake.id);
  delete signatures.client;
  delete signatures.guardian;
  const overrides = await mappingOverrides();
  const result = await fillPacket({
    answers, signatures,
    consents, overrides,
  });
  const { envelopeId } = await createDocuSignEnvelope(
    Buffer.from(result.pdfBytes), intake.client.email, intake.client.fullName,
    answers, consents, mergedMap(overrides),
  );
  await audit("docusign_sent", { intakeId: intake.id, userId: user!.id, detail: envelopeId });
  return NextResponse.json({ ok: true, envelopeId });
}
