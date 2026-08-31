import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/auditLog";
import { fileExists, readFile } from "@/lib/storage";
import { packetFreshnessForIntake } from "@/lib/packetFreshness";
import { copyPacketIsReady, findIntakeByCopyToken } from "@/lib/completedCopiesLookup";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";

const PRIVATE_PDF_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/pdf",
};

function fileSafe(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "Intake";
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const intake = await findIntakeByCopyToken(params.token);
  if (!intake || !intake.provider || !copyPacketIsReady(intake)) {
    return NextResponse.json({ error: "The completed packet is not available from this link." }, { status: 404 });
  }

  try {
    await requireProviderPacketForCompletion(intake.provider.id);
  } catch (error) {
    if (error instanceof ProviderPacketNotReadyError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }

  const packet = await packetFreshnessForIntake(intake.id);
  if (packet.state !== "current" || !packet.filePath || !fileExists(packet.filePath)) {
    return NextResponse.json({ error: "The final packet is not current. Contact your provider." }, { status: 409 });
  }

  await audit("pdf_downloaded", {
    providerId: intake.provider.id,
    intakeId: intake.id,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    detail: "secure completed-copy link",
  });
  const name = `${fileSafe(intake.provider.name)}-${fileSafe(intake.client.fullName)}-completed-intake.pdf`;
  return new NextResponse(readFile(packet.filePath) as unknown as BodyInit, {
    headers: {
      ...PRIVATE_PDF_HEADERS,
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
