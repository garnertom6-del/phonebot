import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const BACKUP_SCHEMA_VERSION = 2;

function redactToken(value: string | null | undefined): string {
  if (!value) return "";
  return "[redacted-live-token]";
}

/**
 * PHI backup. Requires confirmPhi=yes so a dump is deliberate; the UI must
 * never put that query on the href until staff confirms a dialog.
 * Live intake/follow-up tokens are redacted. Follow-ups are included.
 */
export async function GET(req: NextRequest) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;

  if (req.nextUrl.searchParams.get("confirmPhi") !== "yes") {
    return NextResponse.json({
      error: "This download contains protected health information. Add ?confirmPhi=yes to confirm.",
      schemaVersion: BACKUP_SCHEMA_VERSION,
      containsPhi: true,
    }, { status: 400 });
  }

  const [providers, users, memberships, clients, intakes, answers, signatures, releaseConsents, referrals,
    emergencyContacts, medications, substanceUseRows, uploadedDocuments,
    generatedPdfs, auditLogs, followUps] = await Promise.all([
    prisma.provider.findMany(),
    prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } }),
    prisma.userMembership.findMany(),
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
    prisma.intakeFollowUp.findMany(),
  ]);

  await audit("backup_downloaded", { userId: user!.id, detail: "PHI confirmed; live tokens redacted" });

  const backup = {
    app: "Moore Divine Care Smart Intake",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    containsPhi: true,
    tokensRedacted: true,
    note: "Keep this file somewhere safe and private - it contains client health information. Live intake and follow-up tokens were redacted.",
    providers, users, memberships,
    clients,
    intakes: intakes.map((intake) => ({ ...intake, token: redactToken(intake.token) })),
    answers, signatures, releaseConsents, referrals,
    emergencyContacts, medications, substanceUseRows,
    uploadedDocuments, generatedPdfs, auditLogs,
    followUps: followUps.map((item) => ({ ...item, token: redactToken(item.token) })),
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
