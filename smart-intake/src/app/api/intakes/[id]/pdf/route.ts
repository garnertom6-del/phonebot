import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fillPacket } from "@/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "@/lib/intakeData";
import { readFile, fileExists } from "@/lib/storage";
import { packetTemplateForProvider } from "@/lib/providerPacketTemplates";

function fileSafe(value: string) {
  return value.replace(/\W+/g, "-").replace(/^-+|-+$/g, "") || "Intake";
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true, generatedPdfs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  let bytes: Buffer;
  const latest = intake.generatedPdfs[0];
  if (!fresh && latest && fileExists(latest.filePath)) {
    bytes = readFile(latest.filePath);
  } else {
    const answers = await loadAnswers(intake.id);
    const packetTemplate = await packetTemplateForProvider(provider!.id);
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
    },
  });
}
