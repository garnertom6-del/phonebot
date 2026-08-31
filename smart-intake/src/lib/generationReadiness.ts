import { prisma } from "@/lib/prisma";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { loadAnswers, nonMaterialAnswerKeys } from "@/lib/intakeData";
import { missingOptional, missingRequired } from "@/lib/validation";
import { buildRulePreflight, type PreflightFinding } from "@/lib/intakePreflight";
import { buildSignatureStatuses, type SignatureStatus } from "@/lib/signatureStatus";
import { buildPlanCompleteness, buildRecordConflicts, planFalseCompleteFromFieldCount, type RecordConflict } from "@/lib/recordIntegrity";
import { clientCcaAttestationReady, parseCcaReview, type CcaReview } from "@/lib/ccaReview";
import { providerPacketReadiness, signatureSlotProfileForProvider } from "@/lib/providerPacketTemplates";
import { acceptableOverrideReason } from "@/lib/overrideReason";

export type GenerationBlockerCode =
  | "archived"
  | "not_submitted"
  | "required_fields"
  | "client_signature_missing"
  | "client_signature_invalid"
  | "staff_signature_missing"
  | "staff_signature_invalid"
  | "cca_missing"
  | "cca_review_pending"
  | "cca_accuracy"
  | "record_conflict"
  | "staff_review_required"
  | "preflight_required"
  | "preflight_finding"
  | "provider_packet_not_ready"
  | "plan_incomplete";

export type GenerationBlocker = {
  code: GenerationBlockerCode;
  message: string;
  fieldKeys?: string[];
};

export type GenerationReadiness = {
  ready: boolean;
  blockers: GenerationBlocker[];
  signatureStatuses: SignatureStatus[];
  conflicts: RecordConflict[];
  ccaReview: CcaReview | null;
  ccaWarnings: string[];
  planCompleteness: ReturnType<typeof buildPlanCompleteness>;
  preflightFindings: PreflightFinding[];
  unresolvedPreflight: PreflightFinding[];
  contentRevision: number;
  sourceUpdatedAt: Date | null;
};

function maxDate(values: Array<Date | null | undefined>): Date | null {
  const dates = values.filter((value): value is Date => value instanceof Date);
  return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
}

function parseOverride(detail: string | null) {
  try {
    const parsed = JSON.parse(detail || "") as { findingKey?: unknown; reason?: unknown };
    const findingKey = typeof parsed.findingKey === "string" ? parsed.findingKey : "";
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    return findingKey && acceptableOverrideReason(reason) ? { findingKey, reason } : null;
  } catch {
    return null;
  }
}

function capturedRequiredStatus(statuses: SignatureStatus[], key: "client_guardian" | "staff_qp") {
  return statuses.find((status) => status.key === key);
}

