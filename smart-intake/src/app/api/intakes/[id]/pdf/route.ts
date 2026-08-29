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
  let bytes: Buffer;
  const packet = await packetFreshnessForIntake(intake.id);
  if (!fresh) {
    if (packet.state !== "current" || !packet.filePath || !fileExists(packet.filePath)) {
      return NextResponse.json({
        code: "PACKET_NOT_CURRENT",
        error: packet.state === "stale"
          ? "The saved packet is outdated. Resolve readiness blockers and generate a new version."
          : "Generate the completed packet before downloading the final version.",
      }, { status: 409 });
    }
    bytes = readFile(packet.filePath);
  } else {
    const answers = await loadAnswers(intake.id);
    const result = await fillPacket({
      answers,
      signatures: await loadSignatures(intake.id),
      consents: consentsFromAnswers(answers),
      templateBytes: packetTemplate.bytes,
      fields: packetTemplate.fields,
    });
    bytes = Buffer.from(result.pdfBytes);
  }
  await audit("pdf_downloaded", { providerId: provider!.id, intakeId: intake.id, userId: user!.id });
  const name = `${fileSafe(provider!.name)}-Intake-${fileSafe(intake.client.fullName)}.pdf`;
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Smart-Intake-Document-State": fresh ? "DRAFT_PREVIEW" : "CURRENT_FINAL",
    },
  });
}
