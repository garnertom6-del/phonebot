import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { attachSelectedProviderCookie, requireStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { readFile, fileExists } from "@/lib/storage";
import {
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";
import { packetFreshnessForIntake } from "@/lib/packetFreshness";
import { packetDownloadFileName, stampDraftWatermark } from "@/lib/draftPdf";

function jsonError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, provider, deny } = await requireStaffForIntake(params.id);
    if (deny) return deny;
    const intake = await prisma.intake.findFirst({
      where: { id: params.id, providerId: provider!.id },
      include: { client: true, generatedPdfs: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    if (!intake) return jsonError("Not found", 404);
    let packetTemplate: Awaited<ReturnType<typeof requireProviderPacketForCompletion>>;
    try {
      packetTemplate = await requireProviderPacketForCompletion(provider!.id);
    } catch (error) {
      if (error instanceof ProviderPacketNotReadyError) {
        return jsonError(error.message, 409, {
          code: error.code,
          packetReadiness: error.readiness,
        });
      }
      throw error;
    }
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const preview = req.nextUrl.searchParams.get("preview") === "1";
    const explicitDownload = req.nextUrl.searchParams.get("download") === "1";
    let bytes: Buffer;
    let fillWarnings: string[] = [];
    const packet = await packetFreshnessForIntake(intake.id);
    let documentState: "DRAFT_PREVIEW" | "CURRENT_FINAL";
    if (fresh || preview) {
      const answers = await loadAnswers(intake.id);
      const result = await fillPacket({
        answers,
        signatures: await loadSignatures(intake.id),
        consents: consentsFromAnswers(answers),
        templateBytes: packetTemplate.bytes,
        fields: packetTemplate.fields,
      });
      bytes = Buffer.from(await stampDraftWatermark(result.pdfBytes));
      fillWarnings = result.warnings;
      documentState = "DRAFT_PREVIEW";
    } else if (packet.state === "current" && packet.filePath && fileExists(packet.filePath)) {
      bytes = readFile(packet.filePath);
      documentState = "CURRENT_FINAL";
    } else {
      return jsonError(
        packet.state === "stale"
          ? "The saved packet is outdated. Resolve readiness blockers and generate a new version."
          : "Generate the completed packet before downloading the final version.",
        409,
        { code: "PACKET_NOT_CURRENT" },
      );
    }
    await audit(explicitDownload ? "pdf_downloaded" : "pdf_previewed", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: documentState,
    });
    const name = packetDownloadFileName({
      providerName: provider!.name,
      clientName: intake.client.fullName,
      documentState,
    });
    const response = new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "X-Smart-Intake-Document-State": documentState,
        ...(fillWarnings.length
          ? { "X-Smart-Intake-Fill-Warnings": String(fillWarnings.length) }
          : {}),
      },
    });
    return attachSelectedProviderCookie(response, provider!.id);
  } catch (error) {
    console.error("GET /api/intakes/[id]/pdf failed", error);
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : "The packet preview could not be generated.";
    return jsonError(message, 500, { code: "PDF_FILL_FAILED" });
  }
}
