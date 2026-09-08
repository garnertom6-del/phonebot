import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { nextWorkflowAction, type WorkflowFacts } from "../src/lib/workflowOutcomes";
import { signatureSendHint, DOCUSIGN_SEND_CONFIRM } from "../src/lib/signatureStatus";
import { isolatedSqlite } from "./isolatedSqlite";
import { SECTIONS } from "../src/config/mooreDivineQuestions";
import { buildPacketChecklistChips } from "../src/lib/packetChecklist";

async function main() {
  const context = isolatedSqlite("preflight-docusign-tests.db");
  const previousUrl = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  context.pushSchema(fs.readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  process.env.DATABASE_URL = context.databaseUrl;
  globalThis.fetch = async () => { throw new Error("External calls are forbidden in this synthetic test."); };
  const { prisma } = await import("../src/lib/prisma");
  const { loadPreflightSnapshot, recordPreflightReview } = await import("../src/lib/preflightSnapshot");
  const { saveAnswers, loadAnswerSnapshot, consentsFromAnswers } = await import("../src/lib/intakeData");
  const { docuSignSendDetail, recordDocuSignPacket } = await import("../src/lib/docuSignPacket");
  const { evaluatePacketFreshness } = await import("../src/lib/packetFreshness");
  const { generationReadinessForIntake, generationReadinessFromSnapshot } = await import("../src/lib/generationReadiness");
  const { observeIntakeWorkflow } = await import("../src/lib/workflowTracking");
  const { PCP_PLAN_FIELD_KEYS, CRISIS_PLAN_FIELD_KEYS } = await import("../src/lib/recordIntegrity");
  const { sendCompletedCopiesLink, sendCompletedPacketToProvider } = await import("../src/lib/sendCompletedCopies");
  const { emptyCcaReview } = await import("../src/lib/ccaReview");
  const { saveFile, deleteFile } = await import("../src/lib/storage");
  const { GET: listProviders } = await import("../src/app/api/master/providers/route");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { SELECTED_PROVIDER_COOKIE } = await import("../src/lib/staffGuard");
  const { GET: listIntakes } = await import("../src/app/api/intakes/route");
  const { PATCH: staffPatch } = await import("../src/app/api/intakes/[id]/route");
  const { completionReadinessForIntake } = await import("../src/lib/completionReadiness");
  const { sendIntakeToDocuSign } = await import("../src/lib/sendDocuSign");
  const templatePath = `synthetic-tests/${randomUUID()}-template.pdf`;
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic Review Provider", slug: `review-${randomUUID()}`, email: "provider@example.invalid" } });
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: "Synthetic Staff", role: "master", passwordHash: "synthetic-no-login" } });
    const inactiveProvider = await prisma.provider.create({ data: { name: "Synthetic Inactive Provider", slug: `inactive-${randomUUID()}`, status: "INACTIVE" } });
    for (const staleProvider of ["deleted-provider-id", inactiveProvider.id]) {
      bindTestCookies({ get: name => name === SESSION_COOKIE ? { value: createSessionValue(user.id) } : name === SELECTED_PROVIDER_COOKIE ? { value: staleProvider } : undefined });
      const response = await listProviders();
      assert.equal(response.status, 200, "Master provider index remains accessible after selection is deleted or deactivated");
      const body = await response.json();
      assert(body.providers.some((row: { id: string }) => row.id === provider.id));
      assert(body.providers.some((row: { id: string }) => row.id === inactiveProvider.id));
    }
    const admin = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: "Synthetic Provider Admin", role: "staff", passwordHash: "synthetic-no-login", memberships: { create: { providerId: provider.id, role: "PROVIDER_ADMIN", active: true } } } });
    bindTestCookies({ get: name => name === SESSION_COOKIE ? { value: createSessionValue(admin.id) } : name === SELECTED_PROVIDER_COOKIE ? { value: provider.id } : undefined });
    const adminResponse = await listProviders(); assert.equal(adminResponse.status, 200);
    assert.deepEqual((await adminResponse.json()).providers.map((row: { id: string }) => row.id), [provider.id], "Provider admin still sees only its own provider");
    bindTestCookies({ get: name => name === SESSION_COOKIE ? { value: createSessionValue(admin.id) } : name === SELECTED_PROVIDER_COOKIE ? { value: inactiveProvider.id } : undefined });
    assert.equal((await listProviders()).status, 404, "Master stale-cookie bypass must not expose an inactive provider to a provider admin");
    bindTestCookies({ get: () => undefined });
    assert.equal((await listProviders()).status, 401);
    bindTestCookies(null);
    const client = await prisma.client.create({ data: { providerId: provider.id, fullName: "Synthetic Review Client", dob: "2000-01-01", email: "client@example.invalid" } });
    const intake = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: randomUUID(), tokenExpiresAt: new Date("2099-01-01"), expectCca: false } });
    await saveAnswers(intake.id, { presenting_problem: "Before review" });
    const old = await loadPreflightSnapshot(intake.id, provider.id); assert(old);
    // Delayed review sees the old snapshot while a different request saves.
    let finishReview!: () => void;
    const wait = new Promise<void>(resolve => { finishReview = resolve; });
    const delayed = (async () => { await wait; return recordPreflightReview(old, provider.id, user.id, "Delayed synthetic AI review"); })();
    await saveAnswers(intake.id, { presenting_problem: "Changed during review" });
    finishReview();
    assert.equal(await delayed, false);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: intake.id, event: "preflight_reviewed" } }), 0, "Stale review cannot create a freshness audit");
    const current = await loadPreflightSnapshot(intake.id, provider.id); assert(current);
    assert.equal(await recordPreflightReview(current, provider.id, user.id, "Current review"), true);
    // Even equal timestamps cannot make a different content revision current.
    const reviewLog = await prisma.auditLog.findFirstOrThrow({ where: { intakeId: intake.id, event: "preflight_reviewed" } });
    await prisma.intake.update({ where: { id: intake.id }, data: { contentRevision: { increment: 1 } } });
    await prisma.intakeAnswer.updateMany({ where: { intakeId: intake.id }, data: { updatedAt: reviewLog.createdAt } });
    assert((await generationReadinessForIntake(intake.id, provider.id))?.blockers.some(b => b.code === "preflight_required"));
    await prisma.intake.update({ where: { id: intake.id }, data: { contentRevision: current.intake.contentRevision } });
    await saveAnswers(intake.id, { staff_helper_notes: "Nonmaterial staff note" });
    assert.equal(await recordPreflightReview(current, provider.id, user.id, "Same material content"), true);
    assert.equal(await loadPreflightSnapshot(intake.id, "another-provider"), null);
    const beforeCca = await loadPreflightSnapshot(intake.id, provider.id); assert(beforeCca);
    const cca = await prisma.uploadedDocument.create({ data: { intakeId: intake.id, docType: "CCA", fileName: "synthetic.pdf", filePath: "unused.pdf", mimeType: "application/pdf", reviewJson: JSON.stringify({ ...emptyCcaReview(), sourceClientName: "Other Synthetic Person", sourceClientDob: "2000-01-01" }) } });
    assert.equal(await recordPreflightReview(beforeCca, provider.id, user.id, "Before CCA"), false, "CCA source changes are rejected even if a legacy writer omitted revision bump");
    const beforeRescan = await loadPreflightSnapshot(intake.id, provider.id); assert(beforeRescan);
    await prisma.uploadedDocument.update({ where: { id: cca.id }, data: { reviewJson: JSON.stringify({ ...emptyCcaReview(), sourceClientName: client.fullName, sourceClientDob: client.dob }) } });
    assert.equal(await recordPreflightReview(beforeRescan, provider.id, user.id, "Before rescan"), false);

    const envelopeId = "synthetic-envelope";
    await prisma.intake.update({ where: { id: intake.id }, data: { contentRevision: 7, docusignEnvelopeId: envelopeId } });
    await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: "old.pdf", packetVersion: 1, contentRevision: 7 } });
    await prisma.auditLog.create({ data: { providerId: provider.id, intakeId: intake.id, event: "docusign_sent", detail: docuSignSendDetail(envelopeId, 7) } });
    // Changes made while the envelope is away must never be stamped as signed.
    await prisma.intake.update({ where: { id: intake.id }, data: { contentRevision: 8 } });
    const input = { intakeId: intake.id, providerId: provider.id, envelopeId, filePath: "signed.pdf", sha256: "a".repeat(64), userId: user.id };
    const concurrent = await Promise.all([recordDocuSignPacket(input), recordDocuSignPacket({ ...input, filePath: "duplicate.pdf" })]);
    assert.equal(concurrent.filter(r => r.saved).length, 1);
    const imported = await prisma.generatedPdf.findFirstOrThrow({ where: { intakeId: intake.id }, orderBy: { packetVersion: "desc" } });
    assert.equal(imported.packetVersion, 2, "DocuSign import follows an existing generated version without P2002");
    assert.equal(imported.contentRevision, 7, "Uses the sent snapshot rather than the new intake revision");
    assert.equal(imported.sha256, input.sha256);
    assert.equal(evaluatePacketFreshness({ latestPdf: imported, currentContentRevision: 8 }).state, "stale");
    assert.equal(evaluatePacketFreshness({ latestPdf: imported, currentContentRevision: 7 }).state, "current");
    assert.equal(await prisma.auditLog.count({ where: { intakeId: intake.id, event: "docusign_completed" } }), 1);
    await assert.rejects(recordDocuSignPacket({ ...input, providerId: "other-provider" }));
    await prisma.intake.update({ where: { id: intake.id }, data: { docusignEnvelopeId: "legacy-envelope" } });
    const legacy = await recordDocuSignPacket({ ...input, envelopeId: "legacy-envelope" });
    assert.equal(legacy.contentRevision, 0, "Unknown legacy envelope revision stays unverified");
    assert.equal(legacy.packetVersion, 3);

    const pdf = await PDFDocument.create(); pdf.addPage(); saveFile(templatePath, Buffer.from(await pdf.save()));
    const template = await prisma.pdfTemplate.create({ data: { providerId: provider.id, name: "Synthetic reviewed packet", filePath: templatePath, pageCount: 1, isActive: true, mappingStatus: "APPROVED", mappingScore: 100, approvedAt: new Date(0) } });
    for (const role of ["witness", "medicalDirector"]) await prisma.pdfFieldMapping.create({ data: { templateId: template.id, fieldKey: `synthetic_${role}`, page: 1, data: JSON.stringify({ type: "signature", source: "signature", role, required: true, x: 10, y: 10, width: 100, height: 30 }) } });
    let readiness = await generationReadinessForIntake(intake.id, provider.id); assert(readiness);
    assert.equal(readiness.blockers.filter(b => b.code === "additional_signature_missing").length, 2);
    await prisma.signature.create({ data: { intakeId: intake.id, role: "witness", printedName: "Synthetic Witness", signedDate: "2026-09-06", imageData: "synthetic-not-rendered", contentRevision: 7 } });
    readiness = await generationReadinessForIntake(intake.id, provider.id); assert(readiness);
    assert(readiness.blockers.some(b => b.code === "additional_signature_invalid"));
    await prisma.signature.update({ where: { intakeId_role: { intakeId: intake.id, role: "witness" } }, data: { contentRevision: 8 } });
    await prisma.pdfFieldMapping.update({ where: { templateId_fieldKey: { templateId: template.id, fieldKey: "synthetic_medicalDirector" } }, data: { data: JSON.stringify({ type: "signature", role: "medicalDirector", required: false }) } });
    readiness = await generationReadinessForIntake(intake.id, provider.id); assert(readiness);
    assert(!readiness.blockers.some(b => b.code.startsWith("additional_signature")), "An optional special signature is not a blocker");
    await prisma.uploadedDocument.update({ where: { id: cca.id }, data: { reviewJson: JSON.stringify({ ...emptyCcaReview(), sourceClientName: "Other Synthetic Person", sourceClientDob: client.dob, majorErrors: [] }) } });
    readiness = await generationReadinessForIntake(intake.id, provider.id); assert(readiness);
    assert(readiness.blockers.some(b => b.code === "cca_identity"), "Legacy CCA mismatch blocks even when its old majorErrors is empty");
    await prisma.uploadedDocument.update({ where: { id: cca.id }, data: { reviewJson: JSON.stringify({ ...emptyCcaReview(), sourceClientName: client.fullName, sourceClientDob: client.dob }) } });
    readiness = await generationReadinessForIntake(intake.id, provider.id); assert(readiness);
    assert(!readiness.blockers.some(b => b.code === "cca_identity"));
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "COMPLETED", submittedAt: new Date() } });
    const delivery = await sendCompletedCopiesLink({ intakeId: intake.id, providerId: provider.id, req: new Request("http://localhost") });
    assert.equal(delivery.status, 409, "A COMPLETED status alone cannot send an unavailable packet link");
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } })).copyToken, null);
    assert.equal(await prisma.messageDelivery.count(), 0);
    const providerDelivery = await sendCompletedPacketToProvider({ intakeId: intake.id, providerId: provider.id });
    assert.equal(providerDelivery.skipped, true);
    assert.equal(await prisma.auditLog.count({ where: { event: { in: ["copies_link_sent", "provider_packet_email_sent"] } } }), 0);
    bindTestCookies({ get: name => name === SESSION_COOKIE ? { value: createSessionValue(user.id) } : undefined });
    const listing = await listIntakes(new NextRequest(`http://localhost/api/intakes?providerId=${provider.id}`));
    assert.equal(listing.status, 200);
    const listed = (await listing.json()).intakes.find((row: { id: string }) => row.id === intake.id);
    const finalReadiness = await completionReadinessForIntake(intake.id, provider.id); assert(finalReadiness);
    assert.equal(listed.completionReady, finalReadiness.ready);
    assert.deepEqual(listed.completionBlockers, finalReadiness.blockers, "Dashboard and final completion return the same blockers and reasons");
    assert(listed.completionBlockers.some((b: { code: string }) => b.code === "preflight_required"));
    const completeFacts: WorkflowFacts = { id: intake.id, status: "COMPLETED", submittedAt: new Date(), archived: false, expectCca: true, hasCca: true, hasClientSignature: true, hasStaffSignature: true, missingRequiredCount: 0, staffReviewed: true, providerPacketReady: true, packetState: "current", deliveryConfirmed: true, deliveryFailed: false, deliveryAttempted: true, openFollowUp: false };
    for (const [code, stage] of [["preflight_required", "STAFF_REVIEW"], ["preflight_finding", "STAFF_REVIEW"], ["record_conflict", "STAFF_REVIEW"], ["cca_identity", "CCA"], ["additional_signature_missing", "QP_SIGNATURE"]]) {
      const action = nextWorkflowAction({ ...completeFacts, generationBlockers: [{ code, message: `Synthetic ${code} blocker` }] });
      assert.equal(action.stage, stage);
      assert.equal(action.reason, `Synthetic ${code} blocker`, "The actual final-gate reason must replace the old ready/delivery action");
    }
    assert.equal(nextWorkflowAction({ ...completeFacts, generationBlockers: [] }).stage, "COMPLETE");
    const planAnswers = Object.fromEntries([...PCP_PLAN_FIELD_KEYS, ...CRISIS_PLAN_FIELD_KEYS].map(key => [key, "Synthetic plan field"]));
    Object.assign(planAnswers, { pcp_plan_date: "2026-09-06", crisis_plan_date: "2026-09-06", pcp_plan_source: "staff", crisis_plan_source: "staff" });
    const planInput = {
      intake: { archived: false, submittedAt: new Date(), expectCca: false, contentRevision: 1,
        client: { fullName: "Synthetic Plan Client", dob: "2000-01-01" }, provider: null, signatures: [], uploadedDocuments: [],
        auditLogs: [{ event: "staff_reviewed", detail: null, createdAt: new Date() }] },
      answers: planAnswers, providerPacket: { ready: true, message: "Synthetic ready template" }, signatureSlotProfile: { requiredSlots: [] },
    };
    const signaturePlan = generationReadinessFromSnapshot(planInput).blockers.find(blocker => blocker.code === "plan_incomplete");
    assert.deepEqual(signaturePlan?.unmetGates, ["signatures"]);
    assert.equal(nextWorkflowAction({ ...completeFacts, hasClientSignature: false, generationBlockers: [signaturePlan!] }).stage, "CLIENT_RESPONSE", "A signature-only plan gate cannot send a reviewed case back to staff review forever");
    const clientOnlyEnvelope = generationReadinessFromSnapshot(planInput, { allowMissingClientSignature: true });
    assert(!clientOnlyEnvelope.blockers.some(blocker => blocker.code === "plan_incomplete"), "DocuSign may collect the outstanding client plan signature");
    assert(clientOnlyEnvelope.blockers.some(blocker => blocker.code === "staff_signature_missing"), "DocuSign must not waive staff signing");
    const badDatePlan = generationReadinessFromSnapshot({ ...planInput, answers: { ...planAnswers, pcp_plan_date: "pending" } }).blockers.find(blocker => blocker.code === "plan_incomplete");
    assert(badDatePlan?.unmetGates?.includes("date"));
    assert.equal(nextWorkflowAction({ ...completeFacts, hasClientSignature: false, generationBlockers: [badDatePlan!] }).stage, "STAFF_REVIEW", "Content gates are resolved before collecting another signature");
    assert(generationReadinessFromSnapshot({ ...planInput, signatureSlotProfile: { requiredSlots: ["witness"] } }, { allowMissingClientSignature: true }).blockers.some(blocker => blocker.code === "additional_signature_missing"), "DocuSign must not waive required special-role signatures");

    // Pause a dashboard after its initial query, then record a newer stage.
    // The resumed GET must neither close that interval nor reopen its old stage.
    const racing = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: randomUUID(), tokenExpiresAt: new Date("2099-01-01"), expectCca: false } });
    const originalFindMany = prisma.intake.findMany;
    let interleaved = false;
    prisma.intake.findMany = (async (...args: Parameters<typeof originalFindMany>) => {
      const snapshot = await originalFindMany(...args);
      if (!interleaved) {
        interleaved = true;
        await prisma.intake.update({ where: { id: racing.id }, data: { archived: true } });
        assert.equal((await observeIntakeWorkflow(racing.id))?.stage, "ARCHIVED");
      }
      return snapshot;
    }) as typeof originalFindMany;
    try {
      const racingListing = await listIntakes(new NextRequest(`http://localhost/api/intakes?providerId=${provider.id}`));
      assert.equal(racingListing.status, 200);
      const racingRow = (await racingListing.json()).intakes.find((row: { id: string }) => row.id === racing.id);
      assert.equal(racingRow.nextAction.stage, "ARCHIVED");
      const intervals = await prisma.workflowInterval.findMany({ where: { intakeId: racing.id } });
      assert.equal(intervals.length, 1, "A delayed dashboard cannot create a spurious stage transition");
      assert.equal(intervals[0].stage, "ARCHIVED"); assert.equal(intervals[0].endedAt, null);
    } finally { prisma.intake.findMany = originalFindMany; }

    const docuSignKeys = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY"] as const;
    const previousDocuSign = docuSignKeys.map(key => [key, process.env[key]] as const);
    try {
      for (const key of docuSignKeys) process.env[key] = "synthetic-never-used";
      await prisma.intake.update({ where: { id: intake.id }, data: { docusignEnvelopeId: null } });
      const noStaff = await sendIntakeToDocuSign({ intakeId: intake.id, providerId: provider.id, userId: user.id });
      assert.equal(noStaff.status, "unsupported_recipient"); assert.match(noStaff.message, /Staff \/ QP/);
      const staffRevision = (await loadAnswerSnapshot(intake.id)).contentRevision;
      await prisma.signature.create({ data: { intakeId: intake.id, role: "staff", printedName: user.name, imageData: "synthetic-not-rendered", signedDate: "2026-09-06", contentRevision: staffRevision } });
      await prisma.client.update({ where: { id: client.id }, data: { dob: "2014-01-01", guardianName: "Synthetic Guardian", guardianEmail: null, email: null } });
      const guardian = await sendIntakeToDocuSign({ intakeId: intake.id, providerId: provider.id, userId: user.id });
      assert.equal(guardian.status, "missing_email"); assert.match(guardian.message, /guardian/i);
      assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } })).docusignEnvelopeId, null, "Unsupported routes never create an envelope");
    } finally {
      for (const [key, value] of previousDocuSign) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const consentResponses: Record<string, boolean | string> = Object.fromEntries(SECTIONS.flatMap(section => section.questions).filter(question => question.type === "consent").map(question => [question.key, true]));
    consentResponses.consent_hipaa = "Declined acknowledgment";
    const consentState = (answers: typeof consentResponses) => buildPacketChecklistChips({ answers, uploadedDocuments: [], expectCca: false, hasCca: false, signatureStatuses: [] }).find(chip => chip.key === "consents")?.state;
    assert.equal(consentState(consentResponses), "keep", "A documented privacy-notice decline is an answered response, not a missing consent");
    assert.equal(consentsFromAnswers(consentResponses).consent_hipaa, false, "Recorded acknowledgment decline must never become agreement in the packet");
    assert.equal(consentResponses.consent_hipaa, "Declined acknowledgment");
    assert.equal(consentState({ ...consentResponses, consent_hipaa: "" }), "missing");
    assert.equal(consentState({ ...consentResponses, consent_hipaa: false }), "missing");
    assert(!DOCUSIGN_SEND_CONFIRM.includes("routed to your signed-in staff"));
    const allRequiredSignedHint = signatureSendHint({ packetReady: true, statuses: [
      { key: "client_guardian", label: "Client", state: "captured", required: true, onPacket: true, reason: "" },
      { key: "staff_qp", label: "Staff / QP", state: "captured", required: true, onPacket: true, reason: "" },
      { key: "witness", label: "Optional witness", state: "missing", required: false, onPacket: true, reason: "Optional signature not captured." },
    ] });
    assert.equal(allRequiredSignedHint.enabled, false);
    assert.equal(allRequiredSignedHint.reason, "All required signatures are captured.", "Optional mapped signatures cannot imply a required signature is missing");
    assert.equal(signatureSendHint({ packetReady: true, statuses: [{ key: "staff_qp", label: "Staff", required: true, state: "missing", reason: "" }, { key: "client_guardian", label: "Client", required: true, state: "captured", reason: "" }] }).enabled, false);
    // A staff review certifies the viewed content, not whichever version won
    // another request while this browser was open or its audit was pending.
    const reviewCase = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: randomUUID(), tokenExpiresAt: new Date("2099-01-01"), expectCca: false, status: "SIGNED", submittedAt: new Date() } });
    const reviewRequest = (body: unknown) => staffPatch(new NextRequest(`http://localhost/api/intakes/${reviewCase.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: reviewCase.id }) });
    assert.equal((await reviewRequest({ answers: { presenting_problem: "Synthetic original answer" }, expectedAnswerRevisions: {} })).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: reviewCase.id, event: "staff_reviewed" } }), 0, "Routine staff answer saves do not certify a review");
    const viewedReview = await loadAnswerSnapshot(reviewCase.id);
    await saveAnswers(reviewCase.id, { employment_status: "Synthetic newer answer in another tab" });
    const staleReview = await reviewRequest({ answers: {}, expectedAnswerRevisions: {}, recordStaffReview: true, expectedContentRevision: viewedReview.contentRevision });
    assert.equal(staleReview.status, 409); assert.equal((await staleReview.json()).code, "CONTENT_REVISION_CONFLICT");
    const currentReview = await loadAnswerSnapshot(reviewCase.id);
    assert.equal((await reviewRequest({ answers: { presenting_problem: "Keep this unsaved draft" }, expectedAnswerRevisions: currentReview.answerRevisions, recordStaffReview: true, expectedContentRevision: viewedReview.contentRevision })).status, 409);
    assert.deepEqual(await loadAnswerSnapshot(reviewCase.id), currentReview, "Rejected reviews neither change answers nor consume revisions");
    assert.equal((await reviewRequest({ answers: {}, expectedAnswerRevisions: {}, recordStaffReview: true })).status, 409, "Explicit review requires the viewed revision even with no dirty answers");
    assert.equal(await prisma.auditLog.count({ where: { intakeId: reviewCase.id, event: "staff_reviewed" } }), 0);
    assert.equal((await reviewRequest({ answers: {}, expectedAnswerRevisions: {}, recordStaffReview: true, expectedContentRevision: currentReview.contentRevision })).status, 200);
    assert.deepEqual(await loadAnswerSnapshot(reviewCase.id), currentReview, "A current no-op review does not alter answers or content revision");
    const firstReviewAudit = await prisma.auditLog.findFirstOrThrow({ where: { intakeId: reviewCase.id, event: "staff_reviewed" }, orderBy: { createdAt: "desc" } });
    assert.equal(firstReviewAudit.detail, `contentRevision:${currentReview.contentRevision}`);
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: reviewCase.id } })).status, "SIGNED", "Unchanged review preserves the case status");

    const originalTransaction = prisma.$transaction.bind(prisma);
    let injectAfterCommit = true;
    prisma.$transaction = (async (...args: unknown[]) => {
      const result = await (originalTransaction as (...values: unknown[]) => Promise<unknown>)(...args);
      if (injectAfterCommit) {
        injectAfterCommit = false;
        await saveAnswers(reviewCase.id, { presenting_problem: "Synthetic answer changed immediately after the review committed" });
      }
      return result;
    }) as typeof prisma.$transaction;
    try {
      assert.equal((await reviewRequest({ answers: { presenting_problem: "Synthetic reviewed correction" }, expectedAnswerRevisions: currentReview.answerRevisions, recordStaffReview: true, expectedContentRevision: currentReview.contentRevision })).status, 200);
    } finally { prisma.$transaction = originalTransaction; }
    const finalReviewAudit = await prisma.auditLog.findFirstOrThrow({ where: { intakeId: reviewCase.id, event: "staff_reviewed" }, orderBy: { createdAt: "desc" } });
    assert.equal(finalReviewAudit.detail, `contentRevision:${currentReview.contentRevision + 1}`, "Review audit is committed with its own saved revision before a later writer can run");
    const afterReviewRace = await loadAnswerSnapshot(reviewCase.id);
    assert.equal(afterReviewRace.contentRevision, currentReview.contentRevision + 2);
    // Equal timestamps must not accidentally make the later revision reviewed.
    await prisma.intakeAnswer.updateMany({ where: { intakeId: reviewCase.id }, data: { updatedAt: finalReviewAudit.createdAt } });
    assert((await generationReadinessForIntake(reviewCase.id, provider.id))?.blockers.some(blocker => blocker.code === "staff_review_required"));
    console.log("Preflight/staff-review concurrency, DocuSign import, required signatures, CCA identity, delivery gates, and master provider-cookie checks passed (isolated synthetic database; no external calls).");
  } finally {
    bindTestCookies(null);
    deleteFile(templatePath);
    await prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    globalThis.fetch = originalFetch;
    context.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
