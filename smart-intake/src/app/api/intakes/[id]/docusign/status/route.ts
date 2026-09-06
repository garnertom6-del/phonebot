import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { checkDocuSignStatus, downloadDocuSignDocument, docusignConfigured } from "@/lib/docusign";
import { saveFile, deleteFile } from "@/lib/storage";
import { recordDocuSignPacket } from "@/lib/docuSignPacket";
import { observeIntakeWorkflow } from "@/lib/workflowTracking";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { ensureCompletedCopyToken } from "@/lib/copyTokens";
import { completionReadinessForIntake } from "@/lib/completionReadiness";

const FRIENDLY: Record<string, string> = {
  sent: "Sent - waiting for the client to open it.",
  delivered: "The client opened it but has not signed yet.",
  completed: "Signed! The signed copy was saved to this intake.",
  declined: "The client declined to sign.",
  voided: "This envelope was voided in DocuSign.",
};

/** Check the DocuSign envelope; when completed, pull the signed PDF into the record. */
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  if (!docusignConfigured()) {
    return NextResponse.json({ error: "DocuSign is not set up." }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({ where: { id: params.id, providerId: provider!.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!intake.docusignEnvelopeId) {
    return NextResponse.json({ error: "Nothing has been sent to DocuSign for this client yet." }, { status: 400 });
  }
  try {
    const status = await checkDocuSignStatus(intake.docusignEnvelopeId);
    const recorded = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intake.id} AND "providerId" = ${provider!.id}`;
      const current = await tx.intake.findFirst({ where: { id: intake.id, providerId: provider!.id } });
      if (!current || current.docusignEnvelopeId !== intake.docusignEnvelopeId) return false;
      const detail = JSON.stringify({ envelopeId: intake.docusignEnvelopeId, status });
      const last = await tx.auditLog.findFirst({ where: { intakeId: intake.id, providerId: provider!.id, event: "docusign_status" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (last?.detail !== detail) await tx.auditLog.create({ data: { intakeId: intake.id, providerId: provider!.id, userId: user!.id, event: "docusign_status", detail } });
      return true;
    });
    if (!recorded) return NextResponse.json({ error: "The DocuSign envelope changed. Refresh the intake before checking it." }, { status: 409 });
    if (status === "completed") {
      const alreadySaved = await prisma.auditLog.findFirst({
        where: {
          providerId: provider!.id,
          intakeId: intake.id,
          event: "docusign_completed",
          detail: intake.docusignEnvelopeId,
        },
        select: { id: true },
      });
      if (!alreadySaved) {
        const signedPdf = await downloadDocuSignDocument(intake.docusignEnvelopeId);
        const rel = `generated/${intake.id}/${Date.now()}-${randomUUID()}-docusign-signed.pdf`;
        saveFile(rel, signedPdf);
        try {
          const imported = await recordDocuSignPacket({
            providerId: provider!.id, intakeId: intake.id, userId: user!.id,
            envelopeId: intake.docusignEnvelopeId, filePath: rel,
            sha256: createHash("sha256").update(signedPdf).digest("hex"),
          });
          if (!imported.saved) deleteFile(rel);
        } catch (error) {
          deleteFile(rel);
          throw error;
        }
        await observeIntakeWorkflow(intake.id).catch((error) => console.error("workflow observation failed", error));
      }

      const readiness = await completionReadinessForIntake(intake.id, provider!.id);
      if (!readiness) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (!readiness.ready) {
        await prisma.intake.updateMany({ where: {
          id: intake.id, providerId: provider!.id, docusignEnvelopeId: intake.docusignEnvelopeId,
          contentRevision: intake.contentRevision, archived: false,
          status: { notIn: ["COMPLETED", "NEEDS_REVIEW"] },
        }, data: { status: "SIGNED" } });
        return NextResponse.json({
          ok: true,
          status,
          message: [
            "The signed PDF was saved from DocuSign. Smart Intake is not complete.",
            readiness.blockers.some(blocker => ["client_signature_missing", "client_signature_invalid"].includes(blocker.code))
              ? "Capture a current client or guardian signature in the secure intake app; the DocuSign PDF does not satisfy that app requirement."
              : "",
            `Remaining checks: ${readiness.blockers.map(blocker => blocker.message).join(" ")}`,
          ].filter(Boolean).join(" "),
          blockers: readiness.blockers,
        });
      }

      const completed = await prisma.intake.updateMany({ where: {
        id: intake.id, providerId: provider!.id, docusignEnvelopeId: intake.docusignEnvelopeId,
        contentRevision: intake.contentRevision, archived: false,
      }, data: { status: "COMPLETED" } });
      if (!completed.count) return NextResponse.json({ error: "The intake changed while DocuSign was checked. Review the current packet before completing it." }, { status: 409 });
      await ensureCompletedCopyToken(intake.id);
      const delivery = await autoSendCompletedCopiesIfEnabled({
        intakeId: intake.id,
        providerId: provider!.id,
        userId: user!.id,
      }).catch((error) => {
        console.error("auto-send completed copies failed", error);
        return { error: "Automatic delivery failed after DocuSign completion." };
      });
      return NextResponse.json({
        ok: true,
        status,
        message: FRIENDLY.completed,
        delivery,
      });
    }
    return NextResponse.json({ ok: true, status, message: FRIENDLY[status] || `DocuSign status: ${status}` });
  } catch (e) {
    console.error("DocuSign status check failed", e);
    return NextResponse.json(
      { error: "Could not reach DocuSign to check. Try again in a minute." },
      { status: 502 },
    );
  }
}
