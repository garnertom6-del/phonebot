import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { docusignConfigured } from "@/lib/docusign";
import {
  connectAccountMatches,
  docusignConnectConfigured,
  parseDocuSignConnectPayload,
  verifyDocuSignConnectSignature,
} from "@/lib/docuSignConnect";
import { applyDocuSignEnvelopeUpdate } from "@/lib/docuSignStatus";

export const runtime = "nodejs";

/** DocuSign Connect status callback. Staff polling still works when this is unconfigured. */
export async function POST(req: NextRequest) {
  if (!docusignConnectConfigured()) {
    return NextResponse.json({ error: "DocuSign Connect is not configured" }, { status: 503 });
  }
  const rawBody = await req.text();
  if (!verifyDocuSignConnectSignature(rawBody, (name) => req.headers.get(name))) {
    return NextResponse.json({ error: "Invalid DocuSign Connect signature" }, { status: 403 });
  }
  const payload = parseDocuSignConnectPayload(rawBody);
  if (!payload) {
    return NextResponse.json({ error: "Unrecognized Connect payload" }, { status: 400 });
  }
  if (!connectAccountMatches(payload.accountId)) {
    return NextResponse.json({ error: "Unexpected DocuSign account" }, { status: 403 });
  }

  const intake = await prisma.intake.findFirst({
    where: { docusignEnvelopeId: payload.envelopeId },
    select: { id: true, providerId: true, contentRevision: true, docusignEnvelopeId: true },
  });
  if (!intake) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    if (payload.status === "completed" && !docusignConfigured()) {
      return NextResponse.json({ error: "DocuSign API is not set up for import" }, { status: 503 });
    }
    const result = await applyDocuSignEnvelopeUpdate({
      intakeId: intake.id,
      providerId: intake.providerId,
      envelopeId: intake.docusignEnvelopeId!,
      status: payload.status,
      contentRevision: intake.contentRevision,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }
    return NextResponse.json({ ok: true, status: result.status, intakeId: intake.id });
  } catch (error) {
    console.error("DocuSign Connect import failed", error);
    return NextResponse.json({ error: "Could not apply the DocuSign envelope update." }, { status: 500 });
  }
}
