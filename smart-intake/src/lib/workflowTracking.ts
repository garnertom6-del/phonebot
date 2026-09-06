import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { applyOperationalDefaults } from "./answerDefaults";
import { missingRequired } from "./validation";
import { clientCcaAttestationReady } from "./ccaReview";
import { evaluatePacketFreshness, packetFreshnessIgnoredAnswerKeys } from "./packetFreshness";
import { providerPacketReadiness, signatureSlotProfileForProvider } from "./providerPacketTemplates";
import { generationReadinessFromSnapshot } from "./generationReadiness";
import { fileExists } from "./storage";
import { deliveryFacts, nextWorkflowAction, type WorkflowAction } from "./workflowOutcomes";

/** Records transitions after domain events; dashboard reads initialize legacy cases.
 * Initial timestamps mean first observation, never inferred historic entry dates.
 */
export async function observeIntakeWorkflow(intakeId: string): Promise<WorkflowAction | null> {
  // A dashboard snapshot may predate an answer, signature, or status change.
  // Always derive the persisted action from the intake read under the write
  // lock; a delayed GET must not reopen a stage that a newer event just closed.
  const scope = await prisma.intake.findUnique({ where: { id: intakeId }, select: { providerId: true } });
  if (!scope?.providerId) return null;
  const packetSetup = await providerPacketReadiness(scope.providerId);
  const signatureSlotProfile = await signatureSlotProfileForProvider(scope.providerId, packetSetup.templateId);
  return prisma.$transaction(async tx => {
    // Take SQLite's write lock before reading; concurrent observations cannot open two intervals.
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intakeId}`;
    const intake = await tx.intake.findUnique({
      where: { id: intakeId },
      include: {
        client: true, provider: true, answers: true,
        signatures: { select: { role:true, printedName:true, signedDate:true, relationship:true, contentRevision:true, subjectNameSnapshot:true, subjectDobSnapshot:true, invalidatedAt:true, invalidatedReason:true, createdAt:true, updatedAt:true } },
        uploadedDocuments: { where: { docType:"CCA" }, orderBy:{createdAt:"desc"}, take:1, select:{reviewJson:true,createdAt:true} },
        generatedPdfs:{orderBy:{createdAt:"desc"},take:5},
        followUps:{where:{status:{in:["OPEN","PROCESSING"]}},select:{id:true}},
        messageDeliveries:{where:{purpose:"completed_copies"}},
        auditLogs:{where:{event:{in:["link_opened","link_reminder_sent","staff_reviewed","preflight_reviewed","preflight_overridden","signature_captured","docusign_completed","workflow_delivery_confirmed","copies_link_sent","copies_link_failed"]}},orderBy:{createdAt:"desc"}},
      },
    });
    if (!intake) return null;
    const answers: Record<string,unknown> = {};
    let materialAt: Date | null = null;
    const ignored = new Set(packetFreshnessIgnoredAnswerKeys());
    for (const row of intake.answers) {
      try { answers[row.key]=JSON.parse(row.value); } catch { answers[row.key]=row.value; }
      if (!ignored.has(row.key) && (!materialAt || row.updatedAt>materialAt)) materialAt=row.updatedAt;
    }
    const effective = applyOperationalDefaults(answers);
    const generation=generationReadinessFromSnapshot({intake,answers:effective,latestMaterialAnswer:materialAt?{updatedAt:materialAt}:null,providerPacket:packetSetup,signatureSlotProfile});
    const signatures=generation.signatureStatuses;
    const signed=signatures.some(s=>s.key==="client_guardian"&&s.state==="captured");
    const required=missingRequired(effective,signed,intake.provider,{skipClinicalAssessmentAttestation:!clientCcaAttestationReady(intake.uploadedDocuments[0]?.reviewJson)});
    const packet=evaluatePacketFreshness({latestPdf:intake.generatedPdfs.find(p=>fileExists(p.filePath)), latestAnswerUpdatedAt:materialAt, latestSignatureUpdatedAt:intake.auditLogs.find(l=>l.event==="signature_captured")?.createdAt, packetTemplateUpdatedAt:packetSetup.ready&&packetSetup.templateUpdatedAt?new Date(packetSetup.templateUpdatedAt):null,currentContentRevision:intake.contentRevision});
    const action=nextWorkflowAction({
      id:intake.id,status:intake.status,submittedAt:intake.submittedAt,archived:intake.archived,abandonedAt:intake.abandonedAt,
      expectCca:intake.expectCca,hasCca:!!intake.uploadedDocuments.length,hasClientSignature:signed,
      hasStaffSignature:signatures.some(s=>s.key==="staff_qp"&&s.state==="captured"),
      missingRequiredCount:required.filter(r=>r.key!=="signature").length,
      staffReviewed:!generation.blockers.some(blocker=>blocker.code==="staff_review_required"),
      providerPacketReady:packetSetup.ready,packetState:packet.state,openFollowUp:!!intake.followUps.length,
      generationBlockers:generation.blockers,
      clientLinkExpired:intake.tokenExpiresAt < new Date(),
      clientLinkReached:!!intake.linkSentAt || intake.auditLogs.some(l=>["link_opened","link_reminder_sent"].includes(l.event)),
      ...deliveryFacts(intake.messageDeliveries,intake.auditLogs,packet.generatedAt,packet.pdfId),
    });
    action.packetId=packet.pdfId;
    return recordAction(tx,intakeId,action);
  }, { timeout: 15000 });
}

async function recordAction(tx: Prisma.TransactionClient, intakeId: string, action: WorkflowAction) {
  const open=await tx.workflowInterval.findFirst({where:{intakeId,endedAt:null},orderBy:{startedAt:"desc"}});
  if (open?.stage===action.stage) return {...action,since:open.startedAt.toISOString()};
  const now=new Date();
  await tx.workflowInterval.updateMany({where:{intakeId,endedAt:null},data:{endedAt:now}});
  await tx.workflowInterval.create({data:{intakeId,stage:action.stage,startedAt:now}});
  return {...action,since:now.toISOString()};
}
