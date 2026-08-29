import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { readFile, fileExists } from "@/lib/storage";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";
import { packetFreshnessForIntake } from "@/lib/packetFreshness";

function fileSafe(value: string) {
  return value.replace(/\W+/g, "-").replace(/^-+|-+$/g, "") || "Intake";
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true, generatedPdfs: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let packetTemplate: Awaited<ReturnType<typeof requireProviderPacketForCompletion>>;
  try {
    packetTemplate = await requireProviderPacketForCompletion(provider!.id);
  } catch (error) {
    if (error instanceof ProviderPacketNotReadyError) {
      return NextResponse.json({
        code: error.code,
        error: error.message,
        packetReadiness: error.readiness,
      }, { status: 409 });
    }
    throw error;
  }
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const explicitDownload = req.nextUrl.searchParams.get("download") === "1";
  let bytes: Buffer;
  const packet = await packetFreshnessForIntake(intake.id);
  let documentState: "DRAFT_PREVIEW" | "CURRENT_FINAL";
  if (!fresh && packet.state === "current" && packet.filePath && fileExists(packet.filePath)) {
    bytes = readFile(packet.filePath);
    documentState = "CURRENT_FINAL";
  } else if (fresh || preview) {
    const answers = await loadAnswers(intake.id);
    const result = await fillPacket({
      answers,
      signatures: await loadSignatures(intake.id),
      consents: consentsFromAnswers(answers),
      templateBytes: packetTemplate.bytes,
      fields: packetTemplate.fields,
    });
    bytes = Buffer.from(result.pdfBytes);
    documentState = "DRAFT_PREVIEW";
  } else {
      return NextResponse.json({
        code: "PACKET_NOT_CURRENT",
        error: packet.state === "stale"
          ? "The saved packet is outdated. Resolve readiness blockers and generate a new version."
          : "Generate the completed packet before downloading the final version.",
      }, { status: 409 });
  }
  await audit(explicitDownload ? "pdf_downloaded" : "pdf_previewed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: documentState,
  });
  const name = `${fileSafe(provider!.name)}-Intake-${fileSafe(intake.client.fullName)}.pdf`;
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Smart-Intake-Document-State": documentState,
    },
  });
}
