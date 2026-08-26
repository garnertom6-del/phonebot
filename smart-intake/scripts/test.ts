/**
 * End-to-end verification (npm run test). Requires: npm run db:push && npm run seed.
 *  1. Staff login credentials verify against the seeded user
 *  2. Secure tokens are random and expire per config
 *  3. The ACTUAL packet PDF loads and has 43 pages
 *  4. fillPacket produces a PDF whose header carries the client name on ALL 43 pages
 *  5. Voice/typed answers land in the PDF (presenting problem on page 4 & 5)
 *  6. Consent signatures are placed on agreed forms; staff slots stay blank
 *  7. Required-field validation catches missing items
 *  8. Sample completed PDFs exist
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { fillPacket, loadTemplateBytes } from "../src/lib/fillPdf";
import {
  packetFieldsForTemplate,
  isValidProviderPacketMappingScore,
  ProviderPacketNotReadyError,
  providerPacketReadiness,
  providerPacketReadinessFromTemplates,
  requireProviderPacketForCompletion,
  WELLIANCE_PACKET_SHA256,
} from "../src/lib/providerPacketTemplates";
import { saveProviderPacketMappings } from "../src/lib/providerPacketMappingWrites";
import { sendCompletedCopiesLink } from "../src/lib/sendCompletedCopies";
import { signatureForRole } from "../src/lib/signaturePlacement";
import { consentsFromAnswers, loadAnswers, loadSignatures, saveAnswers } from "../src/lib/intakeData";
import { applyOperationalDefaults } from "../src/lib/answerDefaults";
import { clientLinkRenewalData, newIntakeToken, tokenExpiry } from "../src/lib/tokens";
import { clientDetailsSchema, missingRequired, newIntakeSchema, percentComplete } from "../src/lib/validation";
import { buildDashboardReadiness, needsStaffAction } from "../src/lib/dashboardWorkflow";
import { packetDisplayStatus } from "../src/lib/mappingStatus";
import { packetFilenameWarning } from "../src/lib/packetFilenameGuard";
import { assessMapping } from "../src/lib/mappingHealth";
import { catalogEntryByKey, mappingCatalog, mappedSourceKeys, newCatalogField } from "../src/lib/mappingCatalog";
import { evaluatePacketFreshness } from "../src/lib/packetFreshness";
import { buildCompletionReadiness } from "../src/lib/completionReadiness";
import { COPY_ALLOWED_STATUSES } from "../src/lib/completedCopies";
import { buildSignatureStatuses } from "../src/lib/signatureStatus";
import {
  clientLinkExpired,
  clientLinkMessagingFinished,
  reminderCooldownSeconds,
} from "../src/lib/clientLinkState";
import { followUpShareMessage, intakeShareMessage, signatureShareMessage } from "../src/lib/shareLinks";
import {
  clientDeliveryContacts,
  clientFollowUpDeliveryContacts,
} from "../src/lib/clientDeliveryContacts";
import { clientFollowUpQuestions, validateFollowUpSubmission } from "../src/lib/clientFollowUp";
import { clientDetailsAnswerPatch, clientDetailsRecordPatch } from "../src/lib/clientDetails";
import { deliveryDashboardFlash, hasSmsDeliveryFailure } from "../src/lib/dashboardFlash";
import {
  buildRulePreflight,
  groundedCorrectionOptionsFromAi,
  mergePreflightFindings,
} from "../src/lib/intakePreflight";
import {
  GET as getClientIntakeByToken,
  PATCH as saveClientIntakeByToken,
  POST as submitClientIntakeByToken,
} from "../src/app/api/intake/[token]/route";
import {
  GET as getClientFollowUp,
  POST as submitClientFollowUp,
} from "../src/app/api/follow-up/[token]/route";
import { POST as uploadClientDocumentByToken } from "../src/app/api/intake/[token]/upload/route";
import { POST as saveClientSignatureByToken } from "../src/app/api/intake/[token]/signature/route";

const prisma = new PrismaClient();

async function extractPageTexts(pdfBytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  const texts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    texts.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return texts;
}

async function main() {
  let passed = 0;
  const presenting = "I need help managing my $1 million per year of business";
  const defaulted = applyOperationalDefaults({ presenting_problem: presenting });
  assert.equal(defaulted.c_axis4, undefined, "presenting problem must not populate Axis IV");
  const ok = (name: string) => { console.log(`✓ ${name}`); passed++; };

  ok("presenting problem stays out of Axis IV");

  const diagnosisDefaults = applyOperationalDefaults({
    current_diagnosis_known: "Not reported",
    diagnosis_list: "Cocaine Use Disorder, Severe (F14.20); Major Depressive Disorder, Recurrent, Moderate (F33.1)",
    c_axis2: "Major Depressive Disorder, Recurrent, Moderate (F33.1)",
    c_axis5: "Cocaine Use Disorder, Severe (F14.20)",
  });
  assert.equal(diagnosisDefaults.c_axis1_code, "F14.20; F33.1");
  assert.equal(
    diagnosisDefaults.c_axis1_description,
    "Cocaine Use Disorder, Severe; Major Depressive Disorder, Recurrent, Moderate",
  );
  assert.equal(diagnosisDefaults.c_axis1_axis, "I");
  assert.equal(diagnosisDefaults.c_axis2, undefined);
  assert.equal(diagnosisDefaults.c_axis5, undefined);
  assert.equal(
    diagnosisDefaults.dis_adm_axis1,
    "Cocaine Use Disorder, Severe (F14.20); Major Depressive Disorder, Recurrent, Moderate (F33.1)",
  );
  assert.equal(diagnosisDefaults.dis_adm_axis2, undefined);
  assert.notEqual(diagnosisDefaults.c_axis1, "Not reported");
  const explicitAxis2 = applyOperationalDefaults({
    diagnosis_list: "Major Depressive Disorder (F33.1)",
    c_axis2: "Borderline Personality Disorder (F60.3)",
  });
  assert.equal(explicitAxis2.c_axis2, "Borderline Personality Disorder (F60.3)");
  assert.equal(explicitAxis2.c_axis2_code, "F60.3");
  ok("diagnosis defaults keep clinical diagnoses on Axis I and preserve a real Axis II");

  const staffOnlySignature = {
    signatures: {
      staff: { role: "staff", imageData: "", printedName: "QP Example", signedDate: "07/26/2026" },
    },
    consents: {},
    embedded: new Map(),
  };
  assert(signatureForRole(staffOnlySignature, "staff"));
  assert.equal(signatureForRole(staffOnlySignature, "clinician"), null);
  assert.equal(signatureForRole(staffOnlySignature, "witness"), null);
  ok("staff signatures never substitute for clinician or witness roles");

  const wellianceFields = packetFieldsForTemplate({
    name: "Welliance Care Intake Packet",
    originalFileName: "WELLIANCE CARE INTAKE FORM.pdf",
    pageCount: 36,
    providerSpecific: true,
    sha256: WELLIANCE_PACKET_SHA256,
  });
  const welliancePage1Headers = wellianceFields
    .filter((field) => field.page === 1 && field.fieldKey.startsWith("well_hdr_"))
    .sort((a, b) => a.x - b.x);
  assert.deepEqual(
    welliancePage1Headers.map((field) => field.source),
    ["client_full_name", "dob", "location", "mid_number", "record_number", "intake_date"],
  );
  assert(wellianceFields.some((field) => field.fieldKey === "well_axis1_code_p4"));
  assert(wellianceFields.some((field) =>
    field.page === 34 && field.fieldKey === "cca_client_sig" && field.role === "client",
  ));
  assert(wellianceFields.some((field) =>
    field.page === 34 && field.fieldKey === "cca_clinician_sig" && field.role === "clinician",
  ));
  assert(!wellianceFields.some((field) => field.page === 29 && field.source === "pcp_name"));
  assert.equal(
    wellianceFields.filter((field) => field.page === 36 && field.fieldKey.startsWith("well_plan_")).length,
    13,
  );
  assert.deepEqual(
    packetFieldsForTemplate({
      name: "Welliance Care Intake Packet",
      originalFileName: "revised-welliance-form.pdf",
      pageCount: 36,
      providerSpecific: true,
      sha256: "different-layout",
    }),
    [],
  );
  assert.deepEqual(
    packetFieldsForTemplate({
      name: "Unknown Provider",
      originalFileName: "different-form.pdf",
      pageCount: 12,
      providerSpecific: true,
    }),
    [],
  );
  ok("provider packets use verified template-specific coordinates");

  const approvedPacketDate = new Date("2026-07-26T12:00:00.000Z");
  const approvedProviderPacket = {
    id: "approved-packet",
    providerId: "provider-approved",
    name: "Approved Provider Intake Packet",
    originalFileName: "approved-provider.pdf",
    pageCount: 12,
    isActive: true,
    mappingStatus: "APPROVED",
    mappingScore: 96,
    approvedAt: approvedPacketDate,
    updatedAt: approvedPacketDate,
    fileAvailable: true,
  };
  const sharedDefaultPacket = {
    ...approvedProviderPacket,
    id: "shared-default",
    providerId: null,
    name: "Legacy Shared Default",
    originalFileName: "legacy-default.pdf",
  };
  const approvedReadiness = providerPacketReadinessFromTemplates(
    "provider-approved",
    [approvedProviderPacket, sharedDefaultPacket],
  );
  assert.equal(approvedReadiness.ready, true);
  assert.equal(approvedReadiness.templateId, "approved-packet");
  const unreadyReadiness = providerPacketReadinessFromTemplates(
    "provider-unready",
    [approvedProviderPacket, sharedDefaultPacket],
  );
  assert.equal(unreadyReadiness.ready, false);
  assert.equal(unreadyReadiness.state, "MISSING");
  assert(unreadyReadiness.message.includes("upload, map, review, approve, and activate"));
  const legacyReadiness = providerPacketReadinessFromTemplates("provider-unready", [{
    ...approvedProviderPacket,
    id: "legacy-provider-packet",
    providerId: "provider-unready",
    approvedAt: null,
  }]);
  assert.equal(legacyReadiness.ready, false);
  assert.equal(legacyReadiness.state, "LEGACY_UNVERIFIED");
  assert(isValidProviderPacketMappingScore(0));
  assert(isValidProviderPacketMappingScore(100));
  assert(!isValidProviderPacketMappingScore(-1));
  assert(!isValidProviderPacketMappingScore(101));
  assert(!isValidProviderPacketMappingScore(1.5));
  const missingFileReadiness = providerPacketReadinessFromTemplates("provider-approved", [{
    ...approvedProviderPacket,
    fileAvailable: false,
  }]);
  assert.equal(missingFileReadiness.ready, false);
  assert.equal(missingFileReadiness.state, "LEGACY_UNVERIFIED");
  assert(missingFileReadiness.message.includes("missing or unreadable"));
  ok("packet readiness accepts only the exact provider's explicitly approved active packet");

  const preflightInput = {
    answers: {
      client_full_name: "Test Client",
      dob: "1990-01-01",
      intake_date: "2026-07-26",
      screening_date: "2026-07-25",
      initial_assessment_date: "2026-07-24",
      cca_assessment_date: "2026-07-20",
    },
    client: { fullName: "Test Client", dob: "1991-02-02" },
    missingRequired: [],
    missingOptional: [],
    hasClientSignature: true,
    hasCca: true,
    expectCca: true,
  };
  const rulePreflight = buildRulePreflight(preflightInput);
  const dobFinding = rulePreflight.find((finding) => finding.key === "identity_dob");
  assert.equal(dobFinding?.correctionOptions?.[0]?.updates[0]?.sourceKey, "@client.dob");
  assert.equal(dobFinding?.correctionOptions?.[0]?.updates[0]?.proposedValue, "1991-02-02");
  const dateFinding = rulePreflight.find((finding) => finding.key === "assessment_dates");
  assert.deepEqual(
    dateFinding?.correctionOptions?.[0]?.updates.map((update) => [update.key, update.sourceKey]),
    [
      ["screening_date", "intake_date"],
      ["initial_assessment_date", "intake_date"],
    ],
  );
  ok("rule preflight corrections are grounded in intake-record values");

  const axisAnswers = {
    c_axis1: "",
    c_axis2: "Major Depressive Disorder (F33.1)",
    consent_hipaa: "Yes",
  };
  const groundedAxisOptions = groundedCorrectionOptionsFromAi([{
    id: "move-axis",
    label: "Move the recorded diagnosis to Axis I",
    detail: "Move the existing Axis II value to Axis I and clear Axis II.",
    updates: [
      { key: "c_axis1", sourceKey: "c_axis2" },
      { key: "c_axis2", sourceKey: "@clear" },
    ],
  }], {
    answers: axisAnswers,
    client: { fullName: "Test Client", dob: "1991-02-02" },
  });
  assert.equal(groundedAxisOptions.length, 1);
  assert.equal(groundedAxisOptions[0].updates[0].proposedValue, "Major Depressive Disorder (F33.1)");
  assert.equal(groundedAxisOptions[0].updates[1].proposedValue, "");

  const unsafeOptions = groundedCorrectionOptionsFromAi([
    {
      id: "invent-height",
      label: "Fill height",
      detail: "Use an unsupported source.",
      updates: [{ key: "height", sourceKey: "ai_generated_height" }],
    },
    {
      id: "change-consent",
      label: "Change consent",
      detail: "Consent fields cannot be changed by preflight.",
      updates: [{ key: "consent_hipaa", sourceKey: "@clear" }],
    },
    {
      id: "duplicate-target",
      label: "Duplicate target",
      detail: "A correction cannot update one field twice.",
      updates: [
        { key: "c_axis1", sourceKey: "c_axis2" },
        { key: "c_axis1", sourceKey: "@clear" },
      ],
    },
  ], {
    answers: axisAnswers,
    client: { fullName: "Test Client", dob: "1991-02-02" },
  });
  assert.deepEqual(unsafeOptions, []);
  ok("AI corrections reject invented sources, protected fields, and duplicate targets");

  const mergedPreflight = mergePreflightFindings(rulePreflight, [
    {
      key: "ai_dob_conflict",
      severity: "error",
      title: "Duplicate DOB conflict",
      detail: "The AI also found the DOB mismatch.",
      fieldKeys: ["dob"],
      source: "ai",
    },
    {
      key: "ai_guardian_email",
      severity: "info",
      title: "Guardian email should be reviewed",
      detail: "This finding is not covered by the automatic identity check.",
      fieldKeys: ["guardian_email"],
      source: "ai",
    },
  ]);
  assert(!mergedPreflight.some((finding) => finding.key === "ai_dob_conflict"));
  assert(mergedPreflight.some((finding) => finding.key === "ai_guardian_email"));
  ok("automatic identity checks suppress duplicate AI findings");

  const correctedClient = clientDetailsSchema.parse({
    fullName: "Example Client",
    dob: "1980-01-15",
    midNumber: "TEST-MID-0001",
    recordNumber: "TEST-REC-001",
    email: "client@example.com",
    phone: "(336) 555-0100",
    guardianName: "",
    guardianEmail: "",
    guardianPhone: "",
  });
  const correctedAnswers = clientDetailsAnswerPatch(correctedClient);
  const correctedRecord = clientDetailsRecordPatch(correctedClient);
  assert.equal(correctedAnswers.client_phone_cell, "(336) 555-0100");
  assert.equal(correctedAnswers.client_phone_home, "(336) 555-0100");
  assert.equal(correctedRecord.guardianName, null);
  assert.equal(correctedRecord.email, "client@example.com");
  assert(!clientDetailsSchema.safeParse({ ...correctedClient, phone: "123" }).success);
  ok("dashboard client corrections stay in sync with packet answers");

  assert.equal(deliveryDashboardFlash([], ["sms failed"]), null);
  assert.equal(deliveryDashboardFlash(["email accepted"], [])?.kind, "success");
  assert.equal(deliveryDashboardFlash(["email accepted"], ["sms failed"])?.kind, "warning");
  assert(!deliveryDashboardFlash(["email accepted"], ["sms failed"])?.message.includes("email accepted"));
  assert(hasSmsDeliveryFailure(["sms to saved contact: blocked (30034)"]));
  assert(!hasSmsDeliveryFailure(["email to saved contact: blocked"]));
  assert(deliveryDashboardFlash(["email accepted"], ["sms failed"])?.message.includes("Manual sending"));
  ok("successful delivery returns to the dashboard without storing contact details");

  assert(needsStaffAction("SIGNED"), "signed intakes must remain in the staff action queue");
  assert(needsStaffAction("SUBMITTED"), "submitted intakes must remain in the staff action queue");
  assert(!needsStaffAction("IN_PROGRESS"), "in-progress intakes belong in the waiting-on-client queue");
  assert(!needsStaffAction("COMPLETED"), "completed intakes must leave the staff action queue");
  assert(
    needsStaffAction("COMPLETED", { tone: "warn", state: "Upload the CCA" }),
    "missing CCA or a stale packet must still appear in Needs staff action",
  );
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 0,
      packetState: "missing",
      hasCca: false,
      expectCca: true,
      hasStaffSignature: false,
      providerPacketReady: true,
    }).state,
    "Upload the CCA",
  );
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 2,
      packetState: "missing",
      hasCca: true,
      expectCca: true,
      hasStaffSignature: false,
      providerPacketReady: true,
    }).state,
    "Complete required information",
  );
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 0,
      packetState: "missing",
      hasCca: true,
      expectCca: true,
      hasStaffSignature: true,
      providerPacketReady: true,
    }).state,
    "Generate the completed packet",
  );
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 0,
      packetState: "current",
      hasCca: true,
      expectCca: true,
      hasStaffSignature: true,
      providerPacketReady: true,
    }).state,
    "Ready for final staff review",
  );
  assert.equal(
    newIntakeSchema.parse({
      fullName: "Workflow Test",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-1",
      phone: "3365550142",
      autoEmailProviderPacket: true,
    }).autoEmailProviderPacket,
    true,
    "new-intake validation must retain provider packet email choice",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "No Contact",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-NC",
    }).success,
    false,
    "create-intake requires a phone number or email",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Email Only",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-EM",
      email: "client@example.test",
    }).success,
    true,
    "email alone is enough to create an intake",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Future Client",
      dob: "2999-01-01",
      recordNumber: "WORKFLOW-2",
    }).success,
    false,
    "future DOBs must be rejected",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Invalid Date",
      dob: "02/30/2000",
      recordNumber: "WORKFLOW-3",
    }).success,
    false,
    "impossible DOBs must be rejected",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Invalid Phone",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-4",
      phone: "12345",
    }).success,
    false,
    "short phone numbers must be rejected",
  );
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 0,
      packetState: "stale",
      hasCca: true,
      expectCca: true,
      hasStaffSignature: true,
      providerPacketReady: true,
    }).state,
    "Regenerate the updated packet",
  );
  const packetCreatedAt = new Date("2026-07-25T12:00:00.000Z");
  assert.equal(evaluatePacketFreshness({ latestPdf: null }).state, "missing");
  assert.equal(
    evaluatePacketFreshness({
      latestPdf: { id: "pdf-1", createdAt: packetCreatedAt },
      latestAnswerUpdatedAt: new Date("2026-07-25T11:59:00.000Z"),
    }).state,
    "current",
  );
  assert.equal(
    evaluatePacketFreshness({
      latestPdf: { id: "pdf-1", createdAt: packetCreatedAt },
      latestSignatureUpdatedAt: new Date("2026-07-25T12:01:00.000Z"),
    }).state,
    "stale",
  );
  assert.equal(
    evaluatePacketFreshness({
      latestPdf: { id: "pdf-1", createdAt: packetCreatedAt },
      packetTemplateUpdatedAt: new Date("2026-07-25T12:01:00.000Z"),
    }).state,
    "stale",
    "activating a provider packet must invalidate an older generated PDF",
  );
  const blockedCompletion = buildCompletionReadiness({
    archived: false,
    submittedAt: packetCreatedAt,
    missingRequired: [],
    expectCca: true,
    hasCca: true,
    hasStaffSignature: false,
    providerPacketReady: true,
    packetState: "current",
  });
  assert.equal(blockedCompletion.ready, false);
  assert(blockedCompletion.blockers.some((blocker) => blocker.code === "staff_signature_missing"));
  assert.equal(
    buildCompletionReadiness({
      archived: false,
      submittedAt: packetCreatedAt,
      missingRequired: [],
      expectCca: true,
      hasCca: true,
      hasStaffSignature: true,
      providerPacketReady: true,
      packetState: "current",
    }).ready,
    true,
  );
  const packetBlockedCompletion = buildCompletionReadiness({
    archived: false,
    submittedAt: packetCreatedAt,
    missingRequired: [],
    expectCca: true,
    hasCca: true,
    hasStaffSignature: true,
    providerPacketReady: false,
    providerPacketMessage: unreadyReadiness.message,
    packetState: "current",
  });
  assert.equal(packetBlockedCompletion.ready, false);
  assert.equal(packetBlockedCompletion.blockers.length, 1);
  assert.equal(packetBlockedCompletion.blockers[0]?.code, "provider_packet_not_ready");
  assert.deepEqual(COPY_ALLOWED_STATUSES, ["SIGNED", "COMPLETED"]);
  assert.equal(
    buildSignatureStatuses([]).find((status) => status.key === "staff_qp")?.required,
    true,
  );
  ok("provider dashboard workflow and delivery settings");

  // 1. staff login
  const user = await prisma.user.findUnique({ where: { email: "admin@mooredivinecare.local" } });
  assert(user, "seeded staff user missing - run npm run seed");
  assert(await bcrypt.compare("IntakeDemo123!", user!.passwordHash), "staff password mismatch");
  ok("staff login verifies (admin@mooredivinecare.local)");

  const approvedProvider = await prisma.provider.findUnique({ where: { slug: "moore-divine-care" } });
  assert(approvedProvider, "seeded approved provider missing");
  const liveApprovedReadiness = await providerPacketReadiness(approvedProvider!.id);
  assert.equal(liveApprovedReadiness.ready, true, liveApprovedReadiness.message);
  const liveApprovedPacket = await requireProviderPacketForCompletion(approvedProvider!.id);
  assert.equal(liveApprovedPacket.providerSpecific, true);
  assert(liveApprovedPacket.bytes.length > 400000);

  await prisma.provider.deleteMany({ where: { slug: "packet-readiness-unready-test" } });
  const unreadyProvider = await prisma.provider.create({
    data: { name: "Packet Readiness Unready Test", slug: "packet-readiness-unready-test" },
  });
  try {
    const liveUnreadyReadiness = await providerPacketReadiness(unreadyProvider.id);
    assert.equal(liveUnreadyReadiness.ready, false);
    assert.equal(liveUnreadyReadiness.state, "MISSING");
    await assert.rejects(
      () => requireProviderPacketForCompletion(unreadyProvider.id),
      (error: unknown) => error instanceof ProviderPacketNotReadyError
        && error.code === "PROVIDER_PACKET_NOT_READY"
        && error.message.includes("upload, map, review, approve, and activate"),
    );

    const missingFileTemplate = await prisma.pdfTemplate.create({
      data: {
        providerId: unreadyProvider.id,
        name: `Missing Packet Test ${unreadyProvider.id}`,
        filePath: "templates/providers/missing-packet-test.pdf",
        originalFileName: "missing-packet-test.pdf",
        pageCount: 1,
        isActive: true,
        mappingStatus: "APPROVED",
        mappingScore: 100,
        approvedAt: new Date(),
      },
    });
    const missingFileState = await providerPacketReadiness(unreadyProvider.id);
    assert.equal(missingFileState.ready, false);
    assert(missingFileState.message.includes("missing or unreadable"));
    await assert.rejects(
      () => requireProviderPacketForCompletion(unreadyProvider.id),
      (error: unknown) => error instanceof ProviderPacketNotReadyError
        && error.code === "PROVIDER_PACKET_NOT_READY"
        && error.message.includes("missing or unreadable"),
    );

    const unreadyClient = await prisma.client.create({
      data: {
        providerId: unreadyProvider.id,
        fullName: "Packet Gate Test Client",
        dob: "1980-01-01",
      },
    });
    const unreadyIntake = await prisma.intake.create({
      data: {
        providerId: unreadyProvider.id,
        clientId: unreadyClient.id,
        status: "SIGNED",
        submittedAt: new Date(),
        token: newIntakeToken(),
        tokenExpiresAt: tokenExpiry(),
      },
    });
    const copiesBlocked = await sendCompletedCopiesLink({
      intakeId: unreadyIntake.id,
      providerId: unreadyProvider.id,
      req: new Request("http://localhost"),
    });
    assert.equal(copiesBlocked.status, 409);
    assert.equal(copiesBlocked.body.code, "PROVIDER_PACKET_NOT_READY");

    const remapTemplate = await prisma.pdfTemplate.create({
      data: {
        providerId: unreadyProvider.id,
        name: `Remap Revocation Test ${unreadyProvider.id}`,
        filePath: "public/templates/MooreDivineCare_Intake_Packet-1.pdf",
        originalFileName: "MooreDivineCare_Intake_Packet-1.pdf",
        pageCount: 43,
        isActive: false,
        mappingStatus: "APPROVED",
        mappingScore: 100,
        approvedAt: new Date(),
      },
    });
    const mappingInput = [{
      fieldKey: "client_full_name",
      page: 1,
      source: "client_full_name",
      type: "text",
      x: 10,
      y: 10,
    }];
    assert.equal(await saveProviderPacketMappings({
      templateId: remapTemplate.id,
      fields: mappingInput,
      replaceExisting: true,
    }), 1);
    assert.equal(await saveProviderPacketMappings({
      templateId: remapTemplate.id,
      fields: mappingInput,
      replaceExisting: true,
    }), 1, "repeating the same remap should remain deterministic");
    const revokedTemplate = await prisma.pdfTemplate.findUnique({ where: { id: remapTemplate.id } });
    assert.equal(revokedTemplate?.mappingStatus, "DRAFT");
    assert.equal(revokedTemplate?.mappingScore, null);
    assert.equal(revokedTemplate?.approvedAt, null);
    assert.equal(revokedTemplate?.approvedByUserId, null);
    assert.equal(
      await prisma.pdfFieldMapping.count({ where: { templateId: remapTemplate.id } }),
      1,
    );
    assert.equal(missingFileTemplate.providerId, unreadyProvider.id);
  } finally {
    await prisma.intake.deleteMany({ where: { providerId: unreadyProvider.id } });
    await prisma.client.deleteMany({ where: { providerId: unreadyProvider.id } });
    await prisma.pdfTemplate.deleteMany({ where: { providerId: unreadyProvider.id } });
    await prisma.provider.delete({ where: { id: unreadyProvider.id } });
  }
  ok("packet gates reject missing files and copies, remaps revoke approval, and repeat runs stay safe");

  // 2. tokens
  const t1 = newIntakeToken(), t2 = newIntakeToken();
  assert(t1 !== t2 && t1.length >= 32, "tokens not random/long enough");
  const exp = tokenExpiry().getTime() - Date.now();
  assert(exp > 6.5 * 86400000 && exp < 7.5 * 86400000, "token expiry not ~7 days");
  const renewalNow = new Date("2026-07-25T12:00:00.000Z").getTime();
  const expiredRenewal = clientLinkRenewalData("2026-07-24T12:00:00.000Z", renewalNow);
  const activeRenewal = clientLinkRenewalData("2026-07-26T12:00:00.000Z", renewalNow);
  assert(expiredRenewal.token && expiredRenewal.token !== t1, "expired links must rotate to a new token");
  assert.equal(activeRenewal.token, undefined, "extending an active link must preserve its current URL");
  ok("secure client tokens (random, 7-day expiry)");

  const now = new Date("2026-07-25T12:00:00.000Z").getTime();
  assert(clientLinkExpired("2026-07-25T11:59:59.000Z", now), "past links must be expired");
  assert(!clientLinkExpired("2026-07-25T12:00:01.000Z", now), "future links must stay active");
  assert(clientLinkMessagingFinished("SIGNED"), "signed intakes must stop intake reminders");
  assert(clientLinkMessagingFinished("COMPLETED"), "completed intakes must stop intake reminders");
  assert(!clientLinkMessagingFinished("IN_PROGRESS"), "active intakes must allow reminders");
  assert.equal(reminderCooldownSeconds(new Date(now - 1_000), now), 59);
  assert.equal(reminderCooldownSeconds(new Date(now - 60_000), now), 0);

  const clientLink = "https://example.test/intake/random-token";
  const intakeMessage = intakeShareMessage(clientLink, "Test Provider", "336-555-0100");
  const signatureMessage = signatureShareMessage(clientLink, "Test Provider", "336-555-0100");
  for (const message of [intakeMessage, signatureMessage]) {
    assert(message.includes(clientLink), "client message must include the secure link");
    assert(message.includes("STOP to opt out"), "client SMS must include opt-out wording");
    assert(!/diagnos|medicat|mental health|substance/i.test(message), "client SMS must avoid health details");
    assert(!message.includes(`${clientLink}.`), "punctuation must not be attached to the secure URL");
  }
  assert(intakeMessage.includes("Save and return"), "intake SMS must explain save-and-return");
  assert(signatureMessage.includes("answers are saved"), "signature reminder must reassure the client");
  const followUpLink = "https://example.test/follow-up/random-token";
  const followUpMessage = followUpShareMessage(followUpLink, "Test Provider", "336-555-0100");
  assert(followUpMessage.includes(followUpLink), "follow-up SMS must include its private link");
  assert(followUpMessage.includes("STOP to opt out"), "follow-up SMS must include opt-out wording");
  assert(!/height|weight|hospital|diagnos|medicat/i.test(followUpMessage), "follow-up SMS must not name missing or health fields");
  assert(!followUpMessage.includes(`${followUpLink}.`), "punctuation must not be attached to the follow-up URL");

  const safeFollowUpQuestions = clientFollowUpQuestions(
    ["height", "weight", "consent_hipaa", "staff_receiving_intake"],
    { height: "", weight: "" },
  );
  assert.deepEqual(
    safeFollowUpQuestions.map((question) => question.key),
    ["height", "weight"],
    "follow-up must exclude consent and staff-only fields",
  );
  assert.deepEqual(
    clientFollowUpQuestions(["height", "weight"], { height: "5 ft 8 in", weight: "" })
      .map((question) => question.key),
    ["weight"],
    "follow-up must omit answers already present",
  );
  assert.deepEqual(
    clientFollowUpQuestions(
      ["hipaa_understood", "diagnosis_list", "guardian_name", "height"],
      { is_minor_or_incompetent: "No" },
    ).map((question) => question.key),
    ["height"],
    "follow-up must exclude signed acknowledgments and inapplicable conditional questions",
  );
  assert.deepEqual(
    clientFollowUpQuestions(
      ["guardian_name", "height"],
      { is_minor_or_incompetent: "Yes" },
    ).map((question) => question.key),
    ["guardian_name", "height"],
    "follow-up may ask a conditional question when its prerequisite applies",
  );
  assert.equal(
    validateFollowUpSubmission(safeFollowUpQuestions, {
      height: "5 ft 8 in",
      weight: "160 lb",
      consent_hipaa: "Yes",
    }).ok,
    false,
    "follow-up must reject fields outside the request",
  );
  assert.equal(
    validateFollowUpSubmission(safeFollowUpQuestions, {
      height: "5 ft 8 in",
      weight: "160 lb",
    }).ok,
    true,
    "follow-up must accept valid requested answers",
  );
  const deferredFollowUp = validateFollowUpSubmission(
    safeFollowUpQuestions,
    { height: "5 ft 8 in" },
    { skippedKeys: ["weight"] },
  );
  assert.equal(deferredFollowUp.ok, true, "client may defer an unknown requested answer to staff");
  assert.equal(
    validateFollowUpSubmission(
      safeFollowUpQuestions,
      { height: "5 ft 8 in" },
      { skippedKeys: ["diagnosis_list"] },
    ).ok,
    false,
    "client may not defer a field outside the follow-up request",
  );
  const guardianOnlyContacts = clientDeliveryContacts({
    guardianPhone: "336-555-0101",
    guardianEmail: "guardian@example.com",
  });
  assert.equal(guardianOnlyContacts.phone?.role, "guardian");
  assert.equal(guardianOnlyContacts.email?.value, "guardian@example.com");
  const clientPreferredContacts = clientDeliveryContacts({
    phone: "336-555-0102",
    guardianPhone: "336-555-0103",
  });
  assert.equal(clientPreferredContacts.phone?.value, "336-555-0102");
  const adultFollowUpContacts = clientFollowUpDeliveryContacts({
    phone: "336-555-0104",
    guardianEmail: "guardian@example.com",
  });
  assert.equal(adultFollowUpContacts.role, "client");
  assert.equal(adultFollowUpContacts.phone?.value, "336-555-0104");
  assert.equal(adultFollowUpContacts.email, null, "follow-up must not mix client phone with guardian email");
  const minorFollowUpContacts = clientFollowUpDeliveryContacts({
    phone: "336-555-0105",
    guardianEmail: "guardian@example.com",
  }, { is_minor_or_incompetent: "Yes" });
  assert.equal(minorFollowUpContacts.role, "guardian");
  assert.equal(minorFollowUpContacts.phone, null);
  assert.equal(minorFollowUpContacts.email?.value, "guardian@example.com");
  const clientSignerContacts = clientFollowUpDeliveryContacts({
    guardianEmail: "guardian@example.com",
  }, {}, [{ role: "client" }]);
  assert.equal(clientSignerContacts.role, "client");
  assert.equal(
    clientSignerContacts.email,
    null,
    "a client-signed intake must not fall back to an unconfirmed guardian contact",
  );
  const guardianSignerContacts = clientFollowUpDeliveryContacts({
    phone: "336-555-0105",
    guardianEmail: "guardian@example.com",
  }, {}, [{ role: "guardian" }]);
  assert.equal(guardianSignerContacts.role, "guardian");
  assert.equal(guardianSignerContacts.email?.value, "guardian@example.com");
  ok("client links, follow-up safeguards, cooldown, and privacy-safe SMS wording");

  const followUpClient = await prisma.client.create({
    data: {
      fullName: "Follow Up Test",
      dob: "1990-01-01",
      email: "follow-up@example.test",
      phone: "3365550109",
    },
  });
  const followUpIntake = await prisma.intake.create({
    data: {
      clientId: followUpClient.id,
      status: "SIGNED",
      token: newIntakeToken(),
      tokenExpiresAt: tokenExpiry(),
      intakeDate: "2026-07-26",
      submittedAt: new Date(),
    },
  });
  const secureFollowUpToken = newIntakeToken();
  try {
    await saveAnswers(followUpIntake.id, {
      client_full_name: followUpClient.fullName,
      dob: followUpClient.dob,
      presenting_problem: "Keep this existing answer",
    });
    await prisma.signature.create({
      data: {
        intakeId: followUpIntake.id,
        role: "client",
        imageData: "data:image/png;base64,iVBORw0KGgo=",
        printedName: followUpClient.fullName,
        relationship: "client",
        signedDate: "07/26/2026",
      },
    });
    const followUpRow = await prisma.intakeFollowUp.create({
      data: {
        intakeId: followUpIntake.id,
        token: secureFollowUpToken,
        fieldKeys: JSON.stringify([
          "height",
          "weight",
          "preferred_emergency_facility",
          "consent_hipaa",
          "staff_receiving_intake",
        ]),
        tokenExpiresAt: tokenExpiry(),
      },
    });
    const followUpGetRequest = new NextRequest(`http://localhost/api/follow-up/${secureFollowUpToken}`);
    const followUpGet = await getClientFollowUp(followUpGetRequest, { params: { token: secureFollowUpToken } });
    const followUpGetBody = await followUpGet.json() as {
      questions?: Array<{ key: string }>;
    };
    assert.equal(followUpGet.status, 200);
    assert.equal(followUpGet.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(
      followUpGetBody.questions?.map((question) => question.key),
      ["height", "weight", "preferred_emergency_facility"],
      "public follow-up route must expose only safe requested questions",
    );

    const forbiddenFollowUpRequest = new NextRequest(`http://localhost/api/follow-up/${secureFollowUpToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: { height: "5 ft 8 in", weight: "160 lb", consent_hipaa: "Yes" },
        attested: true,
      }),
    });
    const forbiddenFollowUp = await submitClientFollowUp(forbiddenFollowUpRequest, {
      params: { token: secureFollowUpToken },
    });
    assert.equal(forbiddenFollowUp.status, 400, "follow-up must reject unrequested consent changes");
    assert.equal(
      (await prisma.intakeFollowUp.findUnique({ where: { id: followUpRow.id } }))?.status,
      "OPEN",
      "invalid follow-up must stay open for correction",
    );

    await saveAnswers(followUpIntake.id, {
      weight: "170 lb",
      presenting_problem: "Staff edit made after the client opened the follow-up",
    });
    const validFollowUpRequest = new NextRequest(`http://localhost/api/follow-up/${secureFollowUpToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: { height: "5 ft 8 in", weight: "160 lb" },
        skippedKeys: ["preferred_emergency_facility"],
        attested: true,
      }),
    });
    const validFollowUp = await submitClientFollowUp(validFollowUpRequest, {
      params: { token: secureFollowUpToken },
    });
    assert.equal(validFollowUp.status, 200, "valid follow-up answers must save");
    const savedFollowUpAnswers = await loadAnswers(followUpIntake.id);
    assert.equal(savedFollowUpAnswers.height, "5 ft 8 in");
    assert.equal(savedFollowUpAnswers.weight, "170 lb", "follow-up must not overwrite a newer staff answer");
    assert.equal(
      savedFollowUpAnswers.presenting_problem,
      "Staff edit made after the client opened the follow-up",
      "follow-up must preserve unrelated concurrent staff edits",
    );
    assert.equal(savedFollowUpAnswers.consent_hipaa, undefined, "follow-up must not alter consent");
    const completedFollowUp = await prisma.intakeFollowUp.findUnique({ where: { id: followUpRow.id } });
    assert.equal(completedFollowUp?.status, "COMPLETED");
    assert(completedFollowUp?.completedAt, "completed follow-up needs a completion time");
    assert(completedFollowUp?.attestedAt, "completed follow-up needs client attestation time");
    assert.equal(completedFollowUp?.savedCount, 1);
    assert(completedFollowUp?.attestationJson, "attestation must preserve the exact answer snapshot");
    assert.match(completedFollowUp?.attestationSha256 || "", /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.parse(completedFollowUp?.attestationJson || "{}").answers.height,
      "5 ft 8 in",
    );
    assert.deepEqual(
      JSON.parse(completedFollowUp?.skippedKeys || "[]"),
      ["preferred_emergency_facility"],
    );
    assert.equal(
      (await prisma.intake.findUnique({ where: { id: followUpIntake.id } }))?.status,
      "SIGNED",
      "client follow-up must preserve signed status so the original intake stays closed",
    );
    const originalLinkAfterFollowUp = await getClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`),
      { params: { token: followUpIntake.token } },
    );
    assert.equal(originalLinkAfterFollowUp.status, 409, "follow-up must not reopen the original signed intake");
    const autosaveAfterSubmit = await saveClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { weight: "999 lb" } }),
      }),
      { params: { token: followUpIntake.token } },
    );
    assert.equal(autosaveAfterSubmit.status, 409, "submitted client token must not autosave answers");
    const signatureAfterSubmit = await saveClientSignatureByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { token: followUpIntake.token } },
    );
    assert.equal(signatureAfterSubmit.status, 409, "submitted client token must not replace a signature");
    const uploadAfterSubmit = await uploadClientDocumentByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}/upload`, {
        method: "POST",
      }),
      { params: { token: followUpIntake.token } },
    );
    assert.equal(uploadAfterSubmit.status, 409, "submitted client token must not upload new documents");
    await prisma.intake.update({
      where: { id: followUpIntake.id },
      data: { status: "NEEDS_REVIEW" },
    });
    const originalLinkAfterStaffStatusChange = await getClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`),
      { params: { token: followUpIntake.token } },
    );
    assert.equal(
      originalLinkAfterStaffStatusChange.status,
      409,
      "submitted signature must keep the original client link closed after a staff status change",
    );

    const replayFollowUpRequest = new NextRequest(`http://localhost/api/follow-up/${secureFollowUpToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: { height: "6 ft", weight: "200 lb" },
        attested: true,
      }),
    });
    const replayFollowUp = await submitClientFollowUp(replayFollowUpRequest, {
      params: { token: secureFollowUpToken },
    });
    assert.equal(replayFollowUp.status, 409, "completed follow-up links must reject replay");
    assert.equal((await loadAnswers(followUpIntake.id)).height, "5 ft 8 in", "replay must not overwrite saved answers");
    ok("one-time client follow-up securely merges answers and rejects replay");
  } finally {
    await prisma.auditLog.deleteMany({ where: { intakeId: followUpIntake.id } });
    await prisma.intake.delete({ where: { id: followUpIntake.id } });
    await prisma.client.delete({ where: { id: followUpClient.id } });
  }

  // 3. actual template
  const template = loadTemplateBytes();
  assert(template.length > 400000, "template PDF suspiciously small");
  ok("actual Moore Divine Care packet PDF loads");

  // 4-6. fill Angela's packet
  const client = await prisma.client.findFirst({
    where: { fullName: "Angela Demo" }, include: { intakes: true },
  });
  assert(client?.intakes[0], "Angela Demo not seeded");
  const intake = client!.intakes[0];
  assert(["SIGNED", "COMPLETED"].includes(intake.status), "Angela must be a finished intake for token replay checks");
  const clientRequest = new NextRequest(`http://localhost/api/intake/${intake.token}`);
  const closedGet = await getClientIntakeByToken(clientRequest, { params: { token: intake.token } });
  const closedGetBody = await closedGet.json() as Record<string, unknown>;
  assert.equal(closedGet.status, 409, "finished client links must be closed");
  assert.equal(closedGet.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(closedGetBody.code, "INTAKE_FINISHED");
  assert(!("answers" in closedGetBody), "finished client links must not return saved answers");
  const replaySubmit = await submitClientIntakeByToken(clientRequest, { params: { token: intake.token } });
  assert.equal(replaySubmit.status, 409, "finished client links must reject replayed submission");
  const unchangedIntake = await prisma.intake.findUnique({ where: { id: intake.id }, select: { status: true } });
  assert.equal(unchangedIntake?.status, intake.status, "replayed submission must not downgrade intake status");
  ok("finished client links hide answers and reject replayed submission");

  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  assert(signatures.client?.imageData.startsWith("data:image/png"), "client signature missing");
  const result = await fillPacket({ answers, signatures, consents: consentsFromAnswers(answers) });
  assert(result.filled > 200, `expected >200 filled fields, got ${result.filled}`);
  const texts = await extractPageTexts(result.pdfBytes);
  assert.strictEqual(texts.length, 43, `expected 43 pages, got ${texts.length}`);
  ok(`completed PDF has all 43 pages (${result.filled} fields filled)`);

  const missingHeaderPages = texts
    .map((t, i) => (t.includes("Angela Demo") ? null : i + 1))
    .filter((p): p is number => p !== null);
  assert.deepStrictEqual(missingHeaderPages, [], `client name missing from pages: ${missingHeaderPages}`);
  ok("repeated header (client name) present on every one of the 43 pages");

  assert(texts[3].includes("anxiety and depression"), "presenting problem not on page 4");
  assert(texts[4].includes("anxiety and depression"), "presenting problem not auto-filled on page 5");
  assert(texts[1].includes("Maplewood"), "address not on face sheet");
  assert(texts[16].includes("Angela Demo"), "on-call acknowledgment name missing (p17)");
  assert(texts[37].includes("Angela Demo"), "welcome letter name missing (p38)");
  ok("smart auto-fill places one answer in multiple pages (4, 5, 17, 38)");

  const sigKeys = ["sig_provider_choice", "sig_rights", "sig_hipaa", "sig_ecare", "cca_client_sig"];
  for (const k of sigKeys) {
    assert(!result.skipped.includes(k), `consented signature ${k} was skipped`);
  }
  assert(result.skipped.includes("cca_clinician_sig"), "staff clinician slot should stay blank");
  ok("signatures placed on consented forms; staff signature slots left blank");

  // consent NOT given -> signature withheld
  const noConsent = await fillPacket({
    answers, signatures,
    consents: { ...consentsFromAnswers(answers), consent_transport: false },
  });
  assert(noConsent.skipped.includes("sig_transport_client"), "transport signature should be withheld without consent");
  ok("signature only placed on forms the client agreed to sign");

  // 7. validation
  const missing = missingRequired({ client_full_name: "X" }, false);
  assert(missing.some((m) => m.key === "dob") && missing.some((m) => m.key === "signature"),
    "missingRequired failed to flag items");
  assert.strictEqual(missingRequired(answers, true).length, 0, "Angela should have no missing required");
  assert(percentComplete(answers) > 60, "percent complete unexpectedly low");
  ok("required-field validation + missing checklist");

  // 8. sample PDFs
  for (const f of ["sample-completed-angela-demo.pdf", "sample-completed-jayden-sample.pdf"]) {
    const p = path.join(process.cwd(), "output", f);
    assert(fs.existsSync(p) && fs.statSync(p).size > 300000, `${f} missing - run npm run generate:samples`);
  }
  ok("two sample completed PDFs exist in output/");

  // guardian signing for a minor
  const jayden = await prisma.client.findFirst({ where: { fullName: "Jayden Sample" }, include: { intakes: true } });
  const jAnswers = await loadAnswers(jayden!.intakes[0].id);
  const jSigs = await loadSignatures(jayden!.intakes[0].id);
  const jResult = await fillPacket({ answers: jAnswers, signatures: jSigs, consents: consentsFromAnswers(jAnswers) });
  assert(!jResult.skipped.includes("sig_provider_choice"), "guardian signature should satisfy client slots for a minor");
  assert(!jResult.skipped.includes("cca_guardian_sig"), "guardian CCA signature missing");
  ok("guardian signature flows to required slots for a youth client");

  assert.equal(applyOperationalDefaults({}).severity_of_need, undefined, "unanswered severity of need must stay blank");
  ok("severity of need is not defaulted to Routine");

  const catalog = mappingCatalog();
  assert(catalog.length > 8, "intake catalog should be grouped by section");
  assert(catalog.some((section) => section.entries.some((entry) => entry.key === "client_full_name")));
  assert(catalogEntryByKey("dob")?.mapperType === "date");
  const placed = newCatalogField(catalogEntryByKey("client_full_name")!, 1, 40, 700);
  assert.equal(placed.source, "client_full_name");
  assert(mappedSourceKeys([placed]).has("client_full_name"));
  ok("intake mapping catalog can place answer keys onto a packet");

  const emptyHealth = assessMapping([], 3, 612, 792, 0);
  assert.equal(emptyHealth.ready, false);
  assert(emptyHealth.missingRequired.some((item) => item.key === "client_full_name"));
  assert(emptyHealth.missingRequired.some((item) => item.key === "signature"));
  const namedHealth = assessMapping([
    { ...placed, type: "text" },
    { page: 1, fieldKey: "map_dob", source: "dob", type: "date", x: 180, y: 700, width: 72, height: 12, fontSize: 9, lines: 1, lineHeight: 11.6, required: true, role: "client", consentKey: null, notes: "" },
    { page: 1, fieldKey: "map_record", source: "record_number", type: "text", x: 260, y: 700, width: 90, height: 12, fontSize: 9, lines: 1, lineHeight: 11.6, required: true, role: "staff", consentKey: null, notes: "" },
    { page: 1, fieldKey: "map_date", source: "intake_date", type: "date", x: 360, y: 700, width: 72, height: 12, fontSize: 9, lines: 1, lineHeight: 11.6, required: true, role: "staff", consentKey: null, notes: "" },
    { page: 1, fieldKey: "map_sig", source: "signature", type: "signature", x: 40, y: 80, width: 180, height: 18, fontSize: 9, lines: 1, lineHeight: 11.6, required: true, role: "client", consentKey: null, notes: "" },
  ], 1, 612, 792, 5);
  assert(namedHealth.missingRequired.every((item) => item.key !== "client_full_name" && item.key !== "signature"));
  ok("mapping quality lists missing required fields instead of a score-only badge");

  const approvedOnly = packetDisplayStatus({ mappingStatus: "APPROVED", mappingScore: 72, isActive: false, approvedAt: new Date() });
  assert.equal(approvedOnly.key, "needs_review");
  assert(!/approved/i.test(approvedOnly.label) || approvedOnly.key === "approved_active");
  const live = packetDisplayStatus({ mappingStatus: "APPROVED", mappingScore: 100, isActive: true, approvedAt: new Date() });
  assert.equal(live.key, "approved_active");
  const draft = packetDisplayStatus({ mappingStatus: "DRAFT", mappingScore: null, isActive: false, approvedAt: null });
  assert.equal(draft.key, "draft");
  assert.notEqual(draft.label, live.label);
  ok("packet status is a single badge and never Approved plus Not ready");

  const wellianceWrongFile = packetFilenameWarning(
    "GSO-INTAKE-PACKET-ALIYAH-BALDWIN-BLANK.pdf",
    "Welliance Care",
    ["GSO Behavioral Health", "Essential Wellness Care"],
  );
  assert(wellianceWrongFile, "Welliance/GSO-ALIYAH filename must warn");
  assert(["other_provider", "client_name"].includes(wellianceWrongFile!.code));
  assert.equal(packetFilenameWarning("E.W.C.-INTAKE-FORM.pdf", "Essential Wellness Care Inc."), null);
  assert.equal(packetFilenameWarning("MooreDivineCare_Intake_Packet-1.pdf", "Moore Divine Care, Inc."), null);
  ok("wrong-packet filename guard catches another org or client name");

  const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert(schema.includes('@@unique([providerId, recordNumber], name: "provider_record_number")'));
  ok("provider+recordNumber uniqueness is prepared for SQLite");

  console.log(`\nAll ${passed} checks passed ✓`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // focused NC Tracks eligibility checks (no DB/network) run as part of `npm test`
    await import("./test-eligibility");
  })
  .catch((e) => { console.error("✗ TEST FAILED:", e.message); prisma.$disconnect(); process.exit(1); });
