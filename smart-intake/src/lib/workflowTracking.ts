import { prisma } from "./prisma";
import { applyOperationalDefaults } from "./answerDefaults";
import { missingRequired } from "./validation";
import { buildSignatureStatuses } from "./signatureStatus";
import { clientCcaAttestationReady } from "./ccaReview";
import { evaluatePacketFreshness, packetFreshnessIgnoredAnswerKeys } from "./packetFreshness";
import { providerPacketReadiness } from "./providerPacketTemplates";
import { fileExists } from "./storage";
import { deliveryFacts, nextWorkflowAction, type WorkflowAction } from "./workflowOutcomes";

/** Records transitions after domain events; dashboard reads initialize legacy cases.
 * Initial timestamps mean first observation, never inferred historic entry dates.
 */
export async function observeIntakeWorkflow(intakeId: string): Promise<WorkflowAction | null> {
  const scope = await prisma.intake.findUnique({ where: { id: intakeId }, select: { providerId: true } });
  if (!scope?.providerId) return null;
  const packetSetup = await providerPacketReadiness(scope.providerId);
  return prisma.$transaction(async tx => {
    // Take SQLite's write lock before reading; concurrent observations cannot open two intervals.
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intakeId}`;
    const intake = await tx.intake.findUnique({
      where: { id: intakeId },
      include: {
        client: true, provider: true, answers: true,
        signatures: { select: { role:true, printedName:true, signedDate:true, relationship:true, contentRevision:true, subjectNameSnapshot:true, subjectDobSnapshot:true, invalidatedAt:true, invalidatedReason:true, createdAt:true, updatedAt:true } },
        uploadedDocuments: { where: { docType:"CCA" }, orderBy:{createdAt:"desc"}, take:1, select:{reviewJson:true} },
        generatedPdfs:{orderBy:{createdAt:"desc"},take:5},
        followUps:{where:{status:{in:["OPEN","PROCESSING"]}},select:{id:true}},
        messageDeliveries:{where:{purpose:"completed_copies"}},
        auditLogs:{where:{event:{in:["link_opened","link_reminder_sent","staff_reviewed","signature_captured","docusign_completed","workflow_delivery_confirmed","copies_link_sent","copies_link_failed"]}},orderBy:{createdAt:"desc"}},
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
    const signatures=buildSignatureStatuses(intake.signatures,{client:intake.client,currentContentRevision:intake.contentRevision,latestMaterialUpdatedAt:materialAt});
    const ds=intake.auditLogs.find(l=>l.event==="docusign_completed");
    const signed=signatures.some(s=>s.key==="client_guardian"&&s.state==="captured") || !!(ds&&(!materialAt||ds.createdAt>=materialAt));
    const required=missingRequired(effective,signed,intake.provider,{skipClinicalAssessmentAttestation:!clientCcaAttestationReady(intake.uploadedDocuments[0]?.reviewJson)});
    const packet=evaluatePacketFreshness({latestPdf:intake.generatedPdfs.find(p=>fileExists(p.filePath)), latestAnswerUpdatedAt:materialAt, latestSignatureUpdatedAt:intake.auditLogs.find(l=>l.event==="signature_captured")?.createdAt, packetTemplateUpdatedAt:packetSetup.ready&&packetSetup.templateUpdatedAt?new Date(packetSetup.templateUpdatedAt):null,currentContentRevision:intake.contentRevision});
    const reviewedAt=intake.auditLogs.find(l=>l.event==="staff_reviewed")?.createdAt;
    const action=nextWorkflowAction({
      id:intake.id,status:intake.status,submittedAt:intake.submittedAt,archived:intake.archived,abandonedAt:intake.abandonedAt,
      expectCca:intake.expectCca,hasCca:!!intake.uploadedDocuments.length,hasClientSignature:signed,
      hasStaffSignature:signatures.some(s=>s.key==="staff_qp"&&s.state==="captured"),
      missingRequiredCount:required.filter(r=>r.key!=="signature").length,
      staffReviewed:!!(reviewedAt&&(!materialAt||reviewedAt>=materialAt)),
      providerPacketReady:packetSetup.ready,packetState:packet.state,openFollowUp:!!intake.followUps.length,
      clientLinkExpired:intake.tokenExpiresAt < new Date(),
      clientLinkReached:!!intake.linkSentAt || intake.auditLogs.some(l=>["link_opened","link_reminder_sent"].includes(l.event)),
      ...deliveryFacts(intake.messageDeliveries,intake.auditLogs,packet.generatedAt,packet.pdfId),
    });
    action.packetId=packet.pdfId;
    const open=await tx.workflowInterval.findFirst({where:{intakeId,endedAt:null},orderBy:{startedAt:"desc"}});
    if (open?.stage===action.stage) return {...action,since:open.startedAt.toISOString()};
    const now=new Date();
    await tx.workflowInterval.updateMany({where:{intakeId,endedAt:null},data:{endedAt:now}});
    await tx.workflowInterval.create({data:{intakeId,stage:action.stage,startedAt:now}});
    return {...action,since:now.toISOString()};
  }, { timeout: 15000 });
}
