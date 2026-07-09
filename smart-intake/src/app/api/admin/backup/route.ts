import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

/**
 * One-click backup: every client, intake, answer, signature, consent and
 * audit entry as a single JSON download. Signature images are included as
 * data URLs, so packets can be regenerated from this file alone (the PDF
 * template lives in the app itself). Staff-gated; each download is audited.
 */
export async function GET() {
  const { user, deny } = await requireStaff();
  if (deny) return deny;

  const [clients, intakes, answers, signatures, releaseConsents, referrals,
    emergencyContacts, medications, substanceUseRows, uploadedDocuments,
    generatedPdfs, auditLogs] = await Promise.all([
    prisma.client.findMany(),
    prisma.intake.findMany(),
    prisma.intakeAnswer.findMany(),
    prisma.signature.findMany(),
    prisma.releaseConsent.findMany(),
    prisma.referral.findMany(),
    prisma.emergencyContact.findMany(),
    prisma.medication.findMany(),
    prisma.substanceUseRow.findMany(),
    prisma.uploadedDocument.findMany(),
    prisma.generatedPdf.findMany(),
    prisma.auditLog.findMany(),
  ]);

  await audit("backup_downloaded", { userId: user!.id });

  const backup = {
    app: "Moore Divine Care Smart Intake",
    exportedAt: new Date().toISOString(),
    note: "Keep this file somewhere safe and private - it contains client health information.",
    clients, intakes, answers, signatures, releaseConsents, referrals,
    emergencyContacts, medications, substanceUseRows,
    uploadedDocuments, generatedPdfs, auditLogs,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 1), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mdc-intake-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