export async function generationReadinessForIntake(
  intakeId: string,
  providerId: string,
  options: { allowMissingSignatures?: boolean } = {},
): Promise<GenerationReadiness | null> {
  const [intake, latestMaterialAnswer, providerPacket] = await Promise.all([
    prisma.intake.findFirst({
      where: { id: intakeId, providerId },
      include: {
        client: true,
        provider: { select: { name: true, slug: true } },
        signatures: true,
        uploadedDocuments: {
          where: { docType: "CCA" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true, reviewJson: true },
        },
        auditLogs: {
          where: { event: { in: ["staff_reviewed", "preflight_reviewed", "preflight_overridden"] } },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { event: true, detail: true, createdAt: true },
        },
      },
    }),
    prisma.intakeAnswer.findFirst({
      where: { intakeId, key: { notIn: nonMaterialAnswerKeys() } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    providerPacketReadiness(providerId),
  ]);
  if (!intake) return null;

  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  // Preflight checks the packet content and CCA. Signature validity has its
  // own gate, so capturing a QP signature must not make a just-completed
  // preflight stale and send staff around the workflow again.
  const sourceUpdatedAt = maxDate([latestMaterialAnswer?.updatedAt, intake.uploadedDocuments[0]?.createdAt]);
  const signatureSlotProfile = await signatureSlotProfileForProvider(providerId, providerPacket.templateId);
  const signatureStatuses = buildSignatureStatuses(intake.signatures, {
    client: intake.client,
    currentContentRevision: intake.contentRevision,
    latestMaterialUpdatedAt: latestMaterialAnswer?.updatedAt,
    mappedSlots: signatureSlotProfile.mappedSlots,
    requiredSlots: signatureSlotProfile.requiredSlots,
  });
  const clientSignature = capturedRequiredStatus(signatureStatuses, "client_guardian");
  const staffSignature = capturedRequiredStatus(signatureStatuses, "staff_qp");
  const hasValidClientSignature = clientSignature?.state === "captured";
  const hasValidStaffSignature = staffSignature?.state === "captured";
  const latestCcaReviewJson = intake.uploadedDocuments[0]?.reviewJson;
  const ccaReview = parseCcaReview(latestCcaReviewJson);
  const ccaAttestationReady = clientCcaAttestationReady(latestCcaReviewJson);
  const missingOptions = { skipClinicalAssessmentAttestation: !ccaAttestationReady };
  const missing = missingRequired(answers, hasValidClientSignature, intake.provider, missingOptions);
  const gateMissing = options.allowMissingSignatures
    ? missing.filter((field) => field.key !== "signature")
    : missing;
  const conflicts = buildRecordConflicts(answers, intake.client);
  const ruleFindings = buildRulePreflight({
    answers,
    client: intake.client,
    missingRequired: missing,
    missingOptional: missingOptional(answers, missingOptions),
    hasClientSignature: hasValidClientSignature,
    hasCca: intake.uploadedDocuments.length > 0,
    expectCca: intake.expectCca,
  });

  const validOverrideKeys = new Set(intake.auditLogs
    .filter((log) => log.event === "preflight_overridden" && (!sourceUpdatedAt || log.createdAt >= sourceUpdatedAt))
    .map((log) => parseOverride(log.detail)?.findingKey || "")
    .filter(Boolean));
  const duplicateBlockerFindingKeys = new Set([
    "required_items",
    "client_signature",
    "cca_upload",
    "identity_name",
    "identity_dob",
  ]);
  const unresolvedPreflight = ruleFindings.filter((finding) => (
    finding.severity !== "info"
    && !duplicateBlockerFindingKeys.has(finding.key)
    && (finding.severity === "error" || !validOverrideKeys.has(finding.key))
  ));
  const lastStaffReview = intake.auditLogs.find((log) => log.event === "staff_reviewed")?.createdAt || null;
  const lastPreflight = intake.auditLogs.find((log) => log.event === "preflight_reviewed")?.createdAt || null;
  const reviewSourceAt = latestMaterialAnswer?.updatedAt || null;
  const staffReviewed = !!(lastStaffReview && (!reviewSourceAt || lastStaffReview >= reviewSourceAt));
  const planCompleteness = buildPlanCompleteness(answers, {
    staffReviewed,
    hasRequiredPlanSignature: hasValidClientSignature,
    hasCca: intake.uploadedDocuments.length > 0,
  });
  const blockers: GenerationBlocker[] = [];

  if (intake.archived) blockers.push({ code: "archived", message: "Restore this intake before generating a packet." });
  if (!intake.submittedAt) blockers.push({ code: "not_submitted", message: "The client intake has not been submitted." });
  // CCA work precedes signatures. Uploading or re-scanning a CCA changes the
  // signed content revision, so prompting staff to sign first only creates a
  // signature that must immediately be invalidated and repeated.
  if (intake.expectCca && !intake.uploadedDocuments.length) blockers.push({ code: "cca_missing", message: "Upload the current clinician CCA." });
  if (intake.expectCca && intake.uploadedDocuments.length && !ccaReview) blockers.push({ code: "cca_review_pending", message: "Run and review the CCA accuracy scan before generating." });
  if (ccaReview?.majorErrors.length) {
    blockers.push({ code: "cca_accuracy", message: `Resolve ${ccaReview.majorErrors.length} major CCA accuracy issue${ccaReview.majorErrors.length === 1 ? "" : "s"}.` });
  }
  if (gateMissing.length) {
    blockers.push({
      code: "required_fields",
      message: `Complete ${gateMissing.length} required item${gateMissing.length === 1 ? "" : "s"} before continuing.`,
      fieldKeys: gateMissing.map((field) => field.key),
    });
  }
  if (!options.allowMissingSignatures) {
    if (clientSignature?.state === "missing") blockers.push({ code: "client_signature_missing", message: "Capture the client or guardian signature." });
    if (clientSignature?.state === "invalid") blockers.push({ code: "client_signature_invalid", message: `Client/guardian signature is not current: ${clientSignature.reason}` });
  }
  for (const conflict of conflicts.filter((item) => item.severity === "error")) {
    blockers.push({ code: "record_conflict", message: conflict.title, fieldKeys: conflict.fieldKeys });
  }
  if (!lastStaffReview || (reviewSourceAt && lastStaffReview < reviewSourceAt)) {
    blockers.push({ code: "staff_review_required", message: "Save a staff review after the latest intake-content change." });
  }
  if (planFalseCompleteFromFieldCount(planCompleteness)) {
    const unmet = [...planCompleteness.pcp.gates, ...planCompleteness.crisis.gates]
      .filter((gate) => !gate.met && gate.key !== "fields")
      .map((gate) => gate.key);
    const unique = [...new Set(unmet)];
    blockers.push({
      code: "plan_incomplete",
      message: `PCP/crisis plan fields are filled, but required gates are still open (${unique.join(", ") || "review, signatures, date, source"}). Field count alone cannot mark the plan complete.`,
    });
  }
  if (!lastPreflight || (sourceUpdatedAt && lastPreflight < sourceUpdatedAt)) {
    blockers.push({ code: "preflight_required", message: "Run preflight again after the latest answers or CCA change." });
  }
  for (const finding of unresolvedPreflight) {
    blockers.push({ code: "preflight_finding", message: finding.title, fieldKeys: finding.fieldKeys });
  }
  // QP signs last, after answers, conflicts, staff review, and preflight are
  // settled. Otherwise a preflight correction immediately invalidates the QP
  // signature and forces a needless second signing cycle.
  if (!options.allowMissingSignatures) {
    if (staffSignature?.state === "missing") blockers.push({ code: "staff_signature_missing", message: "Capture the Staff / QP signature after staff review and preflight are complete." });
    if (staffSignature?.state === "invalid") blockers.push({ code: "staff_signature_invalid", message: `Staff / QP signature is not current: ${staffSignature.reason}` });
  }
  if (!providerPacket.ready) blockers.push({ code: "provider_packet_not_ready", message: providerPacket.message });

  return {
    ready: blockers.length === 0,
    blockers,
    signatureStatuses,
    conflicts,
    ccaReview,
    ccaWarnings: ccaReview?.warnings || [],
    planCompleteness,
    preflightFindings: ruleFindings,
    unresolvedPreflight,
    contentRevision: intake.contentRevision,
    sourceUpdatedAt,
  };
}
