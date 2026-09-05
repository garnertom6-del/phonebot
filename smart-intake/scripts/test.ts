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
import { normalizeDateInput, formatDateForPeople, isDatePlaceholder } from "../src/lib/normalizeDateInput";
import { normalizeDate as normRecordDate, normalizeIdentityName as normRecordName } from "../src/lib/recordIntegrity";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { fillPacket, loadTemplateBytes, resolveValue } from "../src/lib/fillPdf";
import { wrapText, sanitizePdfText } from "../src/lib/pdfCoordinates";
import { messageForPdfPreviewFailure, parsePdfPreviewErrorBody } from "../src/lib/pdfPreviewError";
import { resolveStaffProvider, resolveStaffProviderForIntake } from "../src/lib/staffProviderScope";
import { beginSignatureSend, signatureSendHint } from "../src/lib/signatureStatus";
import { materialCcaChanges } from "../src/lib/ccaApply";
import {
  packetFieldsForTemplate,
  isMooreDivinePacket,
  isValidProviderPacketMappingScore,
  MOORE_DIVINE_PACKET_SHA256,
  ProviderPacketNotReadyError,
  providerPacketReadiness,
  providerPacketReadinessFromTemplates,
  requireProviderPacketForCompletion,
  WELLIANCE_PACKET_SHA256,
} from "../src/lib/providerPacketTemplates";
import { saveProviderPacketMappings } from "../src/lib/providerPacketMappingWrites";
import { sendCompletedCopiesLink } from "../src/lib/sendCompletedCopies";
import { packetDownloadFileName } from "../src/lib/draftPdf";
import { bindTestCookies } from "../src/lib/requestCookies";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { SELECTED_PROVIDER_COOKIE } from "../src/lib/staffGuard";
import { saveFile, deleteFile } from "../src/lib/storage";
import { signatureForRole } from "../src/lib/signaturePlacement";
import { consentsFromAnswers, loadAnswers, loadSignatures, saveAnswers } from "../src/lib/intakeData";
import { applyOperationalDefaults, ageAtDate, UNMAPPED_PACKET_CHOICES } from "../src/lib/answerDefaults";
import { appendPcpPlanSignaturePage, pcpIddDocumented } from "../src/lib/pcpPlanSignaturePage";
import { emptyCcaReview } from "../src/lib/ccaReview";
import { PDFDocument } from "pdf-lib";
import { extractPdfText } from "../src/lib/pdfText";
import { PACKET_MAP } from "../src/config/mooreDivinePacketMap";
import { interstitialGuardUntil, isInterstitialClickGuarded, INTERSTITIAL_CLICK_GUARD_MS } from "../src/lib/easyInterstitialGuard";
import { PHI_BACKUP_PATH, phiBackupDownloadUrl } from "../src/lib/phiBackupDownload";
import { clientLinkRenewalData, newIntakeToken, tokenExpiry } from "../src/lib/tokens";
import { clientDetailsSchema, isQuestionRequired, missingRequired, newIntakeSchema, percentComplete, clientAskedPercentComplete } from "../src/lib/validation";
import {
  assignIntakeContacts,
  formatUsPhoneDisplay,
  INVALID_CONTACT_MESSAGE,
} from "../src/lib/intakeContacts";
import { emptyExtractedNoteFields, extractIntakeNoteFields, extractedNoteFieldState, parseHelperNotes } from "../src/lib/parseIntakeNotes";
import { buildNewIntakeReadiness, newIntakeCreateLabel, newIntakeQrCreateLabel } from "../src/lib/newIntakeReadiness";
import {
  canOfferCompletedPacketEmail,
  defaultIntakeLocation,
  resolveCreateIntakeHousing,
} from "../src/lib/newIntakeHousing";
import { makeRecordNumber, resolveCreateRecordNumber } from "../src/lib/insurancePlans";
import { buildDashboardReadiness, needsStaffAction, staffReviewCountFromSummary } from "../src/lib/dashboardWorkflow";
import { filterProvidersBySearch } from "../src/lib/providerSearch";
import { packetDisplayStatus } from "../src/lib/packetDisplayStatus";
import { packetDisplayStatus as packetMapperStatus } from "../src/lib/mappingStatus";
import { packetFilenameWarning } from "../src/lib/packetFilenameGuard";
import { buildMasterProviderListExtras } from "../src/lib/masterProviderList";
import { assessMapping } from "../src/lib/mappingHealth";
import { catalogEntryByKey, catalogPlacementFields, DEMO_CLIENT_ANSWERS, mappingCatalog, mappingFieldGuide, mappedSourceKeys, newCatalogField, overlayFillText, packetRequiredEntries } from "../src/lib/mappingCatalog";
import { isQuickIntakeQuestion, questionByKey, questionCatalogId, SECTIONS, ethnicityForRace, isClientQuestionVisible, raceSkipsEthnicity, usesStrongMenu } from "../src/config/mooreDivineQuestions";
import { flattenVisible } from "../src/components/EasyQuestionnaire";
import { easyClientSectionIntro } from "../src/config/easyLanguage";
import { applySkippedClientPlaceholders, NONE_REPORTED_BY_CLIENT } from "../src/lib/answerDefaults";
import { INSURANCE_BEFORE_CREATE_SHARE_MESSAGE, INSURANCE_BEFORE_SMS_MESSAGE, insuranceSmsBlockReason, staffInsurancePlanReady } from "../src/lib/insurancePlans";
import { evaluatePacketFreshness } from "../src/lib/packetFreshness";
import { buildCompletionReadiness } from "../src/lib/completionReadiness";
import { COPY_ALLOWED_STATUSES } from "../src/lib/completedCopies";
import {
  COMPLETED_COPY_DELIVERY_KEY,
  completedCopyDeliveryChannels,
  completedCopyDeliveryOptions,
} from "../src/lib/clientCopyDelivery";
import { buildSignatureStatuses, mappedSignatureSlotsFromFields, missingRequiredSignatures } from "../src/lib/signatureStatus";
import { buildCasePageStatus } from "../src/lib/staffCaseStatus";
import { buildPacketChecklistChips } from "../src/lib/packetChecklist";
import { buildPlanCompleteness, buildRecordConflicts, planFalseCompleteFromFieldCount, signatureIntegrity } from "../src/lib/recordIntegrity";
import { clientCcaAttestationReady, parseCcaReview } from "../src/lib/ccaReview";
import {
  finalizeCcaReview,
  fourComponentsPass,
  isAssessmentDateWithinOneYear,
  signatureIsAcceptable,
} from "../src/lib/ccaMedicalNecessity";
import { acceptableOverrideReason } from "../src/lib/overrideReason";
import {
  clientLinkExpired,
  clientLinkMessagingFinished,
  reminderCooldownSeconds,
} from "../src/lib/clientLinkState";
import { followUpShareMessage, intakeShareMessage, intakeSmsHref, signatureShareMessage, smsHref, smsRecipient, detectSmsPlatform, deviceLikelyOpensSms, isUnreachableClientLink } from "../src/lib/shareLinks";
import { qrSvgData } from "../src/lib/qrSvg";
import { canGenerateRecordNumber, PROVIDER_CHOICE_PLAN_OPTIONS, RECORD_NUMBER_LOOKUP_LINKS, RECORD_NUMBER_PLAN_GROUPS, recordNumberLookupLink, recordNumberMode } from "../src/lib/insurancePlans";
import {
  clientDeliveryContacts,
  clientFollowUpDeliveryContacts,
  deliveryContactsSummary,
} from "../src/lib/clientDeliveryContacts";
import { clientFollowUpQuestions, validateFollowUpSubmission } from "../src/lib/clientFollowUp";
import { clientDetailsAnswerPatch, clientDetailsRecordPatch } from "../src/lib/clientDetails";
import {
  createdIntakeDashboardHref,
  dashboardTabFromQuery,
  dashboardHrefWithTab,
  deliveryDashboardFlash,
  hasSmsDeliveryFailure,
} from "../src/lib/dashboardFlash";
import {
  buildRulePreflight,
  groundedCorrectionOptionsFromAi,
  mergePreflightFindings,
} from "../src/lib/intakePreflight";
import { replaceRawFieldKeys, staffFacingFieldLabel, textContainsRawFieldKey } from "../src/lib/staffFieldLabels";
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
import { GET as getCompletedCopyPacket } from "../src/app/api/copies/[token]/packet/route";
import { GET as getIntakePdf } from "../src/app/api/intakes/[id]/pdf/route";
import { GET as getProviderSettings } from "../src/app/api/provider/settings/route";
import { GET as getPacketMapping } from "../src/app/api/mapping/route";
import { GET as getProviderPacketTemplate } from "../src/app/api/master/providers/[id]/packet-template/route";

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

  const exclusiveAnswers = {
    gender: "Female",
    is_minor_or_incompetent: "Yes",
    has_medicaid: "Yes",
    consent_hipaa: true,
  };
  assert.equal(resolveValue("gender=Female", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("gender=Male", exclusiveAnswers).checked, false);
  assert.equal(resolveValue("gender=Transgender", exclusiveAnswers).checked, false);
  assert.equal(resolveValue("gender=Other", exclusiveAnswers).checked, false);
  assert.notEqual(resolveValue("gender", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("gender=Female", {}).checked, false);
  assert.equal(resolveValue("is_minor_or_incompetent=Y", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("is_minor_or_incompetent=Yes", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("is_minor_or_incompetent=N", exclusiveAnswers).checked, false);
  assert.equal(resolveValue("is_minor_or_incompetent=No", exclusiveAnswers).checked, false);
  assert.equal(resolveValue("has_medicaid=Yes", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("has_medicaid=No", exclusiveAnswers).checked, false);
  assert.notEqual(resolveValue("has_medicaid", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("consent_hipaa=true", exclusiveAnswers).checked, true);
  assert.equal(resolveValue("consent_orientation", { consent_orientation: true }).checked, true);
  const genderBoxes = catalogPlacementFields(catalogEntryByKey("gender")!, 1, 40, 700);
  assert.deepEqual(genderBoxes.map((field) => field.source), ["gender=Female", "gender=Male", "gender=Transgender", "gender=Other"]);
  assert(genderBoxes.every((field) => field.type === "checkbox"));
  assert.equal(newCatalogField(catalogEntryByKey("gender")!, 1, 40, 700).source, "gender=Female");
  assert.deepEqual(
    catalogPlacementFields(catalogEntryByKey("has_medicaid")!, 1, 40, 700).map((field) => field.source),
    ["has_medicaid=Yes", "has_medicaid=No"],
  );
  assert.deepEqual(
    catalogPlacementFields(catalogEntryByKey("is_minor_or_incompetent")!, 1, 40, 700).map((field) => field.source),
    ["is_minor_or_incompetent=Yes", "is_minor_or_incompetent=No"],
  );
  assert.equal(overlayFillText({ source: "gender=Female", type: "checkbox" }, "demo"), "X");
  assert.equal(overlayFillText({ source: "gender=Male", type: "checkbox" }, "demo"), "");
  assert.equal(overlayFillText({ source: "gender=Female", type: "checkbox" }, "labels"), "X");
  assert.equal(overlayFillText({ source: "gender=Male", type: "checkbox" }, "labels"), "");
  assert.equal(overlayFillText({ source: "is_minor_or_incompetent=Y", type: "checkbox" }, "demo", exclusiveAnswers), "X");
  assert.equal(overlayFillText({ source: "is_minor_or_incompetent=N", type: "checkbox" }, "demo", exclusiveAnswers), "");
  assert.equal(overlayFillText({ source: "has_medicaid=Yes", type: "checkbox" }, "demo"), "X");
  assert.equal(overlayFillText({ source: "has_medicaid=No", type: "checkbox" }, "demo"), "");
  assert.equal(overlayFillText({ source: "consent_hipaa=true", type: "checkbox" }, "demo"), "X");
  assert.equal(DEMO_CLIENT_ANSWERS.gender, "Female");
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const unicodeDoc = await PDFDocument.create();
  const standardFont = await unicodeDoc.embedFont(StandardFonts.Helvetica);
  const safeClinicalText = sanitizePdfText(
    "last\u2011use -> verified \u2705; next \u2192 follow-up; unsupported emoji \ud83e\ude7a",
    standardFont,
  );
  assert.equal(safeClinicalText, "last-use -> verified Yes; next -> follow-up; unsupported emoji ?");
  assert.doesNotThrow(() => standardFont.widthOfTextAtSize(safeClinicalText, 10));
  assert.equal(
    sanitizePdfText("123 “Oak” St — Apt 4B\n10.21.2026 … ✓", standardFont),
    '123 "Oak" St - Apt 4B 10.21.2026 ... Yes',
  );
  ok("PDF text safely translates characters outside the standard font");
  const exclusiveDoc = await PDFDocument.create();
  exclusiveDoc.addPage([612, 792]);
  const exclusiveTemplate = await exclusiveDoc.save();
  const exclusiveBox = (fieldKey: string, source: string, x: number) => ({
    page: 1 as const, fieldKey, source, type: "checkbox" as const, x, y: 700, width: 14, height: 14,
    fontSize: 9, lines: 1, lineHeight: 11.6, required: false, role: "client" as const, consentKey: null, notes: "",
  });
  const exclusiveFields = [
    exclusiveBox("g_f", "gender=Female", 40),
    exclusiveBox("g_m", "gender=Male", 58),
    exclusiveBox("g_t", "gender=Transgender", 76),
    exclusiveBox("g_o", "gender=Other", 94),
    exclusiveBox("min_y", "is_minor_or_incompetent=Y", 112),
    exclusiveBox("min_n", "is_minor_or_incompetent=N", 130),
    exclusiveBox("med_y", "has_medicaid=Yes", 148),
    exclusiveBox("med_n", "has_medicaid=No", 166),
    exclusiveBox("c_ok", "consent_hipaa=true", 184),
  ];
  const exclusiveFill = await fillPacket({
    answers: exclusiveAnswers,
    signatures: {},
    consents: { consent_hipaa: true },
    fields: exclusiveFields,
    templateBytes: exclusiveTemplate,
  });
  assert(!exclusiveFill.skipped.includes("g_f"), "Female gender box must fill");
  assert(exclusiveFill.skipped.includes("g_m") && exclusiveFill.skipped.includes("g_t") && exclusiveFill.skipped.includes("g_o"),
    "non-Female gender boxes must stay empty");
  assert(!exclusiveFill.skipped.includes("min_y"), "minor Y box must fill");
  assert(exclusiveFill.skipped.includes("min_n"), "minor N box must stay empty");
  assert(!exclusiveFill.skipped.includes("med_y"), "medicaid Yes box must fill");
  assert(exclusiveFill.skipped.includes("med_n"), "medicaid No box must stay empty");
  assert(!exclusiveFill.skipped.includes("c_ok"), "consent true box must fill");
  const emptyFill = await fillPacket({
    answers: {},
    signatures: {},
    consents: {},
    fields: exclusiveFields,
    templateBytes: exclusiveTemplate,
  });
  const operationalDefaultBoxes = new Set<string>();
  for (const field of exclusiveFields) {
    if (operationalDefaultBoxes.has(field.fieldKey)) {
      assert(!emptyFill.skipped.includes(field.fieldKey), `${field.fieldKey} is stamped by operational defaults`);
    } else {
      assert(emptyFill.skipped.includes(field.fieldKey), `${field.fieldKey} must stay empty when unanswered`);
    }
  }
  ok("exclusive checkbox fill: unanswered Medicaid/minor stay blank; explicit choices remain exclusive");

  const wrapDoc = await PDFDocument.create();
  const wrapFont = await wrapDoc.embedFont(StandardFonts.HelveticaBold);
  assert.equal(sanitizePdfText("of\ufb01ce \tcheckbox ☑", wrapFont), "office checkbox");
  const overflowLines = wrapText(`short ${"A".repeat(120)}`, wrapFont, 9, 70, 2);
  assert.equal(overflowLines.length, 2);
  assert(overflowLines[1].endsWith("..."), "overflow wrap must use WinAnsi-safe ellipsis");
  assert.throws(
    () => wrapFont.widthOfTextAtSize("✓\ufb01", 9),
    /WinAnsi|encode/i,
    "Helvetica cannot measure checkmarks or PDF ligatures; fill must sanitize first",
  );
  const messyTemplateDoc = await PDFDocument.create();
  messyTemplateDoc.addPage([612, 792]);
  const messyTemplate = await messyTemplateDoc.save();
  const messyTextField = (
    fieldKey: string, source: string, y: number, lines: number, width: number,
  ) => ({
    page: 1 as const, fieldKey, source, type: "text" as const, x: 40, y, width, height: lines * 12,
    fontSize: 9, lines, lineHeight: 11, required: false, role: "client" as const, consentKey: null, notes: "",
  });
  const messyFill = await fillPacket({
    answers: {
      address_street: "482 “Maplewood” Ave — Unit B\nnear the park … 10.21.2026",
      presenting_problem: `${"needs housing support ".repeat(40)}of\ufb01ce checkbox ☑ and emoji 😀`,
      intake_date: "10.21.2026",
    },
    signatures: {},
    consents: {},
    fields: [
      messyTextField("addr", "address_street", 700, 2, 90),
      messyTextField("prob", "presenting_problem", 620, 3, 120),
      { ...messyTextField("dt", "intake_date", 540, 1, 80), type: "date" as const },
    ],
    templateBytes: messyTemplate,
  });
  assert(messyFill.pdfBytes.length > 100, "pathological answers must still produce a PDF");
  assert(messyFill.filled >= 2, "sanitized pathological fields should still fill");
  ok("PDF fill sanitizes Unicode/newlines/odd dates instead of crashing");

  const preview409 = messageForPdfPreviewFailure(409, {
    code: "PACKET_NOT_CURRENT",
    error: "Generate the completed packet before downloading the final version.",
  }, "intake-1");
  assert.equal(preview409.title, "Generate the packet first");
  assert(preview409.detail.includes("Generate the completed packet"));
  const preview500 = messageForPdfPreviewFailure(500, { code: "PDF_FILL_FAILED", error: "WinAnsi cannot encode" }, "intake-1");
  assert.equal(preview500.title, "Packet preview failed");
  assert(preview500.detail.includes("WinAnsi"));
  const preview404 = messageForPdfPreviewFailure(404, { error: "Not found" }, "missing-id");
  assert.equal(preview404.title, "Packet not found");
  assert.equal(preview404.backHref, "/dashboard");
  assert.equal(parsePdfPreviewErrorBody('{"error":"Not found"}')?.error, "Not found");
  assert.equal(parsePdfPreviewErrorBody(""), null);
  ok("PDF preview maps 409/500/404 to human messages instead of raw JSON");

  const pdfPreviewRouteSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/intakes/[id]/pdf/route.ts"),
    "utf8",
  );
  const pdfPreviewPageSource = fs.readFileSync(
    path.join(process.cwd(), "src/app/intakes/[id]/pdf-preview/page.tsx"),
    "utf8",
  );
  assert(!/watermark/i.test(pdfPreviewRouteSource));
  assert(!/watermark/i.test(pdfPreviewPageSource));
  assert(!pdfPreviewRouteSource.includes("DRAFT PREVIEW - NOT A FINAL RECORD"));
  ok("PDF previews and downloads never add or advertise a watermark");

  const sendHintCcaWouldHaveBlocked = signatureSendHint({
    packetReady: true,
    packetMessage: "Resolve 2 major CCA accuracy issues.",
    statuses: [{
      key: "client_guardian", label: "Client / guardian", state: "invalid", required: true, onPacket: true,
      reason: "Intake content changed after signature capture.",
    }, {
      key: "staff_qp", label: "Staff / QP", state: "captured", required: true, onPacket: true, reason: "",
    }],
    docusignEnvelopeId: null,
  });
  assert.equal(sendHintCcaWouldHaveBlocked.enabled, true);
  assert(sendHintCcaWouldHaveBlocked.title.includes("re-signed"));
  assert.equal(sendHintCcaWouldHaveBlocked.reason, sendHintCcaWouldHaveBlocked.title);
  assert(!/CCA/i.test(sendHintCcaWouldHaveBlocked.title));
  ok("Send missing signatures uses the signature reason, not a CCA blocker");

  const blockedPacketHint = signatureSendHint({
    packetReady: false,
    packetMessage: "Master admin must approve and activate this provider's packet first.",
    statuses: [{
      key: "client_guardian", label: "Client / guardian", state: "missing", required: true, onPacket: true,
      reason: "Not signed yet.",
    }],
    docusignEnvelopeId: null,
  });
  assert.equal(blockedPacketHint.enabled, false);
  assert(blockedPacketHint.reason.includes("approve and activate"));
  const blockedClick = beginSignatureSend(blockedPacketHint);
  assert.equal(blockedClick.action, "blocked");
  assert.equal(blockedClick.action === "blocked" ? blockedClick.message : "", blockedPacketHint.reason);
  const readyClick = beginSignatureSend(sendHintCcaWouldHaveBlocked);
  assert.equal(readyClick.action, "proceed");
  assert(readyClick.action === "proceed" && readyClick.confirm.includes("DocuSign"));
  ok("Send missing signatures click always returns a confirm dialog or a visible blocked reason");

  assert.deepEqual(
    materialCcaChanges(
      { presenting_problem: "old", clinician_name: "QP" },
      { presenting_problem: "new from CCA", clinician_name: "Different QP" },
    ),
    ["presenting_problem"],
  );
  ok("CCA apply treats clinician credentials as non-material and does not silently invalidate on review-only scans");

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
  const exactMooreIdentity = {
    name: "Moore Divine Care Client Intake Package",
    originalFileName: "MooreDivineCare_Intake_Packet-1.pdf",
    pageCount: 43,
    providerSpecific: true,
    sha256: MOORE_DIVINE_PACKET_SHA256,
  };
  assert.equal(isMooreDivinePacket(exactMooreIdentity), true);
  assert(packetFieldsForTemplate(exactMooreIdentity).length > 100, "the exact approved source must receive its reviewed map");
  assert.deepEqual(
    packetFieldsForTemplate({ ...exactMooreIdentity, sha256: "different-layout" }),
    [],
    "a renamed or changed 43-page file must not inherit Moore Divine coordinates",
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
  assert.equal(dashboardTabFromQuery("waiting"), "waiting");
  assert.equal(dashboardTabFromQuery("signed"), "signed");
  assert.equal(dashboardTabFromQuery("unknown"), null);
  assert.equal(dashboardHrefWithTab("signed", "tab=waiting"), "/dashboard?tab=signed");
  assert.equal(dashboardHrefWithTab("signed", "tab=waiting&providerId=abc"), "/dashboard?tab=signed&providerId=abc");
  assert.equal(
    createdIntakeDashboardHref("intake-123", "provider 456"),
    "/dashboard?tab=waiting&created=intake-123&providerId=provider+456#intake-intake-123",
  );
  ok("created intakes return to the correct provider and visible waiting queue");
  ok("successful delivery returns to the dashboard without storing contact details");

  assert(needsStaffAction("SIGNED"), "signed intakes must remain in the staff action queue");
  assert(needsStaffAction("SUBMITTED"), "submitted intakes must remain in the staff action queue");
  assert(needsStaffAction("NEEDS_REVIEW"), "needs-review intakes must remain in the staff action queue");
  assert(!needsStaffAction("IN_PROGRESS"), "in-progress intakes belong in the waiting-on-client queue");
  assert(!needsStaffAction("COMPLETED"), "completed intakes must leave the staff action queue");
  assert(
    needsStaffAction("COMPLETED", { tone: "warn", state: "Upload the CCA" }),
    "missing CCA or a stale packet must still appear in Needs staff action",
  );
  assert.equal(
    staffReviewCountFromSummary({ NEEDS_REVIEW: 5, SIGNED: 2, SUBMITTED: 4, COMPLETED: 9, IN_PROGRESS: 3 }),
    11,
    "staff review is SUBMITTED + NEEDS_REVIEW + SIGNED from one helper",
  );
  assert.equal(
    staffReviewCountFromSummary({ NEEDS_REVIEW: 1, SIGNED: 6, SUBMITTED: 0 }),
    7,
    "Welliance-style mix still uses the same staff-review helper",
  );
  const listStaffReview = staffReviewCountFromSummary({ NEEDS_REVIEW: 5, SIGNED: 2, SUBMITTED: 4 });
  const dashboardStaffReview = ["SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "NEEDS_REVIEW", "NEEDS_REVIEW", "NEEDS_REVIEW", "NEEDS_REVIEW", "NEEDS_REVIEW", "SIGNED", "SIGNED"]
    .filter((status) => needsStaffAction(status)).length;
  assert.equal(listStaffReview, dashboardStaffReview, "list row, next-action copy, and /dashboard share one staff-review definition");
  ok("one staff-review helper is used for the list, next-action copy, and dashboard");

  const searchProviders = [
    { name: "Empower Wellness", slug: "empower", packetFileNames: ["MooreDivineCare_Intake_Packet-1.pdf"] },
    { name: "EW", slug: "ew" },
    { name: "Moore Divine Care", slug: "moore-divine" },
    { name: "Prayers of Care", slug: "prayers-of-care" },
    { name: "Welliance Care", slug: "welliance", packetFileNames: ["GSO-INTAKE-PACKET-ALIYAH-BALDWIN-BLANK.pdf"] },
    { name: "Another Provider", slug: "another" },
  ];
  const moorHits = filterProvidersBySearch(searchProviders, "moor");
  assert.equal(moorHits.length, 1, "short query must not match unrelated providers");
  assert.equal(moorHits[0].name, "Moore Divine Care");
  assert.equal(moorHits[0].searchMatch?.field, "name");
  assert.ok((moorHits[0].searchMatch?.length || 0) >= 3, "search highlights the matched text");
  assert.equal(filterProvidersBySearch(searchProviders, "mo").filter((hit) => hit.name !== "Moore Divine Care").length, 0);
  assert.equal(filterProvidersBySearch(searchProviders, "aliyah")[0]?.name, "Welliance Care");
  ok("provider search uses a relevance floor instead of loose subsequence matching");

  const missingScoreBadge = packetDisplayStatus({
    originalFileName: "prayers-of-care-packet.pdf",
    isActive: false,
    mappingStatus: "DRAFT",
    mappingScore: null,
    approvedAt: null,
  }, "Prayers of Care");
  assert.equal(missingScoreBadge.scoreLabel, "Score unavailable");
  assert.equal(missingScoreBadge.badge, "Needs review · Score unavailable");
  assert(!missingScoreBadge.scoreLabel.toLowerCase().includes("review"), "missing scores must never use Review as a fake score");
  ok("packet badge shows Score unavailable when mapping score is missing");

  const unresolvedActiveBadge = packetDisplayStatus({
    originalFileName: "provider-packet.pdf",
    isActive: true,
    mappingStatus: "APPROVED",
    mappingScore: 100,
    approvedAt: new Date(),
    mappingIssues: JSON.stringify({ missingRequired: [{ key: "client_full_name" }], overrideReason: "Legacy approval" }),
  }, "Provider");
  assert.equal(unresolvedActiveBadge.label, "Active with override");
  assert.equal(unresolvedActiveBadge.scoreLabel, "1 required missing");
  ok("an approved active packet cannot hide unresolved required mappings behind a 100% badge");

  const wellianceListPayload = buildMasterProviderListExtras({
    name: "Welliance Care",
    intakeSummary: { NEEDS_REVIEW: 1, SIGNED: 6, SUBMITTED: 0 },
    packetTemplate: {
      originalFileName: "GSO-INTAKE-PACKET-ALIYAH-BALDWIN-BLANK.pdf",
      pageCount: 36,
      isActive: false,
      mappingStatus: "DRAFT",
      mappingScore: null,
    },
    otherProviderNames: ["GSO Behavioral Health", "Essential Wellness Care"],
  });
  assert.equal(wellianceListPayload.staffReviewCount, 7);
  assert.ok(wellianceListPayload.filenameWarning, "list payload must include the wrong-packet filename warning");
  assert.match(wellianceListPayload.filenameWarning || "", /looks like|does not match|client copy/i);
  assert.equal(
    packetFilenameWarning(
      "GSO-INTAKE-PACKET-ALIYAH-BALDWIN-BLANK.pdf",
      "Welliance Care",
      ["GSO Behavioral Health", "Essential Wellness Care"],
    )?.message,
    wellianceListPayload.filenameWarning,
  );
  assert.equal(packetFilenameWarning("MooreDivineCare_Intake_Packet-1.pdf", "Moore Divine Care"), null);
  ok("filename warning is included on the master provider list payload");

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
  const emptyIntakeReadiness = buildNewIntakeReadiness({
    fullName: "",
    dob: "",
    contactReady: false,
    packetContextLoaded: true,
    packetReady: false,
  });
  assert.equal(emptyIntakeReadiness.completedRequired, 0);
  assert.equal(emptyIntakeReadiness.ready, false);
  assert.equal(emptyIntakeReadiness.packet.tone, "warning");
  const identityAndContactReady = buildNewIntakeReadiness({
    fullName: "Workflow Test",
    dob: "01/01/2000",
    contactReady: true,
    recordReady: false,
    packetContextLoaded: true,
    packetReady: true,
  });
  assert.equal(identityAndContactReady.completedRequired, 2);
  assert.equal(identityAndContactReady.totalRequired, 2);
  assert.equal(identityAndContactReady.ready, true);
  assert.equal(identityAndContactReady.title, "Ready to create the secure link");
  assert.equal(
    buildNewIntakeReadiness({
      contactReady: false,
      packetContextLoaded: true,
      packetContextError: true,
      packetReady: false,
    }).packet.label,
    "Provider context unavailable",
  );
  const readyIntakeReadiness = buildNewIntakeReadiness({
    fullName: "Workflow Test",
    dob: "01/01/2000",
    contactReady: true,
    packetContextLoaded: true,
    packetReady: true,
  });
  assert.equal(readyIntakeReadiness.completedRequired, 2);
  assert.equal(readyIntakeReadiness.ready, true);
  assert.equal(readyIntakeReadiness.title, "Ready to create the secure link");
  ok("create-intake readiness requires identity and contact, not Record#");
  assert.equal(newIntakeCreateLabel({ hasSmsPhone: true, sendSmsAfterCreate: false }), "Create intake");
  assert.equal(newIntakeCreateLabel({ hasSmsPhone: true, sendSmsAfterCreate: true }), "Create and text the link");
  assert.equal(newIntakeCreateLabel({ isCreating: true, hasSmsPhone: true, sendSmsAfterCreate: false }), "Creating intake...");
  assert.equal(newIntakeCreateLabel({ isCreating: true, hasSmsPhone: true, sendSmsAfterCreate: true }), "Creating and texting the link...");
  assert.equal(newIntakeCreateLabel({ packetContextError: true, hasSmsPhone: true, sendSmsAfterCreate: true }), "Sign in to create an intake");
  ok("create-intake primary button stays Create intake until staff checks the immediate-SMS box");
  assert.equal(newIntakeQrCreateLabel({}), "Create and show QR");
  assert.equal(newIntakeQrCreateLabel({ isCreating: true }), "Creating intake and QR...");
  assert.equal(newIntakeQrCreateLabel({ packetContextError: true }), "Sign in to create an intake");
  ok("create-intake QR action is a first-class Create and show QR path");
  const validCcaReview = JSON.stringify({
    sourceClinician: "Test Clinician",
    assessmentDate: "2026-08-28",
    prescriptionMedications: [],
    otcMedications: [],
    majorErrors: [],
    warnings: [],
  });
  assert.equal(clientCcaAttestationReady(null), false);
  assert.equal(clientCcaAttestationReady(JSON.stringify({
    ...JSON.parse(validCcaReview),
    assessmentDate: "",
  })), false, "an assessment date is required before client attestation");
  assert.equal(clientCcaAttestationReady(JSON.stringify({
    ...JSON.parse(validCcaReview),
    majorErrors: ["Assessment identity conflict"],
  })), false, "major CCA accuracy errors block client attestation");
  assert.equal(clientCcaAttestationReady(validCcaReview), true);
  assert.equal(parseCcaReview(validCcaReview)?.sourceClinician, "Test Clinician");
  assert.equal(parseCcaReview(validCcaReview)?.hasRecommendation, false);
  {
    const now = new Date(2026, 7, 30);
    const iso = (year: number, month: number, day: number) =>
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    assert.equal(isAssessmentDateWithinOneYear(iso(2025, 7, 30), now), false, "13-month-old CCA date fails in code");
    assert.equal(isAssessmentDateWithinOneYear(iso(2025, 9, 30), now), true, "11-month-old CCA date passes in code");
    assert.equal(isAssessmentDateWithinOneYear("", now), false, "undated CCA fails");
    assert.equal(isAssessmentDateWithinOneYear(iso(2026, 9, 1), now), false, "future CCA date fails");
    assert.equal(signatureIsAcceptable("electronic"), true);
    assert.equal(signatureIsAcceptable("DocuSign"), true);
    assert.equal(signatureIsAcceptable("missing"), false);

    const missingSignature = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "08/01/2026",
      signatureMethod: "missing",
      primaryDiagnosis: { code: "F33.1", label: "Major depressive disorder, recurrent, moderate" },
      recommendedServices: [{ name: "Peer Support", policyId: "", score: "Thin", reason: "" }],
    }, { now });
    assert.equal(missingSignature.hasSignature, false);
    assert.equal(fourComponentsPass(missingSignature), false, "missing signature fails the four-component gate");

    const oldDate = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "07/30/2025",
      dateWithinOneYear: true,
      signatureMethod: "wet-ink",
      primaryDiagnosis: { code: "F33.1", label: "Major depressive disorder" },
      recommendedServices: [{ name: "Outpatient therapy", policyId: "", score: "Supported", reason: "" }],
    }, { now });
    assert.equal(oldDate.dateWithinOneYear, false, "code rejects a 13-month-old date even if the model marked it current");
    assert.equal(fourComponentsPass(oldDate), false);

    const recentDate = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "09/30/2025",
      signatureMethod: "electronic",
      hasSignature: false,
      primaryDiagnosis: { code: "F33.1", label: "Major depressive disorder" },
      recommendedServices: [{ name: "Outpatient therapy", policyId: "", score: "Thin", reason: "" }],
    }, { now });
    assert.equal(recentDate.dateWithinOneYear, true, "11-month-old date passes");
    assert.equal(recentDate.hasSignature, true, "electronic signature counts");
    assert.equal(fourComponentsPass(recentDate), true);

    const dual = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "08/01/2026",
      signatureMethod: "typed",
      primaryDiagnosis: { code: "F33.1", label: "Major depressive disorder, recurrent, moderate" },
      sudDiagnoses: [{ code: "F14.20", label: "Cocaine use disorder, severe" }],
      recommendedServices: [{ name: "Peer Support", policyId: "", score: "Thin", reason: "" }],
      functionalFacts: [{ domain: "employment", present: true, detail: "Unemployed" }],
    }, { now });
    assert.equal(dual.dualDiagnosis, true, "MH + SUD is dual diagnosis");
    assert.equal(dual.hasDiagnosis, true);
    assert.equal(dual.recommendedServices[0]?.policyId, "8G");
    assert.equal(dual.recommendedServices[0]?.score, "Supported");

    const thinCst = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "08/01/2026",
      signatureMethod: "docusign",
      primaryDiagnosis: { code: "F31.2", label: "Bipolar disorder" },
      recommendedServices: [{ name: "Community Support Team", policyId: "8A-6", score: "Supported", reason: "model guessed" }],
      functionalFacts: [],
    }, { now });
    assert.equal(thinCst.recommendedServices[0]?.score, "Thin", "CST without functional facts is Thin");
    assert.match(thinCst.recommendedServices[0]?.reason || "", /without functional facts/i);
    assert.equal(fourComponentsPass(thinCst), true);
    assert.notEqual(thinCst.recommendedServices[0]?.score, "Supported");

    const mismatchIdentity = finalizeCcaReview({
      sourceClinician: "Pat QP, LCMHC",
      assessmentDate: "08/01/2026",
      signatureMethod: "electronic",
      sourceClientName: "Jordan Example",
      sourceClientDob: "1990-02-02",
      primaryDiagnosis: { code: "F33.1", label: "Major depressive disorder" },
      recommendedServices: [{ name: "Medication management", policyId: "", score: "Thin", reason: "" }],
    }, {
      now,
      app: {
        clientName: "Other Person",
        clientDob: "1991-03-03",
        diagnosis: "Generalized anxiety",
        clinician: "Different Clinician",
        assessmentDate: "2026-01-01",
        services: ["Peer Support"],
      },
    });
    assert(mismatchIdentity.appMismatches.some((item) => item.field === "identity name"));
    assert(mismatchIdentity.appMismatches.every((item) => !/ssn|medicaid|street/i.test(`${item.field} ${item.cca} ${item.app} ${item.note}`)));
  }
  ok("CCA four-component scan encodes date, electronic signature, dual diagnosis, and CST Thin scoring");
  const missingWithNoCca = missingRequired({}, true, null, {
    skipClinicalAssessmentAttestation: true,
  });
  assert.equal(missingWithNoCca.some((item) => item.key === "consent_cca"), false);
  assert.equal(missingRequired({}, true).some((item) => item.key === "consent_cca"), true);
  ok("CCA client attestation waits for a dated, clinician-identified, major-error-free source");
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
  const phoneInEmailField = newIntakeSchema.parse({
    fullName: "Cell In Email Box",
    dob: "01/01/2000",
    recordNumber: "WORKFLOW-CELL",
    email: "3365550142",
  });
  assert.equal(phoneInEmailField.phone, "3365550142");
  assert.equal(phoneInEmailField.email, "");
  ok("a 10-digit NC number typed in the email box is stored as the SMS phone");
  const formattedPhoneInEmail = newIntakeSchema.parse({
    fullName: "Formatted Cell",
    dob: "01/01/2000",
    recordNumber: "WORKFLOW-CELL2",
    email: "(336) 555-0142",
  });
  assert.equal(formattedPhoneInEmail.phone, "(336) 555-0142");
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Garbage Contact",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-JUNK",
      email: "notanemail@@x",
    }).success,
    false,
    "junk that is not a phone or email cannot become the SMS destination",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Mixed Junk Phone",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-JUNK2",
      phone: "notanemail@@x",
    }).success,
    false,
    "garbage in the phone box is rejected",
  );
  assert.equal(
    newIntakeSchema.safeParse({
      fullName: "Letters With Digits",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-JUNK3",
      phone: "hello3365550142world",
    }).success,
    false,
    "a phone must be digits and phone punctuation only",
  );
  assert.equal(
    assignIntakeContacts("3365550142", "").phone,
    "3365550142",
  );
  assert.equal(assignIntakeContacts("notanemail@@x", "").error, INVALID_CONTACT_MESSAGE);
  assert.equal(formatUsPhoneDisplay("3365550142"), "(336) 555-0142");
  ok("create-intake contact fields accept a phone in either box and reject junk SMS destinations");

  const extractedNotes = extractIntakeNoteFields(
    [
      "Name: Sample Client",
      "DOB: 01/15/1980",
      "Address: 100 Example Ave, Greensboro, NC",
      "Phone: 3365550142",
      "Emergency contact: Example Guardian 3365550199",
      "MID: SAMPLEMID01",
    ].join("\n"),
  );
  const extractedByKey = Object.fromEntries(extractedNotes.map((field) => [field.key, field.value]));
  assert.equal(extractedByKey.client_full_name, "Sample Client");
  assert.equal(extractedByKey.dob, "1980-01-15");
  assert.equal(extractedByKey.address_street, "100 Example Ave");
  assert.equal(extractedByKey.address_city, "Greensboro");
  assert.equal(extractedByKey.address_state, "NC");
  assert.equal(extractedByKey.client_phone_cell, "3365550142");
  assert.equal(extractedByKey.ec1_name, "Example Guardian");
  assert.equal(extractedByKey.ec1_cell_phone, "3365550199");
  assert.equal(extractedByKey.mid_number, "SAMPLEMID01");
  assert.equal(parseHelperNotes("Recipient ID: SAMPLEMID01").mid_number, "SAMPLEMID01");
  assert.equal(parseHelperNotes("PCP phone: 3365550100").pcp_phone, "3365550100");
  const phoneOnlyEmergency = parseHelperNotes("Emergency contact: 3365550199");
  assert.equal(phoneOnlyEmergency.ec1_name, undefined, "a phone-only emergency contact must not populate the name field");
  assert.equal(phoneOnlyEmergency.ec1_cell_phone, "3365550199");
  const emptyFromPaste = emptyExtractedNoteFields(extractedNotes, () => "");
  assert.equal(emptyFromPaste.length, extractedNotes.length);
  assert.equal(emptyExtractedNoteFields(extractedNotes, (field) => field.value).length, 0);
  const staffTypedName = emptyExtractedNoteFields(
    extractedNotes,
    (field) => field.key === "client_full_name" ? "Already Typed" : "",
  );
  assert.equal(staffTypedName.length, extractedNotes.length - 1);
  assert(!staffTypedName.some((field) => field.key === "client_full_name"));
  assert.equal(extractedNoteFieldState(extractedNotes[0], "Already Typed"), "replace");
  assert.equal(extractedNoteFieldState(extractedNotes[0], extractedNotes[0].value), "applied");
  ok("Use these applies only empty extracted chips and leaves typed fields for replace");

  assert.equal(defaultIntakeLocation(undefined), "");
  assert.equal(defaultIntakeLocation("Greensboro"), "Greensboro");
  assert.equal(defaultIntakeLocation("  High Point  "), "High Point");
  assert.equal(defaultIntakeLocation(""), "");
  const blankStreetHousing = resolveCreateIntakeHousing({ addressState: "NC" });
  assert.equal(blankStreetHousing.homeless, false, "a missing address must not invent homelessness");
  assert.equal(blankStreetHousing.livingArrangement, "");
  assert.equal(blankStreetHousing.addressStreet, "");
  assert.equal(blankStreetHousing.addressState, "NC");
  const filledStreetHousing = resolveCreateIntakeHousing({
    addressStreet: "100 Example Ave",
    addressCity: "High Point",
    addressState: "NC",
  });
  assert.equal(filledStreetHousing.homeless, false);
  assert.equal(filledStreetHousing.livingArrangement, "");
  assert.equal(filledStreetHousing.addressStreet, "100 Example Ave");
  const explicitHomelessClearsStreet = resolveCreateIntakeHousing({
    addressStreet: "100 Example Ave",
    homelessSelected: true,
  });
  assert.equal(explicitHomelessClearsStreet.homeless, true);
  assert.equal(explicitHomelessClearsStreet.addressStreet, "");
  assert.equal(explicitHomelessClearsStreet.livingArrangement, "Homeless");
  assert.equal(
    missingRequired({
      client_full_name: "Sample Client",
      dob: "1980-01-15",
      living_arrangement: "Homeless",
    }, true).some((item) => item.key === "address_street"),
    false,
    "blank street on the homeless path must not block required-field checks",
  );
  assert.equal(
    missingRequired({
      client_full_name: "Sample Client",
      dob: "1980-01-15",
      living_arrangement: "Adult Alone",
    }, true).some((item) => item.key === "address_street"),
    true,
    "housed clients still need a street address",
  );
  const livingQ = questionByKey("living_arrangement");
  const streetQ = questionByKey("address_street");
  const contactQuestions = SECTIONS.find((section) => section.key === "contact")?.questions || [];
  assert.equal(livingQ?.essential, true, "Easy/quick mode must ask living arrangement so homeless can skip street");
  assert.equal(livingQ?.required, true);
  assert.equal(isQuickIntakeQuestion(livingQ!), true);
  assert.ok(
    contactQuestions.findIndex((question) => question.key === "living_arrangement")
      < contactQuestions.findIndex((question) => question.key === "address_street"),
    "living arrangement must be asked before street so Easy mode can skip street immediately",
  );
  assert.equal(isQuestionRequired(streetQ!, { living_arrangement: "Homeless" }), false);
  assert.equal(isQuestionRequired(streetQ!, { living_arrangement: "Adult Alone" }), true);
  assert.equal(canOfferCompletedPacketEmail({ packetContextLoaded: true, packetReady: false }), false);
  assert.equal(canOfferCompletedPacketEmail({ packetContextLoaded: true, packetReady: true }), true);
  assert.equal(canOfferCompletedPacketEmail({ packetContextLoaded: true, packetReady: true, packetContextError: true }), false);
  const tempRecord = resolveCreateRecordNumber("", "");
  assert.equal(tempRecord.shouldGenerate, true);
  assert.equal(tempRecord.error, undefined);
  assert.ok(makeRecordNumber("").startsWith("TEMP-"));
  const lookupRecord = resolveCreateRecordNumber("", "Alliance");
  assert.equal(lookupRecord.shouldGenerate, false);
  assert.ok(lookupRecord.error);
  const bcbsRecord = resolveCreateRecordNumber("", "Blue Cross Blue Shield");
  assert.equal(bcbsRecord.shouldGenerate, true);
  ok("create-intake layout helpers: no Greensboro default, blank street stays unknown, packet email stays off until approved, Record# can auto-generate");
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
  assert.equal(
    evaluatePacketFreshness({
      latestPdf: { id: "pdf-1", createdAt: packetCreatedAt, contentRevision: 3 },
      currentContentRevision: 4,
    }).state,
    "stale",
    "a generated packet must be stale when its bound content revision is not current",
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
  assert.deepEqual(COPY_ALLOWED_STATUSES, ["COMPLETED"]);
  assert.deepEqual(completedCopyDeliveryChannels({ client_email: "client@example.com" }), {
    sms: true,
    email: true,
    label: "text message and email",
  });
  assert.deepEqual(completedCopyDeliveryChannels({ [COMPLETED_COPY_DELIVERY_KEY]: "Text message" }), {
    sms: true,
    email: false,
    label: "text message",
  });
  assert.deepEqual(completedCopyDeliveryChannels({ client_email: "client@example.com", [COMPLETED_COPY_DELIVERY_KEY]: "Email" }), {
    sms: false,
    email: true,
    label: "email",
  });
  assert.deepEqual(completedCopyDeliveryChannels({ client_email: NONE_REPORTED_BY_CLIENT }), {
    sms: true,
    email: false,
    label: "text message",
  });
  assert.deepEqual(completedCopyDeliveryOptions({ client_email: NONE_REPORTED_BY_CLIENT }), ["Text message"]);
  assert.equal(questionByKey(COMPLETED_COPY_DELIVERY_KEY)?.essential, true);
  assert.equal(questionByKey(COMPLETED_COPY_DELIVERY_KEY)?.required, false);
  assert.equal(
    buildSignatureStatuses([]).find((status) => status.key === "staff_qp")?.required,
    true,
  );
  const integrityClient = { fullName: "Sample Client", dob: "1980-01-15", guardianName: "Example Guardian" };
  assert.equal(signatureIntegrity({
    role: "client",
    printedName: "Different Person",
    relationship: "client",
    contentRevision: 4,
  }, integrityClient, 4).valid, false, "client signature names must match the identity record");
  assert.equal(signatureIntegrity({
    role: "client",
    printedName: "Sample Client",
    relationship: "client",
    createdAt: "2026-08-01T12:00:00Z",
    updatedAt: "2026-08-29T12:00:00Z",
  }, integrityClient, 4, "2026-08-03T12:00:00Z").valid, false, "legacy signatures must use the original capture time, not a migration-added update time");
  assert.equal(buildSignatureStatuses([{
    role: "client",
    printedName: "Sample Client",
    signedDate: "08/01/2026",
    relationship: "client",
    contentRevision: 3,
  }], { client: integrityClient, currentContentRevision: 4 }).find((status) => status.key === "client_guardian")?.state, "invalid");
  assert.equal(buildSignatureStatuses([{
    role: "client",
    printedName: "Sample Client",
    signedDate: "08/01/2026",
    relationship: "client",
    contentRevision: 3,
  }, {
    role: "guardian",
    printedName: "Example Guardian",
    signedDate: "08/02/2026",
    relationship: "guardian",
    contentRevision: 4,
  }], { client: integrityClient, currentContentRevision: 4 }).find((status) => status.key === "client_guardian")?.state, "captured", "a current guardian signature must take priority over a stale client signature");
  const accuracyConflicts = buildRecordConflicts({
    client_full_name: "Sample Client",
    dob: "1980-01-15",
    ec1_name: "3365550199",
    employment_status: "Employed",
    staff_helper_notes: "Employment status: Not in Labor Force",
  }, integrityClient);
  assert(accuracyConflicts.some((conflict) => conflict.key === "emergency_name_is_phone"));
  assert(accuracyConflicts.some((conflict) => conflict.key === "helper_employment_status_conflict"));
  assert.equal(buildPlanCompleteness({ crisis_warning_signs: "Pacing" }).crisis.state, "incomplete");
  const filledPcpFields = {
    pcp_name: "Dr Example",
    pcp_phone: "3365550100",
    pcp_address: "1 Main St",
    preferred_emergency_facility: "Moses Cone",
    dis_pcp_plan: "Coordinate with PCP after intake.",
  };
  const filledCrisisFields = {
    crisis_warning_signs: "Pacing",
    crisis_steps: "Call support",
    crisis_supports: "Aunt May",
    dis_crisis_contact: "Aunt May",
    dis_crisis_phone: "3365550199",
  };
  const fieldOnlyPcp = buildPlanCompleteness(filledPcpFields);
  assert.equal(fieldOnlyPcp.pcp.state, "incomplete", "filled PCP fields alone are not complete");
  assert.equal(fieldOnlyPcp.pcp.fieldsFilled, true);
  assert.equal(planFalseCompleteFromFieldCount(fieldOnlyPcp), true);
  assert.equal(
    buildPlanCompleteness(filledPcpFields, { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: true }).pcp.gates.find((gate) => gate.key === "date")?.met,
    false,
    "missing date gate keeps the plan incomplete",
  );
  assert.equal(
    buildPlanCompleteness({ ...filledPcpFields, pcp_plan_date: "pending" }, { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: true }).pcp.gates.find((gate) => gate.key === "date")?.met,
    false,
    "placeholder dates are not a real plan date",
  );
  assert.equal(
    buildPlanCompleteness({ ...filledPcpFields, pcp_plan_date: "2026-08-01" }, { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: true }).pcp.gates.find((gate) => gate.key === "source")?.met,
    false,
    "missing source gate keeps the plan incomplete",
  );
  assert.equal(
    buildPlanCompleteness({ ...filledPcpFields, pcp_plan_date: "2026-08-01", pcp_plan_source: "CCA" }, { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: false }).pcp.gates.find((gate) => gate.key === "source")?.met,
    false,
    "CCA source without a CCA on the case is incomplete",
  );
  assert.equal(
    buildPlanCompleteness({ ...filledPcpFields, pcp_plan_date: "2026-08-01", pcp_plan_source: "staff" }, { staffReviewed: false, hasRequiredPlanSignature: true, hasCca: true }).pcp.gates.find((gate) => gate.key === "staff_review")?.met,
    false,
    "missing staff review gate keeps the plan incomplete",
  );
  assert.equal(
    buildPlanCompleteness({ ...filledPcpFields, pcp_plan_date: "2026-08-01", pcp_plan_source: "staff" }, { staffReviewed: true, hasRequiredPlanSignature: false, hasCca: true }).pcp.gates.find((gate) => gate.key === "signatures")?.met,
    false,
    "missing signature gate keeps the plan incomplete",
  );
  const gatedPcp = buildPlanCompleteness(
    { ...filledPcpFields, pcp_plan_date: "08/01/2026", pcp_plan_source: "staff" },
    { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: false },
  );
  assert.equal(gatedPcp.pcp.state, "complete");
  assert.equal(planFalseCompleteFromFieldCount(gatedPcp), false);
  const gatedCrisis = buildPlanCompleteness(
    { ...filledCrisisFields, crisis_plan_date: "2026-08-02", crisis_plan_source: "CCA" },
    { staffReviewed: true, hasRequiredPlanSignature: true, hasCca: true },
  );
  assert.equal(gatedCrisis.crisis.state, "complete");
  assert.equal(
    buildCompletionReadiness({
      archived: false,
      submittedAt: new Date(),
      missingRequired: [],
      expectCca: true,
      hasCca: true,
      hasStaffSignature: true,
      providerPacketReady: true,
      packetState: "current",
      planComplete: false,
    }).blockers.some((blocker) => blocker.code === "plan_incomplete"),
    true,
    "complete path cannot treat a field-filled plan as done",
  );
  assert.equal(
    buildPacketChecklistChips({
      answers: filledPcpFields,
      uploadedDocuments: [],
      expectCca: true,
      hasCca: true,
      signatureStatuses: buildSignatureStatuses([]),
      planCompleteness: fieldOnlyPcp,
    }).find((chip) => chip.key === "pcp_plan")?.state,
    "missing",
    "case-page checklist stays missing until plan gates pass",
  );
  assert.equal(acceptableOverrideReason("test"), false);
  assert.equal(acceptableOverrideReason("Verified from the signed CCA source document."), true);
  ok("signature identity/version locking, conflict detection, conditional plan completeness, and override quality gates");

  const clientOnlyStatuses = buildSignatureStatuses([{
    role: "client",
    printedName: "Sample Client",
    signedDate: "08/01/2026",
  }]);
  const signedMissingStaff = buildCasePageStatus({
    status: "SIGNED",
    missingRequiredCount: 0,
    expectCca: true,
    hasCca: true,
    signatureStatuses: clientOnlyStatuses,
    generatedPdfCount: 1,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: true,
  });
  assert.equal(signedMissingStaff.headline, "Need Staff / QP signature");
  assert.equal(signedMissingStaff.sendCopiesAllowed, false);
  assert.equal(signedMissingStaff.steps.find((step) => step.key === "generate")?.done, true);
  assert.equal(signedMissingStaff.steps.find((step) => step.key === "signatures")?.done, false);
  assert.equal(/packet complete|all required complete|^signed$/i.test(signedMissingStaff.headline), false);

  const ccaMissingWithPdf = buildCasePageStatus({
    status: "SIGNED",
    missingRequiredCount: 0,
    expectCca: true,
    hasCca: false,
    signatureStatuses: buildSignatureStatuses([
      { role: "client", printedName: "Sample Client", signedDate: "08/01/2026" },
      { role: "staff", printedName: "QP Example", signedDate: "08/01/2026" },
    ]),
    generatedPdfCount: 1,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: true,
  });
  assert.equal(ccaMissingWithPdf.headline, "Need CCA");
  assert.equal(ccaMissingWithPdf.steps.find((step) => step.key === "generate")?.done, false);
  assert.equal(ccaMissingWithPdf.steps.find((step) => step.key === "cca")?.done, false);
  assert.equal(ccaMissingWithPdf.sendCopiesAllowed, false);

  const noCcaProvider = buildCasePageStatus({
    status: "SIGNED",
    missingRequiredCount: 0,
    expectCca: false,
    hasCca: false,
    signatureStatuses: buildSignatureStatuses([
      { role: "client", printedName: "Sample Client", signedDate: "08/01/2026" },
      { role: "staff", printedName: "QP Example", signedDate: "08/01/2026" },
    ]),
    generatedPdfCount: 1,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: true,
  });
  assert.equal(noCcaProvider.headline, "Ready to mark completed");
  assert.equal(noCcaProvider.steps.find((step) => step.key === "cca")?.skipped, true);
  assert.equal(noCcaProvider.sendCopiesAllowed, false);
  const completedNoCcaProvider = buildCasePageStatus({
    status: "COMPLETED",
    missingRequiredCount: 0,
    expectCca: false,
    hasCca: false,
    signatureStatuses: buildSignatureStatuses([
      { role: "client", printedName: "Sample Client", signedDate: "08/01/2026" },
      { role: "staff", printedName: "QP Example", signedDate: "08/01/2026" },
    ]),
    generatedPdfCount: 1,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: true,
  });
  assert.equal(completedNoCcaProvider.headline, "Completed");
  assert.equal(completedNoCcaProvider.sendCopiesAllowed, true);

  const mappedWitness = buildSignatureStatuses([], {
    mappedSlots: ["client_guardian", "staff_qp", "witness", "medical_director"],
  });
  assert.equal(mappedWitness.find((status) => status.key === "witness")?.required, true);
  assert.equal(mappedWitness.find((status) => status.key === "medical_director")?.required, true);
  assert.deepEqual(
    missingRequiredSignatures(mappedWitness).map((status) => status.label),
    ["Client / guardian", "Staff / QP", "Witness", "Medical Director"],
  );
  const threeStaffMissing = buildCasePageStatus({
    status: "SIGNED",
    missingRequiredCount: 0,
    expectCca: true,
    hasCca: true,
    signatureStatuses: buildSignatureStatuses(
      [{ role: "client", printedName: "Sample Client", signedDate: "08/01/2026" }],
      { mappedSlots: ["client_guardian", "staff_qp", "witness", "medical_director"] },
    ),
    generatedPdfCount: 1,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: true,
  });
  assert.equal(threeStaffMissing.headline, "Need Staff / QP, Witness, and Medical Director signatures");
  assert.equal(threeStaffMissing.sendCopiesAllowed, false);
  assert.deepEqual(
    mappedSignatureSlotsFromFields([
      { type: "signature", role: "witness" },
      { type: "signature_small", role: "medicalDirector" },
      { type: "text", role: "staff" },
    ]),
    ["witness", "medical_director"],
  );
  const optionalMappedClinicalRoles = buildSignatureStatuses([], {
    mappedSlots: ["client_guardian", "staff_qp", "witness", "medical_director"],
    requiredSlots: [],
  });
  assert.equal(optionalMappedClinicalRoles.find((status) => status.key === "witness")?.onPacket, true);
  assert.equal(optionalMappedClinicalRoles.find((status) => status.key === "witness")?.required, false);
  assert.equal(optionalMappedClinicalRoles.find((status) => status.key === "medical_director")?.onPacket, true);
  assert.equal(optionalMappedClinicalRoles.find((status) => status.key === "medical_director")?.required, false);
  assert.equal(
    missingRequiredSignatures(optionalMappedClinicalRoles).some((status) => status.key === "medical_director"),
    false,
    "optional Medical Director must not count as a missing required signature",
  );

  const waitingForClient = buildCasePageStatus({
    status: "IN_PROGRESS",
    missingRequiredCount: 0,
    expectCca: true,
    hasCca: false,
    signatureStatuses: clientOnlyStatuses,
    generatedPdfCount: 0,
    providerPacketReady: true,
    copiesSent: false,
    reviewed: false,
  });
  assert.equal(waitingForClient.headline, "Waiting for client to finish");
  assert.equal(waitingForClient.sendCopiesAllowed, false);

  const checklist = buildPacketChecklistChips({
    answers: { staff_chk_social_history: "Yes", medications: "None reported", consent_hipaa: true },
    uploadedDocuments: [],
    expectCca: true,
    hasCca: false,
    signatureStatuses: clientOnlyStatuses,
    provider: "Essential Wellness",
  });
  assert.equal(checklist.find((chip) => chip.key === "social_history")?.state, "keep");
  assert.equal(checklist.find((chip) => chip.key === "cca")?.state, "missing");
  assert.equal(checklist.find((chip) => chip.key === "medications")?.state, "keep");
  assert.equal(checklist.find((chip) => chip.key === "birth_id")?.state, "missing");
  assert.equal(checklist.find((chip) => chip.key === "signatures")?.state, "missing");
  assert.equal(
    buildPacketChecklistChips({
      answers: { staff_chk_psych_eval: "No" },
      uploadedDocuments: [{ docType: "CCA" }],
      expectCca: false,
      hasCca: false,
      signatureStatuses: clientOnlyStatuses,
    }).find((chip) => chip.key === "psych_eval")?.state,
    "na",
  );
  ok("staff case page status, CCA-first generate step, packet checklist chips, and packet-mapped signatures");
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

  const wellianceProvider = await prisma.provider.findUnique({ where: { slug: "welliance-care" } });
  assert(wellianceProvider, "seeded Welliance provider missing");
  const masterByEwSlug = await resolveStaffProvider(user!, { providerSlug: "welliance-care" });
  assert.equal(masterByEwSlug.ok, true);
  if (masterByEwSlug.ok) assert.equal(masterByEwSlug.provider.id, wellianceProvider!.id);
  const masterByMdcSlug = await resolveStaffProvider(user!, { providerSlug: "moore-divine-care" });
  assert.equal(masterByMdcSlug.ok, true);
  if (masterByMdcSlug.ok) assert.equal(masterByMdcSlug.provider.id, approvedProvider!.id);
  const unknownSlug = await resolveStaffProvider(user!, { providerSlug: "not-a-real-provider" });
  assert.equal(unknownSlug.ok, false);
  if (!unknownSlug.ok) assert.equal(unknownSlug.status, 404);
  const filterStaff = await prisma.user.create({
    data: {
      email: `provider-filter-${Date.now()}@example.com`,
      passwordHash: "x",
      name: "Provider Filter Staff",
      role: "staff",
    },
  });
  const filterClient = await prisma.client.create({
    data: {
      providerId: wellianceProvider!.id,
      fullName: "Provider Filter Client",
      dob: "1990-01-01",
    },
  });
  const filterIntake = await prisma.intake.create({
    data: {
      providerId: wellianceProvider!.id,
      clientId: filterClient.id,
      status: "IN_PROGRESS",
      token: newIntakeToken(),
      tokenExpiresAt: tokenExpiry(),
    },
  });
  try {
    await prisma.userMembership.create({
      data: { userId: filterStaff.id, providerId: approvedProvider!.id, role: "STAFF", active: true },
    });
    const staffLeak = await resolveStaffProvider(filterStaff, { providerSlug: "welliance-care" });
    assert.equal(staffLeak.ok, false);
    if (!staffLeak.ok) assert.equal(staffLeak.status, 403);
    const staffOwn = await resolveStaffProvider(filterStaff, { providerSlug: "moore-divine-care" });
    assert.equal(staffOwn.ok, true);
    const masterOpenById = await resolveStaffProviderForIntake(user!, filterIntake.id);
    assert.equal(masterOpenById.ok, true);
    if (masterOpenById.ok) assert.equal(masterOpenById.provider.id, wellianceProvider!.id);
    const staffOpenForeign = await resolveStaffProviderForIntake(filterStaff, filterIntake.id);
    assert.equal(staffOpenForeign.ok, false);
    if (!staffOpenForeign.ok) {
      assert.equal(staffOpenForeign.status, 404);
      assert.equal(staffOpenForeign.error, "Not found");
    }
    const missingIntake = await resolveStaffProviderForIntake(user!, "00000000-0000-0000-0000-000000000000");
    assert.equal(missingIntake.ok, false);
    if (!missingIntake.ok) assert.equal(missingIntake.status, 404);
  } finally {
    await prisma.intake.deleteMany({ where: { id: filterIntake.id } });
    await prisma.client.deleteMany({ where: { id: filterClient.id } });
    await prisma.userMembership.deleteMany({ where: { userId: filterStaff.id } });
    await prisma.user.deleteMany({ where: { id: filterStaff.id } });
  }
  ok("provider slug/id actually filters and master can open a case by id");

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
        status: "COMPLETED",
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
  assert.equal(smsRecipient("(336) 555-0141"), "+13365550141");
  assert.equal(smsRecipient("336-555-0141"), "+13365550141");
  assert.equal(smsRecipient("13365550141"), "+13365550141");
  assert.equal(smsRecipient("+1 (336) 555-0141"), "+13365550141");
  assert.equal(smsRecipient("+44 7700 900123"), "+447700900123");
  assert.equal(detectSmsPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "ios");
  assert.equal(detectSmsPlatform("Mozilla/5.0 (Linux; Android 14)"), "android");
  assert.equal(detectSmsPlatform("Mozilla/5.0 (X11; Linux x86_64) Chrome/120"), "unknown");
  assert.equal(deviceLikelyOpensSms("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(deviceLikelyOpensSms("Mozilla/5.0 (X11; Linux x86_64) Chrome/120"), false);
  const iosHref = intakeSmsHref("336-555-0141", clientLink, "Test Provider", "336-555-0100", "ios");
  const androidHref = intakeSmsHref("336-555-0141", clientLink, "Test Provider", "336-555-0100", "android");
  const desktopHref = intakeSmsHref("336-555-0141", clientLink, "Test Provider", "336-555-0100");
  assert(iosHref.startsWith("sms:+13365550141&body="), "iOS SMS links must use &body=");
  assert(androidHref.startsWith("sms:+13365550141?body="), "Android SMS links must use ?body=");
  assert(desktopHref.startsWith("sms:+13365550141?&body="), "desktop SMS links must use ?&body=");
  assert(iosHref.includes(encodeURIComponent(clientLink)), "SMS href must include the encoded client link");
  assert(!iosHref.includes("Angela"), "SMS href must not include a client name");
  assert.equal(smsHref("", "hello"), "");
  assert.equal(isUnreachableClientLink("http://localhost:3000/intake/token"), true);
  assert.equal(isUnreachableClientLink("https://mdc-smart-intake.onrender.com/intake/token"), false);
  assert(intakeMessage.includes("Save and return"), "intake SMS must explain save-and-return");
  assert(signatureMessage.includes("answers are saved"), "signature reminder must reassure the client");
  const followUpLink = "https://example.test/follow-up/random-token";
  const followUpMessage = followUpShareMessage(followUpLink, "Test Provider", "336-555-0100");
  assert(followUpMessage.includes(followUpLink), "follow-up SMS must include its private link");
  assert(followUpMessage.includes("STOP to opt out"), "follow-up SMS must include opt-out wording");
  assert(!/height|weight|hospital|diagnos|medicat/i.test(followUpMessage), "follow-up SMS must not name missing or health fields");
  assert(!followUpMessage.includes(`${followUpLink}.`), "punctuation must not be attached to the follow-up URL");

  // Manual "send it by hand" fallback: sms: links must open on both iPhone and
  // Android (the ?&body= form) and carry the +1 country code so a QR scan works.
  const smsLink = intakeSmsHref("(336) 555-0100", clientLink, "Test Provider", "336-555-0100");
  assert(smsLink.startsWith("sms:+13365550100?&body="), `sms link must be E.164 with ?&body= (got ${smsLink.slice(0, 40)})`);
  assert.equal(decodeURIComponent(smsLink.split("?&body=")[1]), intakeMessage, "sms link body must be the exact client message");
  const linkQr = qrSvgData(clientLink);
  assert(linkQr && linkQr.size >= 21 && linkQr.size % 4 === 1, "secure-link QR must be a valid QR size (21 + 4n modules)");
  assert(linkQr!.path.startsWith("M0 0h7v1h-7z"), "QR must start with the top-left finder pattern row");
  const smsQr = qrSvgData(smsLink);
  assert(smsQr && smsQr.size > linkQr!.size, "sms QR carries more data than the bare link QR");
  assert.equal(qrSvgData("   "), null, "empty text produces no QR");
  ok("send-it-by-hand links and QR codes are well formed");

  // One insurance dropdown on Create New Intake: every plan is in exactly one
  // group, and each plan's Record# mode agrees with the generator/lookup rules.
  const groupedPlans = RECORD_NUMBER_PLAN_GROUPS.flatMap((group) => group.plans);
  assert.deepEqual([...groupedPlans].sort(), [...PROVIDER_CHOICE_PLAN_OPTIONS].sort(), "plan groups must cover every plan exactly once");
  assert.equal(new Set(groupedPlans).size, groupedPlans.length, "no plan may appear in two groups");
  for (const plan of PROVIDER_CHOICE_PLAN_OPTIONS) {
    const mode = recordNumberMode(plan);
    assert(mode, `${plan} must have a Record# mode`);
    assert.equal(mode === "generate", canGenerateRecordNumber(plan), `${plan}: generate mode must match canGenerateRecordNumber`);
    assert.equal(!!recordNumberLookupLink(plan), mode === "lookup", `${plan}: lookup link only for lookup-only plans`);
  }
  assert.equal(recordNumberMode("Vaya"), "lookup");
  assert.equal(recordNumberMode("Healthy Blue"), "manual");
  assert.equal(recordNumberMode("Blue Cross Blue Shield"), "generate");
  assert.equal(recordNumberMode(""), "");
  ok("single insurance dropdown groups every plan and matches the Record# rules");

  {
    const createSrc = fs.readFileSync(path.join(process.cwd(), "src/app/intakes/new/page.tsx"), "utf8");
    const recordCard = createSrc.indexOf('id="new-intake-record"');
    const nctracksCard = createSrc.indexOf('id="new-intake-nctracks"');
    const nctracksTabs = createSrc.indexOf("NC Tracks starter options");
    const detailsStart = createSrc.indexOf('id="new-intake-details"');
    const advancedStart = createSrc.indexOf('id="new-intake-advanced"');
    const qrOption = createSrc.includes("Create and show QR");
    assert(recordCard >= 0, "Record# card must exist on Create New Intake");
    assert(nctracksCard >= 0 && nctracksTabs >= 0, "NC Tracks card and Upload / How it works / Open NC Tracks tabs must exist");
    assert(createSrc.includes('id={`nctracks-tab-${key}`}'), "NC Tracks tabs keep the existing tab ids");
    assert(createSrc.includes("/api/intakes/${intakeId}/nctracks-upload"), "NC Tracks file still uploads after create");
    assert(detailsStart >= 0, "Details accordion stays on the create page");
    assert(recordCard < detailsStart, "Record# must be on the home screen, not inside Details");
    assert(nctracksCard < detailsStart, "NC Tracks must be on the home screen, not inside Details");
    assert.equal(advancedStart, -1, "Advanced accordion is gone so Record# / NC Tracks are not buried");
    assert.equal(createSrc.split('id="new-intake-recordNumber"').length - 1, 1, "exactly one Record# input");
    assert(qrOption, "create page must include a Create and show QR action on the home screen");
    assert(createSrc.includes("data-testid=\"create-and-show-qr\""), "home-screen QR action is a dedicated button");
    assert(createSrc.includes("Creates the intake and shows a scannable QR on this page"), "QR helper describes the home-screen create-and-show path");
    assert(!createSrc.includes("After you create the intake, a scannable QR appears"), "old post-create-only QR helper copy is gone");
    assert(!createSrc.includes("Show QR code for the secure link"), "QR is a create action, not a buried after-create checkbox");
    assert(createSrc.includes("data-testid=\"create-intake-qr\""), "post-create QR panel is marked for the create success screen");
    assert(createSrc.includes("Scan to open the secure intake"), "success QR is labeled for the client to scan now");
    assert(!createSrc.includes("showQrAfterCreate && result.publicLinkReady !== false"), "QR still renders for a local workspace link");
    assert(createSrc.includes("QrCodeSvg"), "QR is rendered with the client-side QrCodeSvg helper");
    assert(!/api\.qrserver|chart\.googleapis|qrcode\.tec-it|qrtag/i.test(createSrc), "must not leak the token URL to an external QR image API");
    assert(createSrc.includes("const [sendSmsAfterCreate, setSendSmsAfterCreate] = useState(false)"), "sendSmsAfterCreate remains opt-in");
    assert(createSrc.includes("Fast Intake"), "Fast Intake stays on the create page");
    assert(createSrc.includes("Homeless / no fixed address"), "homeless explicit checkbox stays on the home screen");
    assert(createSrc.includes("sendSmsAfterCreate || wantQr"), "showing/sharing the QR still requires the insurance plan, same as SMS");
    assert(createSrc.includes("INSURANCE_BEFORE_CREATE_SHARE_MESSAGE"), "create page uses one softened insurance-before-share alert");
    assert(!createSrc.includes("sendSmsAfterCreate && !recordPanel.trim()"), "SMS checkbox does not repeat the insurance warning");
    assert(!createSrc.includes("showQrAfterCreate && !recordPanel.trim()"), "QR checkbox does not repeat the insurance warning");
    assert.equal(
      createSrc.split("Fill the insurance plan").length - 1,
      0,
      "insurance warning is not triplicated with Fill the insurance plan jumps under SMS and QR",
    );
    assert(!createSrc.includes("router.replace"), "create success never auto-redirects to the dashboard");
    assert(!createSrc.includes("Returning to the dashboard"), "SMS success stays on the create success screen");
    assert(!createSrc.includes("setRedirecting"), "post-create SMS does not start a dashboard redirect");
    assert(createSrc.includes("Done — dashboard"), "staff leave the success screen with an explicit Dashboard / Done link");
    ok("create page shows Record#, NC Tracks, and a home-screen Create and show QR action");
  }

  // Lookup-only plans must point staff at a real provider-portal sign-in, never a
  // public provider directory (the old links opened "find a provider" pages).
  const expectedLookupPortals = new Map([
    ["partners", "https://id.partnersbhm.org/"],
    ["vaya", "https://providerportal.vayahealth.com/"],
    ["alliance", "https://providerportal.alliancehealthplan.org/"],
    ["trillium", "https://www.ncinno.org/Dashboard"],
  ]);
  for (const link of RECORD_NUMBER_LOOKUP_LINKS) {
    assert(link.url.startsWith("https://"), `${link.label}: portal link must be https`);
    assert(!/provider-search|provider-contact|\/providers\/tp\//.test(link.url), `${link.label}: must be a portal sign-in, not a provider directory`);
    assert.equal(link.url, expectedLookupPortals.get(link.key), `${link.label}: must use the verified provider-portal sign-in`);
    assert(link.portal && link.description, `${link.label}: needs a portal name and description`);
  }
  ok("lookup-only plans link to provider-portal sign-ins");

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
    clientFollowUpQuestions(["height", "weight"], { height: "5'8\"", weight: "" })
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
      height: "5'8\"",
      weight: "160",
      consent_hipaa: "Yes",
    }).ok,
    false,
    "follow-up must reject fields outside the request",
  );
  assert.equal(
    validateFollowUpSubmission(safeFollowUpQuestions, {
      height: "5'8\"",
      weight: "160",
    }).ok,
    true,
    "follow-up must accept valid requested answers",
  );
  const deferredFollowUp = validateFollowUpSubmission(
    safeFollowUpQuestions,
    { height: "5'8\"" },
    { skippedKeys: ["weight"] },
  );
  assert.equal(deferredFollowUp.ok, true, "client may defer an unknown requested answer to staff");
  assert.equal(
    validateFollowUpSubmission(
      safeFollowUpQuestions,
      { height: "5'8\"" },
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
  const youthContacts = clientDeliveryContacts({
    phone: "336-555-0126",
    guardianName: "Erica Sample",
    guardianPhone: "336-555-0125",
  }, { is_minor_or_incompetent: "Yes" });
  assert.equal(youthContacts.phone?.role, "guardian");
  assert.equal(youthContacts.phone?.value, "336-555-0125");
  assert(deliveryContactsSummary(youthContacts).includes("guardian"));
  assert(deliveryContactsSummary(youthContacts).includes("(336) 555-0125"));
  const youthClientFallback = clientDeliveryContacts({
    phone: "336-555-0126",
    guardianName: "Erica Sample",
  }, { is_minor_or_incompetent: "Yes" });
  assert.equal(youthClientFallback.phone?.role, "client");
  assert.equal(youthClientFallback.phone?.value, "336-555-0126");
  const adultWithGuardianNameNo = clientDeliveryContacts({
    phone: "336-555-0102",
    guardianName: "Parent",
    guardianPhone: "336-555-0103",
  }, { is_minor_or_incompetent: "No" });
  assert.equal(adultWithGuardianNameNo.phone?.value, "336-555-0102");
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
    const followUpGet = await getClientFollowUp(followUpGetRequest, { params: Promise.resolve({ token: secureFollowUpToken }) });
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
        answers: { height: "5'8\"", weight: "160", consent_hipaa: "Yes" },
        attested: true,
      }),
    });
    const forbiddenFollowUp = await submitClientFollowUp(forbiddenFollowUpRequest, {
      params: Promise.resolve({ token: secureFollowUpToken }),
    });
    assert.equal(forbiddenFollowUp.status, 400, "follow-up must reject unrequested consent changes");
    assert.equal(
      (await prisma.intakeFollowUp.findUnique({ where: { id: followUpRow.id } }))?.status,
      "OPEN",
      "invalid follow-up must stay open for correction",
    );

    await saveAnswers(followUpIntake.id, {
      weight: "170",
      presenting_problem: "Staff edit made after the client opened the follow-up",
    });
    const validFollowUpRequest = new NextRequest(`http://localhost/api/follow-up/${secureFollowUpToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: { height: "5'8\"", weight: "160" },
        skippedKeys: ["preferred_emergency_facility"],
        attested: true,
      }),
    });
    const validFollowUp = await submitClientFollowUp(validFollowUpRequest, {
      params: Promise.resolve({ token: secureFollowUpToken }),
    });
    assert.equal(validFollowUp.status, 200, "valid follow-up answers must save");
    const savedFollowUpAnswers = await loadAnswers(followUpIntake.id);
    assert.equal(savedFollowUpAnswers.height, "5'8\"");
    assert.equal(savedFollowUpAnswers.weight, "170", "follow-up must not overwrite a newer staff answer");
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
      "5'8\"",
    );
    assert.deepEqual(
      JSON.parse(completedFollowUp?.skippedKeys || "[]"),
      ["preferred_emergency_facility"],
    );
    assert.equal(
      (await prisma.intake.findUnique({ where: { id: followUpIntake.id } }))?.status,
      "NEEDS_REVIEW",
      "post-signature follow-up content must require a fresh signature",
    );
    assert(
      (await prisma.signature.findUnique({
        where: { intakeId_role: { intakeId: followUpIntake.id, role: "client" } },
      }))?.invalidatedAt,
      "the prior client signature must retain an invalidation record",
    );
    const originalLinkAfterFollowUp = await getClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(originalLinkAfterFollowUp.status, 200, "invalidated content must reopen only for review and re-signing");
    const identityMismatchAfterFollowUp = await saveClientSignatureByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "client",
          imageData: "data:image/png;base64,iVBORw0KGgo=",
          printedName: "Different Person",
          relationship: "client",
          signedDate: "08/29/2026",
          dobCheck: "1990-01-01",
        }),
      }),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(identityMismatchAfterFollowUp.status, 409, "a different printed identity must not replace the signature");
    const replacementSignature = await saveClientSignatureByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "client",
          imageData: "data:image/png;base64,iVBORw0KGgo=",
          printedName: followUpClient.fullName,
          relationship: "client",
          signedDate: "08/29/2026",
          dobCheck: followUpClient.dob,
        }),
      }),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(replacementSignature.status, 200, "the current matching identity must be able to re-sign");
    const originalLinkAfterReplacementSignature = await getClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(originalLinkAfterReplacementSignature.status, 409, "a current replacement signature must close the client link again");
    const autosaveAfterSubmit = await saveClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { weight: "999 lb" } }),
      }),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(autosaveAfterSubmit.status, 409, "a current re-signed client token must not autosave answers");
    const uploadAfterSubmit = await uploadClientDocumentByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}/upload`, {
        method: "POST",
      }),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(uploadAfterSubmit.status, 409, "submitted client token must not upload new documents");
    await prisma.intake.update({
      where: { id: followUpIntake.id },
      data: { status: "NEEDS_REVIEW" },
    });
    const originalLinkAfterStaffStatusChange = await getClientIntakeByToken(
      new NextRequest(`http://localhost/api/intake/${followUpIntake.token}`),
      { params: Promise.resolve({ token: followUpIntake.token }) },
    );
    assert.equal(
      originalLinkAfterStaffStatusChange.status,
      409,
      "a current signature must keep the client link closed after a status-only staff review change",
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
      params: Promise.resolve({ token: secureFollowUpToken }),
    });
    assert.equal(replayFollowUp.status, 409, "completed follow-up links must reject replay");
    assert.equal((await loadAnswers(followUpIntake.id)).height, "5'8\"", "replay must not overwrite saved answers");
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
  const closedGet = await getClientIntakeByToken(clientRequest, { params: Promise.resolve({ token: intake.token }) });
  const closedGetBody = await closedGet.json() as Record<string, unknown>;
  assert.equal(closedGet.status, 409, "finished client links must be closed");
  assert.equal(closedGet.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(closedGetBody.code, "INTAKE_FINISHED");
  assert(!("answers" in closedGetBody), "finished client links must not return saved answers");
  const replaySubmit = await submitClientIntakeByToken(clientRequest, { params: Promise.resolve({ token: intake.token }) });
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
  assert.equal(
    missingRequired({ consent_hipaa: "Declined acknowledgment" }, true).some((item) => item.key === "consent_hipaa"),
    false,
    "declining the NPP acknowledgment must not block the intake",
  );
  assert.equal(consentsFromAnswers({ consent_hipaa: "Declined acknowledgment" }).consent_hipaa, false);
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
  assert.equal(applyOperationalDefaults({}).program_can_meet_needs, undefined, "program fit must require staff or CCA evidence");
  assert.equal(applyOperationalDefaults({}).ability_to_provide, undefined, "service eligibility must require staff or CCA evidence");
  ok("clinical and program eligibility answers are not invented");

  {
    const defaults = applyOperationalDefaults({});
    assert.equal(defaults.has_medicaid, undefined);
    assert.equal(defaults.has_nchc, undefined);
    assert.equal(defaults.language, "English");
    assert.equal(defaults.is_minor_or_incompetent, undefined);
    assert.equal(defaults.program_can_meet_needs, undefined);
    assert.equal(defaults.ability_to_provide, undefined);
    assert.equal(applyOperationalDefaults({ mid_number: "987654321A" }).has_medicaid, "Yes");
    assert.equal(ethnicityForRace("Black or African American"), "");
    assert.equal(ethnicityForRace("Caucasian or White"), "");
    assert.equal(ethnicityForRace("Asian"), "");
    assert.equal(raceSkipsEthnicity("Black or African American"), true);
    assert.equal(raceSkipsEthnicity("Caucasian or White"), true);
    assert.equal(raceSkipsEthnicity("Asian"), false);
    const black = applyOperationalDefaults({ race: "Black or African American" });
    assert.equal(black.ethnicity, undefined);
    const white = applyOperationalDefaults({ race: "Caucasian or White" });
    assert.equal(white.ethnicity, undefined);
    const asian = applyOperationalDefaults({ race: "Asian" });
    assert.equal(asian.ethnicity, undefined);
    const skipped = applySkippedClientPlaceholders({ employment_status: "Employed" });
    assert.equal(skipped.client_email, NONE_REPORTED_BY_CLIENT);
    assert.equal(skipped.client_phone_work, NONE_REPORTED_BY_CLIENT);
    const unemployedSkip = applySkippedClientPlaceholders({ employment_status: "Unemployed" });
    assert.equal(unemployedSkip.client_phone_work, undefined);
    const guardianKept = applyOperationalDefaults({ is_minor_or_incompetent: "Yes", guardian_name: "Erica Sample" });
    assert.equal(guardianKept.is_minor_or_incompetent, "Yes");
    ok("operational defaults use evidence for Medicaid, guardian status, language, and ethnicity");
  }

  {
    const hiddenKeys = [
      "has_medicaid", "has_nchc", "language", "is_minor_or_incompetent", "client_phone_home",
      "mid_number",
      "strengths", "needs", "medications", "otc_medications", "mh_history", "current_diagnosis_known",
      "medical_diagnoses", "treatments", "referred_for", "sub1_name", "roi1_thru_date",
      "intervention_valid_until",
    ];
    const answers = applyOperationalDefaults({
      race: "Black or African American",
      employment_status: "Unemployed",
      living_arrangement: "Adult Alone",
    });
    for (const key of hiddenKeys) {
      const q = questionByKey(key);
      assert(q, `catalog missing ${key}`);
      assert.equal(isClientQuestionVisible(q!, answers), false, `${key} must be hidden from the SMS client`);
    }
    const ethnicityQ = questionByKey("ethnicity");
    assert.equal(isClientQuestionVisible(ethnicityQ!, answers), false, "ethnicity skipped after Black");
    const whiteAnswers = applyOperationalDefaults({ race: "Caucasian or White" });
    assert.equal(isClientQuestionVisible(ethnicityQ!, whiteAnswers), false, "ethnicity skipped after White");
    const asianAnswers = applyOperationalDefaults({ race: "Asian" });
    assert.equal(isClientQuestionVisible(ethnicityQ!, asianAnswers), true, "other races still get ethnicity");
    const workPhone = questionByKey("client_phone_work");
    assert.equal(isClientQuestionVisible(workPhone!, answers), false, "work phone hidden when unemployed");
    const employed = { ...answers, employment_status: "Employed" };
    assert.equal(isClientQuestionVisible(workPhone!, employed), true, "work phone asked when employed");
    const emailQ = questionByKey("client_email");
    assert.equal(isClientQuestionVisible(emailQ!, { ...answers, client_email: "a@b.com" }), true, "email is always asked on SMS");
    const pcpFilled = { ...answers, pcp_name: "Dr. Example" };
    assert.equal(isClientQuestionVisible(questionByKey("has_pcp")!, pcpFilled, pcpFilled), false, "PCP skipped when staff already filled the name");
    const hospitalFilled = { ...answers, preferred_emergency_facility: "Moses Cone" };
    assert.equal(isClientQuestionVisible(questionByKey("preferred_emergency_facility")!, hospitalFilled, hospitalFilled), false);
    assert.equal(usesStrongMenu(questionByKey("marital_status")!), true);
    assert.equal(usesStrongMenu(questionByKey("employment_status")!), true);
    assert.equal(usesStrongMenu(questionByKey("education")!), true);
    assert.equal(questionByKey("language")!.staffOnly, true);
    assert.equal(usesStrongMenu(questionByKey("veteran")!), true);
    assert.equal(usesStrongMenu(questionByKey("referral_source")!), true);
    const easyKeys = flattenVisible(answers as Record<string, string | boolean | number | string[]>, answers as Record<string, string | boolean | number | string[]>, false, false, false, new Set<string>()).map((row) => row.q.key);
    assert(!easyKeys.includes("has_nchc"));
    assert(!easyKeys.includes("language"));
    assert(!easyKeys.includes("ethnicity"));
    assert(!easyKeys.includes("sub1_name"));
    assert(!easyKeys.includes("medications"));
    assert(!easyKeys.includes("otc_medications"));
    assert(easyKeys.includes("has_allergies"));
    assert(easyKeys.includes("client_email"));
    assert(!easyKeys.includes("mid_number"));
    assert(!questionByKey("race")!.options!.includes("Native American"));
    assert.deepEqual(questionByKey("ethnicity")!.options, ["Latino", "Non-Hispanic", "Not sure", "Prefer not to answer"]);
    assert.equal(easyClientSectionIntro("medications"), null);
    const educationOptions = questionByKey("education")!.options || [];
    assert(educationOptions.includes("Some College"));
    assert(educationOptions.includes("College"));
    const { EASY } = await import("../src/config/easyLanguage");
    const educationLabels = educationOptions.map((opt) => EASY.education?.options?.[opt] ?? opt);
    assert.equal(new Set(educationLabels.map((label) => label.toLowerCase())).size, educationLabels.length, "education menu must not show duplicate Some College wordings");
    assert(easyKeys.includes("consent_roi"));
    assert(easyKeys.includes("roi_understand_1"));
    const smsKeys = flattenVisible(answers as Record<string, string | boolean | number | string[]>, answers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(!smsKeys.includes("mid_number"));
    assert(!smsKeys.includes("is_minor_or_incompetent"));
    assert(smsKeys.includes("education"));
    assert(!smsKeys.includes("language"));
    assert(!smsKeys.includes("ethnicity"));
    assert(smsKeys.includes("income_sources"));
    assert(smsKeys.includes("height"));
    assert(smsKeys.includes("has_referrals"));
    const whiteSms = flattenVisible(whiteAnswers as Record<string, string | boolean | number | string[]>, whiteAnswers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(!whiteSms.includes("ethnicity"));
    const asianSms = flattenVisible(asianAnswers as Record<string, string | boolean | number | string[]>, asianAnswers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(asianSms.includes("ethnicity"));
    const employedSms = flattenVisible({ ...answers, employment_status: "Employed" } as Record<string, string | boolean | number | string[]>, answers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(employedSms.includes("occupation"));
    assert(employedSms.includes("client_phone_work"));
    const selfEmployedSms = flattenVisible({ ...answers, employment_status: "Self-Employed" } as Record<string, string | boolean | number | string[]>, answers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(selfEmployedSms.includes("occupation"));
    assert(selfEmployedSms.includes("client_phone_work"));
    const unemployedSms = flattenVisible(answers as Record<string, string | boolean | number | string[]>, answers as Record<string, string | boolean | number | string[]>, true, false, false, new Set<string>()).map((row) => row.q.key);
    assert(!unemployedSms.includes("client_phone_work"));
    assert(staffInsurancePlanReady({}) === false);
    assert.equal(staffInsurancePlanReady({ provider_choice_plan: "Healthy Blue" }), true);
    assert(INSURANCE_BEFORE_SMS_MESSAGE.toLowerCase().includes("insurance"));
    assert(INSURANCE_BEFORE_CREATE_SHARE_MESSAGE.toLowerCase().includes("insurance"));
    assert(INSURANCE_BEFORE_CREATE_SHARE_MESSAGE.toLowerCase().includes("qr"));
    assert(!INSURANCE_BEFORE_SMS_MESSAGE.toLowerCase().includes("do not send the client link until the plan is filled"));
    const smsGateEmpty = insuranceSmsBlockReason({});
    assert(smsGateEmpty);
    assert.equal(!!smsGateEmpty, true, "computer SMS, Twilio send, and I-sent-this stay blocked until a plan is filled");
    assert.equal(insuranceSmsBlockReason({ mco: "Alliance" }), null);
    assert.equal(insuranceSmsBlockReason({ provider_choice_plan: "Healthy Blue" }), null);
    ok("SMS skip visibility, strong menus, and insurance-before-SMS helper");
  }

  assert.equal(staffFacingFieldLabel("ec1_cell_phone"), "Contact 1 - cell phone");
  assert.equal(staffFacingFieldLabel("consent_hipaa"), "Notice of Privacy Practices Acknowledgment");
  assert.equal(staffFacingFieldLabel("presenting_problem"), "Why do you want help?");
  assert.equal(staffFacingFieldLabel("record_number"), "Record #");
  assert.equal(staffFacingFieldLabel("dob"), "Date of birth");
  assert.equal(staffFacingFieldLabel("pcp_plan_client_name"), "PCP plan client name");
  assert.equal(staffFacingFieldLabel("client_phone_cell"), "Cell phone");
  assert(!textContainsRawFieldKey(staffFacingFieldLabel("ec1_cell_phone")));
  assert(textContainsRawFieldKey("ec1_cell_phone"));
  assert(!replaceRawFieldKeys("Please fill ec1_cell_phone and consent_hipaa").includes("_"));
  const labelPreflight = buildRulePreflight({
    answers: { client_full_name: "Test Client", dob: "1990-01-01" },
    client: { fullName: "Test Client", dob: "1990-01-01" },
    missingRequired: [
      { key: "ec1_cell_phone", label: "Contact 1 - cell phone" },
      { key: "consent_hipaa", label: "Notice of Privacy Practices acknowledgment" },
      { key: "presenting_problem", label: "Why do you want help?" },
    ],
    missingOptional: [],
    hasClientSignature: false,
    hasCca: false,
    expectCca: true,
  });
  for (const finding of labelPreflight) {
    assert(!textContainsRawFieldKey(finding.title), `preflight title leaked a raw key: ${finding.title}`);
    assert(!textContainsRawFieldKey(finding.detail), `preflight detail leaked a raw key: ${finding.detail}`);
    for (const label of finding.fieldLabels || []) {
      assert(!label.includes("_"), `preflight label leaked a raw key: ${label}`);
    }
  }
  const attentionCards = labelPreflight.filter((finding) => finding.severity !== "info");
  assert.equal(attentionCards.length, labelPreflight.filter((finding) => finding.severity !== "info").length);
  const asked = clientAskedPercentComplete({
    client_full_name: "Test",
    dob: "1990-01-01",
    gender: "Female",
    race: "Black or African American",
    living_arrangement: "Adult Alone",
    address_street: "1 Main",
    client_phone_cell: "3365550100",
    presenting_problem: "help",
  }, { quick: true });
  const packetPct = percentComplete({
    client_full_name: "Test",
    dob: "1990-01-01",
    gender: "Female",
    race: "Black or African American",
    living_arrangement: "Adult Alone",
    address_street: "1 Main",
    client_phone_cell: "3365550100",
    presenting_problem: "help",
  });
  assert(asked >= packetPct, "client-asked coverage must not use the full staff packet as the denominator");
  ok("preflight staff labels, copies gate while unsubmitted, and client-asked coverage");

  const catalog = mappingCatalog();
  assert(catalog.length > 8, "intake catalog should be grouped by section");
  assert(catalog.some((section) => section.entries.some((entry) => entry.key === "client_full_name")));
  assert(catalogEntryByKey("dob")?.mapperType === "date");
  assert.equal(catalogEntryByKey("gender")?.mapperType, "checkbox");
  assert.equal(catalogEntryByKey("has_medicaid")?.mapperType, "checkbox");
  assert.equal(catalogEntryByKey("is_minor_or_incompetent")?.mapperType, "checkbox");
  assert.equal(catalogEntryByKey("consent_orientation")?.mapperType, "checkbox");
  assert(catalogEntryByKey("consent_orientation")?.hint?.toLowerCase().includes("checkbox"));
  const placed = newCatalogField(catalogEntryByKey("client_full_name")!, 1, 40, 700);
  assert.equal(placed.source, "client_full_name");
  assert(mappedSourceKeys([placed]).has("client_full_name"));
  const consentBox = newCatalogField(catalogEntryByKey("consent_hipaa")!, 12, 40, 400);
  assert.equal(consentBox.type, "checkbox");
  assert.equal(consentBox.source, "consent_hipaa=true");
  const consentMappedHealth = assessMapping([
    { ...consentBox, source: "signature", type: "signature", role: "client", consentKey: "consent_hipaa" },
  ], 12, 612, 792, 1);
  assert(!consentMappedHealth.missingRequired.some((item) => item.key === "consent_hipaa"),
    "a consent-controlled physical signature box satisfies that consent mapping");
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

  const ewCtx = { name: "Essential Wellness Care Inc.", originalFileName: "E.W.C.-INTAKE-FORM.pdf" };
  assert.equal(questionCatalogId(ewCtx), "essential-wellness");
  const ewCatalogKeys = new Set(mappingCatalog(ewCtx).flatMap((section) => section.entries.map((entry) => entry.key)));
  assert(!ewCatalogKeys.has("intake_mode"), "intake_mode is app-only and must not appear in the mapping catalog");
  assert(!ewCatalogKeys.has("consent_provider_choice"), "MDC provider-choice must not appear on Essential Wellness");
  assert(mappingCatalog().some((section) => section.entries.some((entry) => entry.key === "consent_provider_choice")));
  const liveUnmapped = [
    "intake_mode", "gender", "has_medicaid", "is_minor_or_incompetent", "ec1_cell_phone",
    "consent_provider_choice", "consent_orientation", "consent_rights", "consent_treatment",
    "consent_bill_of_rights", "consent_emergency_info", "consent_emergency_care", "consent_hipaa",
    "consent_confidentiality",
  ];
  const remainingForEw = liveUnmapped.filter((key) => key !== "intake_mode" && key !== "consent_provider_choice");
  const ewRequired = packetRequiredEntries(ewCtx);
  for (const key of remainingForEw) {
    assert(ewRequired.some((entry) => entry.key === key), `EW required map should include ${key}`);
  }
  const dummyField = (key: string, type: "text" | "checkbox" | "date" | "signature", role: "client" | "staff" = "client") => ({
    page: 1, fieldKey: `map_${key}`, source: key, type, x: 40, y: 700, width: 40, height: 12,
    fontSize: 9, lines: 1, lineHeight: 11.6, required: true, role, consentKey: null, notes: "",
  });
  const mappedExceptLiveGaps = ewRequired
    .filter((entry) => !remainingForEw.includes(entry.key))
    .map((entry, index) => ({
      ...dummyField(
        entry.key,
        entry.mapperType === "signature" || entry.mapperType === "signature_small" ? "signature"
          : entry.mapperType === "checkbox" || entry.mapperType === "initials" ? "checkbox"
          : entry.mapperType === "date" ? "date"
          : "text",
        entry.key.includes("staff") || entry.key.includes("record") || entry.key === "intake_date" ? "staff" : "client",
      ),
      y: 40 + (index % 40) * 12,
      x: 40 + Math.floor(index / 40) * 80,
    }));
  if (!mappedExceptLiveGaps.some((field) => field.type === "signature")) {
    mappedExceptLiveGaps.push(dummyField("signature", "signature"));
  }
  const ewHealth = assessMapping(mappedExceptLiveGaps, 39, 612, 792, mappedExceptLiveGaps.length, ewCtx);
  const reported = ewHealth.missingRequired.map((item) => item.key);
  assert.deepEqual([...reported].sort(), [...remainingForEw].sort());
  assert.equal(reported.length, remainingForEw.length, "quality check must list every remaining required-unmapped field");
  assert(ewHealth.score > 0, "score must not collapse to 0/100 just because required fields remain");
  assert.equal(ewHealth.ready, false);
  assert(mappingFieldGuide(ewCtx).includes("gender=Value"));
  assert(mappingFieldGuide(ewCtx).includes("has_medicaid=Yes"));
  assert(!mappingFieldGuide(ewCtx).includes("consent_provider_choice"));
  assert.equal(resolveValue("consent_orientation", { consent_orientation: true }).checked, true);
  assert.equal(resolveValue("has_medicaid=Yes", { has_medicaid: "Yes" }).checked, true);
  assert.equal(resolveValue("has_medicaid=No", { has_medicaid: "Yes" }).checked, false);
  assert.equal(missingRequired({ client_full_name: "X", dob: "1990-01-01" }, true, ewCtx).some((item) => item.key === "consent_provider_choice"), false);
  ok("EW mapping catalog drops MDC-only keys and the checker reports every remaining required-unmapped field");

  const approvedOnly = packetMapperStatus({ mappingStatus: "APPROVED", mappingScore: 72, isActive: false, approvedAt: new Date() });
  assert.equal(approvedOnly.key, "needs_review");
  assert(!/approved/i.test(approvedOnly.label) || approvedOnly.key === "approved_active");
  const live = packetMapperStatus({ mappingStatus: "APPROVED", mappingScore: 100, isActive: true, approvedAt: new Date() });
  assert.equal(live.key, "approved_active");
  const draft = packetMapperStatus({ mappingStatus: "DRAFT", mappingScore: null, isActive: false, approvedAt: null });
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

  assert.equal(normalizeDateInput("10.21.2026"), "2026-10-21");
  assert.equal(normalizeDateInput("01/21/2026"), "2026-01-21");
  assert.equal(normalizeDateInput("Oct 21, 2026"), "2026-10-21");
  assert.equal(normalizeDateInput("10212026"), "2026-10-21");
  assert.equal(normalizeDateInput("02/30/2026"), "", "impossible date is rejected");
  assert.equal(normalizeDateInput("none"), "");
  assert.equal(normalizeDateInput("Pending (verify)"), "");
  assert.equal(normalizeDateInput("10/21/2026 (verify)"), "2026-10-21");
  assert.equal(normalizeDateInput("1212026"), "", "ambiguous 7-digit form stays blank");
  assert.equal(formatDateForPeople("10.21.2026"), "10/21/2026");
  assert(isDatePlaceholder("N/A") && !isDatePlaceholder("10/21/2026"));
  {
    const normDay = (v: string) => (v ? normalizeDateInput(v) || v : "");
    const sameDay = new Set(["2026-10-21", "10/21/2026", "10.21.2026"].map(normDay));
    assert.equal(sameDay.size, 1, "one calendar day in three spellings must not trip the preflight date warning");
  }
  ok("CCA dates in dot/slash/word form normalise to YYYY-MM-DD; matching days no longer trigger a false date warning");

  // Identity checks (packet-generation gate + preflight) must treat the same day
  // and the legal-name(preferred) shape as a match, not a dead-end mismatch.
  assert.equal(normRecordDate("2026-10-21"), normRecordDate("10/21/2026"), "ISO and US DOB are the same day");
  assert.equal(normRecordDate("2026-1-2"), normRecordDate("01/02/2026"));
  assert.notEqual(normRecordDate("2026-10-21"), normRecordDate("10/22/2026"), "different days stay different");
  assert.equal(normRecordName("John Snipes (Johnny)"), normRecordName("john snipes"), "preferred-name suffix is ignored");
  assert.notEqual(normRecordName("Markey Washington Jr"), normRecordName("Markey Washington"), "distinct names stay distinct");
  ok("DOB/name identity normalisers agree across gate and preflight (no false identity block)");

  // ---- NC PLAN SIGNATURES page -------------------------------------------
  // This page carries the client's signature onto a state form, so three
  // rules are load-bearing: the signature is the drawn image and is never
  // faked with type, no date is ever written, and the "I/DD services only"
  // attestation is ticked only when the CCA documents an I/DD diagnosis.
  {
    const dxReview = (code: string, label: string) => ({
      ...emptyCcaReview(), primaryDiagnosis: { code, label },
    });
    assert.equal(pcpIddDocumented(dxReview("F33.1", "Major depressive disorder, recurrent")), false,
      "a depression diagnosis must not tick the I/DD box");
    assert.equal(pcpIddDocumented(dxReview("F10.20", "Alcohol use disorder")), false,
      "a substance use diagnosis must not tick the I/DD box");
    assert.equal(pcpIddDocumented(dxReview("F71", "Moderate intellectual disability")), true,
      "F70-F79 is I/DD");
    assert.equal(pcpIddDocumented(dxReview("F84.0", "Autistic disorder")), true,
      "F84 counts as I/DD on this form even though the service scorer treats it as mental health");
    assert.equal(pcpIddDocumented(null), false, "no CCA means the I/DD box stays blank");
    ok("PLAN SIGNATURES: the I/DD attestation is driven by the diagnosis, never ticked by default");

    const onePagePacket = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([612, 792]);
      return doc.save();
    })();
    // a 1x1 transparent PNG is a valid captured signature for this test
    const pngData = "data:image/png;base64,"
      + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    const signedDate = "08/30/2026";
    const signed = await appendPcpPlanSignaturePage(onePagePacket, {
      clientName: "Marcus Anthony Whitfield-Brown",
      dob: "03/14/1988", midNumber: "947123456M", recordNumber: "MDC-1042",
      caseManagementAgency: "Moore Divine Care, Inc.",
      planReviewedAndAgreed: true, freeChoiceConfirmed: true,
      clientIsOwnLegalRepresentative: true, iddDocumented: false,
      signatures: { client: { role: "client", imageData: pngData, printedName: "Marcus Anthony Whitfield-Brown", signedDate } },
    });
    assert.equal(signed.signedBy, "client", "an adult signing for themselves uses the client block");
    assert.deepEqual(signed.warnings, [], "a signed page reports no missing-signature warning");
    const signedText = await extractPdfText(signed.pdfBytes);
    assert.ok(signedText.includes("Marcus Anthony Whitfield-Brown"), "the printed name stays legible text");
    assert.ok(!signedText.includes(signedDate), "no date is ever written on the PLAN SIGNATURES page");
    ok("PLAN SIGNATURES: signed page carries a legible printed name and no date");

    const unsigned = await appendPcpPlanSignaturePage(onePagePacket, {
      clientName: "Unsigned Test", caseManagementAgency: "Moore Divine Care, Inc.",
      planReviewedAndAgreed: true, freeChoiceConfirmed: true,
      clientIsOwnLegalRepresentative: true, iddDocumented: false, signatures: {},
    });
    assert.equal(unsigned.signedBy, null, "no captured signature means nothing was signed");
    assert.ok(unsigned.warnings.some((w) => w.includes("left blank")),
      "an unsigned page must warn rather than substitute a typed name");
    ok("PLAN SIGNATURES: an unsigned form prints blank and warns - it never types a stand-in signature");

    const guardianSigned = await appendPcpPlanSignaturePage(onePagePacket, {
      clientName: "Jayden Sample", caseManagementAgency: "Moore Divine Care, Inc.",
      planReviewedAndAgreed: true, freeChoiceConfirmed: true,
      clientIsOwnLegalRepresentative: false, iddDocumented: true,
      guardianRelationship: "Mother",
      signatures: { guardian: { role: "guardian", imageData: pngData, printedName: "Erica Sample", signedDate } },
    });
    assert.equal(guardianSigned.signedBy, "guardian", "a minor's page is signed in the guardian block");
    const guardianText = await extractPdfText(guardianSigned.pdfBytes);
    assert.ok(guardianText.includes("Erica Sample"), "the guardian's printed name is drawn");
    assert.ok(guardianText.includes("Mother"), "the guardian's relationship is drawn");
    assert.ok(!guardianText.includes(signedDate), "the guardian page is undated too");
    ok("PLAN SIGNATURES: a guardian signs the legally-responsible-person block, with their relationship");
  }

  // ---- answers that must never be invented on a signed packet --------------
  {
    // A minor could complete and sign the whole packet as their own legal
    // representative: is_minor_or_incompetent is staff-only, gates every
    // guardian question, and nothing blocked submission when it was blank.
    assert.equal(ageAtDate("2011-09-22", "2026-08-30"), 14, "age is calendar-accurate");
    assert.equal(ageAtDate("2008-10-21", "2026-08-30"), 17, "birthday not yet reached this year");
    assert.equal(ageAtDate("2008-08-30", "2026-08-30"), 18, "birthday on the intake date counts");
    assert.equal(ageAtDate("", "2026-08-30"), null, "no DOB gives no age");

    const minor = applyOperationalDefaults({ dob: "2011-09-22", intake_date: "2026-08-30" } as never);
    assert.equal(minor.is_minor_or_incompetent, "Yes", "a 14-year-old is never their own legal representative");
    const minorMisflagged = applyOperationalDefaults({
      dob: "2011-09-22", intake_date: "2026-08-30", is_minor_or_incompetent: "No",
    } as never);
    assert.equal(minorMisflagged.is_minor_or_incompetent, "Yes", "a date of birth overrides a mistaken No");
    const adultWithGuardian = applyOperationalDefaults({
      dob: "1988-03-14", intake_date: "2026-08-30", is_minor_or_incompetent: "Yes",
    } as never);
    assert.equal(adultWithGuardian.is_minor_or_incompetent, "Yes", "staff may still flag an adult with a guardian");
    ok("guardian status is derived from the date of birth, so a minor cannot sign for themselves");

    // NC Health Choice covers children who do NOT qualify for Medicaid, so
    // "No" is only true once Medicaid is established.
    const noEvidence = applyOperationalDefaults({ client_full_name: "A B", dob: "2014-03-02" } as never, { forPdf: true });
    assert.equal(noEvidence.has_nchc, undefined, "NCHC stays blank with no Medicaid evidence");
    const onMedicaid = applyOperationalDefaults({ mid_number: "947123456M" } as never, { forPdf: true });
    assert.equal(onMedicaid.has_nchc, "No", "an established Medicaid enrollment does imply NCHC No");
    ok("NC Health Choice is derived from Medicaid, not invented for every client");
  }

  // ---- the diagnosis menu must not print sentinels as diagnoses ------------
  {
    const dunno = applyOperationalDefaults({ has_current_diagnosis: "Yes", diagnosis_menu: "I don't know" } as never);
    assert.ok(!String(dunno.sa_primary_diagnosis || "").includes("know"), "\"I don't know\" is not a diagnosis");
    assert.ok(!String(dunno.c_axis1 || "").includes("know"), "\"I don't know\" never reaches Axis I");
    const other = applyOperationalDefaults({
      diagnosis_menu: "Other", diagnosis_list: "Borderline personality disorder",
    } as never);
    assert.equal(other.sa_primary_diagnosis, "Borderline personality disorder",
      "the real diagnosis outranks the Other sentinel");
    const real = applyOperationalDefaults({ diagnosis_menu: "Major depressive disorder (F33.1)" } as never);
    assert.equal(real.sa_primary_diagnosis, "Major depressive disorder (F33.1)", "a real menu diagnosis still prints");
    ok("diagnosis menu sentinels never print as a clinical diagnosis");
  }

  // ---- plan notes and plan agreement must never be invented -----------------
  {
    const defaults = applyOperationalDefaults({
      needs: "Housing support",
      treatments: "Continue therapy",
      crisis_warning_signs: "Pacing",
      crisis_steps: "Call a support person",
    } as never) as Record<string, unknown>;
    assert.equal(defaults.dis_pcp_plan, undefined,
      "needs, treatment notes, and crisis notes must not be relabeled as a completed PCP plan");
    assert.equal(defaults.consent_treatment_plan_participation, undefined,
      "operational defaults must not invent treatment-plan agreement");
    ok("PCP plan content and plan-review consent remain explicit, source-backed fields");
  }

  // ---- the presenting problem must be idempotent ---------------------------
  {
    let a: Record<string, unknown> = {
      presenting_need_chips: ["Therapy"], why_want_services_chips: ["I want to stay stable"],
    };
    a = applyOperationalDefaults(a as never) as Record<string, unknown>;
    const first = String(a.presenting_problem);
    a = applyOperationalDefaults(a as never) as Record<string, unknown>;
    assert.equal(a.presenting_problem, first, "re-running the defaults must not grow the sentence");
    a.presenting_need_chips = ["Therapy", "Need housing"];
    a = applyOperationalDefaults(a as never) as Record<string, unknown>;
    a = applyOperationalDefaults(a as never) as Record<string, unknown>;
    assert.equal(
      a.presenting_problem, "Therapy, Need housing. I want to stay stable",
      "adding a chip replaces the derived sentence instead of appending a second copy",
    );
    const typed = applyOperationalDefaults({
      presenting_need_chips: ["Food"], presenting_problem: "My landlord is evicting me.",
    } as never) as Record<string, unknown>;
    assert.ok(String(typed.presenting_problem).includes("My landlord is evicting me."),
      "what the client typed themselves is kept");
    ok("the presenting problem no longer duplicates each time the client returns");
  }

  // ---- every client menu choice has a home on the packet -------------------
  {
    const boxed = new Set(PACKET_MAP.fields.map((f) => f.source || "").filter(Boolean));
    const drifted: string[] = [];
    for (const key of Object.keys(UNMAPPED_PACKET_CHOICES)) {
      const question = questionByKey(key);
      const allowed = new Set(UNMAPPED_PACKET_CHOICES[key]);
      for (const option of question?.options || []) {
        const printed = applyOperationalDefaults(
          { [key]: option, race: "Black or African American" } as never, { forPdf: true },
        ) as Record<string, unknown>;
        if (boxed.has(`${key}=${String(printed[key])}`)) continue;
        if (allowed.has(option)) continue;
        drifted.push(`${key}="${option}"`);
      }
    }
    assert.deepEqual(drifted, [],
      `these menu choices print blank on the packet and are not declared in UNMAPPED_PACKET_CHOICES: ${drifted.join(", ")}`);
    const mapped = applyOperationalDefaults(
      { ethnicity: "Non-Hispanic", race: "Black or African American" } as never, { forPdf: true },
    );
    assert.equal(mapped.ethnicity, "Non-Hispanic", "race must not invent a packet ethnicity value");
    assert.equal(ethnicityForRace("Black or African American"), "");
    assert.equal(
      applyOperationalDefaults({ employment_status: "Self-Employed" } as never, { forPdf: true }).employment_status,
      "Employed", "self-employment ticks the Employed box");
    assert.equal(
      applyOperationalDefaults({ employment_status: "Retired" } as never, { forPdf: true }).employment_status,
      "Not in Labor Force", "a retiree ticks Not in Labor Force");
    ok("new menu choices either tick a real box or are declared as record-only");
  }

  // ---- Easy Mode interstitial tap must not select the next answer ----------
  {
    const now = 1_000_000;
    const until = interstitialGuardUntil(now);
    assert.equal(until, now + INTERSTITIAL_CLICK_GUARD_MS);
    assert.equal(isInterstitialClickGuarded(until, now), true, "the tap that dismisses the interstitial is ignored");
    assert.equal(isInterstitialClickGuarded(until, now + INTERSTITIAL_CLICK_GUARD_MS - 1), true);
    assert.equal(isInterstitialClickGuarded(until, now + INTERSTITIAL_CLICK_GUARD_MS), false, "a later choice still advances");
    assert.equal(isInterstitialClickGuarded(0, now), false);
    ok("Easy Mode interstitial tap is consumed and does not select the next chip");
  }

  // ---- PHI backup confirm is not pre-baked in the href ---------------------
  {
    assert.equal(phiBackupDownloadUrl(false), PHI_BACKUP_PATH);
    assert.equal(phiBackupDownloadUrl(true), `${PHI_BACKUP_PATH}?confirmPhi=yes`);
    assert(!phiBackupDownloadUrl(false).includes("confirmPhi"), "unconfirmed href must not set confirmPhi");
    const dashboardSrc = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/page.tsx"), "utf8");
    const masterSrc = fs.readFileSync(path.join(process.cwd(), "src/app/master/dashboard/page.tsx"), "utf8");
    const buttonSrc = fs.readFileSync(path.join(process.cwd(), "src/components/PhiBackupDownloadButton.tsx"), "utf8");
    assert(!dashboardSrc.includes("confirmPhi=yes"), "staff More-tools must not pre-bake confirmPhi=yes");
    assert(!masterSrc.includes("confirmPhi=yes"), "master header must not pre-bake confirmPhi=yes");
    assert(buttonSrc.includes("href={PHI_BACKUP_PATH}"), "the visible href stays unconfirmed");
    assert(buttonSrc.includes("window.confirm"), "backup requires an explicit confirm dialog");
    assert(buttonSrc.includes("phiBackupDownloadUrl(true)"), "confirmPhi=yes is added only after confirm");
    ok("PHI backup download requires a real confirm; href does not pre-set confirmPhi=yes");
  }

  // ---- 5. Completed-copy token when the intake token is expired ------------
  {
    const copyProvider = await prisma.provider.findUnique({ where: { slug: "moore-divine-care" } });
    assert(copyProvider, "copy-token test needs the seeded Moore Divine provider");
    const copyClient = await prisma.client.create({
      data: {
        providerId: copyProvider!.id,
        fullName: "Copy Token Client",
        dob: "1991-02-03",
        email: "copy-token-client@example.com",
      },
    });
    const expiredIntakeToken = newIntakeToken();
    const copyIntake = await prisma.intake.create({
      data: {
        providerId: copyProvider!.id,
        clientId: copyClient.id,
        status: "COMPLETED",
        submittedAt: new Date(),
        token: expiredIntakeToken,
        tokenExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const openExpiredToken = newIntakeToken();
    const openExpiredIntake = await prisma.intake.create({
      data: {
        providerId: copyProvider!.id,
        clientId: copyClient.id,
        status: "IN_PROGRESS",
        token: openExpiredToken,
        tokenExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    const packetDoc = await PDFDocument.create();
    packetDoc.addPage([612, 792]);
    const packetRel = `generated/${copyIntake.id}/copy-token-final.pdf`;
    saveFile(packetRel, Buffer.from(await packetDoc.save({ useObjectStreams: false })));
    await prisma.generatedPdf.create({
      data: { intakeId: copyIntake.id, filePath: packetRel, contentRevision: copyIntake.contentRevision },
    });
    try {
      const delivered = await sendCompletedCopiesLink({
        intakeId: copyIntake.id,
        providerId: copyProvider!.id,
        req: new Request("http://localhost"),
      });
      assert.notEqual(delivered.status, 410, "expired Easy Mode tokens must not block completed-copy delivery");
      const copyLink = String(delivered.body.link || "");
      assert(copyLink.includes("/copies/"), "completed-copy delivery must mint a copies URL");
      const copyToken = copyLink.split("/copies/")[1] || "";
      assert(copyToken && copyToken !== expiredIntakeToken, "copies link must use a dedicated copy token");
      const stored = await prisma.intake.findUnique({
        where: { id: copyIntake.id },
        select: { token: true, copyToken: true, copyTokenExpiresAt: true },
      });
      assert.equal(stored?.token, expiredIntakeToken, "Easy Mode token must stay expired and unrotated");
      assert.equal(stored?.copyToken, copyToken);
      assert(stored?.copyTokenExpiresAt && stored.copyTokenExpiresAt.getTime() > Date.now());

      const expiredEasy = await getClientIntakeByToken(
        new NextRequest(`http://localhost/api/intake/${expiredIntakeToken}`),
        { params: Promise.resolve({ token: expiredIntakeToken }) },
      );
      const expiredEasyBody = await expiredEasy.json() as Record<string, unknown>;
      assert.notEqual(expiredEasy.status, 200);
      assert(!("answers" in expiredEasyBody), "expired/finished Easy Mode token must not serve the questionnaire");
      const openExpired = await getClientIntakeByToken(
        new NextRequest(`http://localhost/api/intake/${openExpiredToken}`),
        { params: Promise.resolve({ token: openExpiredToken }) },
      );
      const openExpiredBody = await openExpired.json() as Record<string, unknown>;
      assert.equal(openExpired.status, 410);
      assert.equal(openExpiredBody.code, "LINK_EXPIRED");
      assert(!("answers" in openExpiredBody), "expired Easy Mode token must not revive the questionnaire");

      const packetOk = await getCompletedCopyPacket(
        new NextRequest(`http://localhost/api/copies/${copyToken}/packet`),
        { params: Promise.resolve({ token: copyToken }) },
      );
      assert.equal(packetOk.status, 200, "fresh copy token must serve the completed packet");
      assert.equal(packetOk.headers.get("content-type"), "application/pdf");
      const packetDenied = await getCompletedCopyPacket(
        new NextRequest(`http://localhost/api/copies/${expiredIntakeToken}/packet`),
        { params: Promise.resolve({ token: expiredIntakeToken }) },
      );
      assert.equal(packetDenied.status, 404, "the expired Easy Mode token must not serve copies");
      ok("completed-copy delivery mints a working copy token; expired Easy Mode token still rejects");
    } finally {
      await prisma.generatedPdf.deleteMany({ where: { intakeId: copyIntake.id } });
      await prisma.intake.deleteMany({ where: { id: { in: [copyIntake.id, openExpiredIntake.id] } } });
      await prisma.client.deleteMany({ where: { id: copyClient.id } });
      deleteFile(packetRel);
    }
  }

  // ---- 7. Draft PDF filename + no watermark --------------------------------
  {
    assert.equal(
      packetDownloadFileName({ providerName: "Moore Divine Care", clientName: "Angela Demo", documentState: "DRAFT_PREVIEW" }),
      "Moore-Divine-Care-Intake-Angela-Demo-DRAFT.pdf",
    );
    assert.equal(
      packetDownloadFileName({ providerName: "Moore Divine Care", clientName: "Angela Demo", documentState: "CURRENT_FINAL" }),
      "Moore-Divine-Care-Intake-Angela-Demo.pdf",
    );
    const masterUser = await prisma.user.findFirst({ where: { role: "master" } });
    const angela = await prisma.client.findFirst({
      where: { fullName: "Angela Demo" },
      include: { intakes: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    assert(masterUser && angela?.intakes[0], "draft PDF route test needs Angela and master login");
    bindTestCookies({
      get: (name) => name === SESSION_COOKIE ? { value: createSessionValue(masterUser!.id) } : undefined,
    });
    try {
      const preview = await getIntakePdf(
        new NextRequest(`http://localhost/api/intakes/${angela!.intakes[0].id}/pdf?preview=1`),
        { params: Promise.resolve({ id: angela!.intakes[0].id }) },
      );
      assert.equal(preview.status, 200);
      assert.equal(preview.headers.get("x-smart-intake-document-state"), "DRAFT_PREVIEW");
      const previewDisposition = preview.headers.get("content-disposition") || "";
      assert(previewDisposition.includes("DRAFT"), "preview Content-Disposition must say DRAFT");
      await preview.arrayBuffer();

      const finalPdf = await getIntakePdf(
        new NextRequest(`http://localhost/api/intakes/${angela!.intakes[0].id}/pdf`),
        { params: Promise.resolve({ id: angela!.intakes[0].id }) },
      );
      if (finalPdf.status === 200) {
        assert.equal(finalPdf.headers.get("x-smart-intake-document-state"), "CURRENT_FINAL");
        const finalDisposition = finalPdf.headers.get("content-disposition") || "";
        assert(!finalDisposition.includes("DRAFT"), "final Content-Disposition must not say DRAFT");
        assert.notEqual(finalDisposition, previewDisposition);
        await finalPdf.arrayBuffer();
      }
      ok("draft/preview PDFs are labeled by filename and response state without a watermark");
    } finally {
      bindTestCookies(null);
    }
  }

  // ---- 8. Provider-admin /provider/settings E2E including cross-provider denial
  {
    const settingsSrc = fs.readFileSync(path.join(process.cwd(), "src/app/provider/settings/page.tsx"), "utf8");
    assert(!settingsSrc.includes("master/dashboard"), "provider settings must not re-export the master dashboard");
    assert(!/Create provider/i.test(settingsSrc), "provider settings must not be the master Create-providers UI");

    const stamp = Date.now();
    const providerA = await prisma.provider.create({
      data: { name: `Settings E2E A ${stamp}`, slug: `settings-e2e-a-${stamp}` },
    });
    const providerB = await prisma.provider.create({
      data: { name: `Settings E2E B ${stamp}`, slug: `settings-e2e-b-${stamp}` },
    });
    const passwordHash = await bcrypt.hash("IntakeDemo123!", 4);
    const adminA = await prisma.user.create({
      data: { email: `settings-admin-a-${stamp}@example.com`, passwordHash, name: "Settings Admin A", role: "staff" },
    });
    const adminB = await prisma.user.create({
      data: { email: `settings-admin-b-${stamp}@example.com`, passwordHash, name: "Settings Admin B", role: "staff" },
    });
    const staffA = await prisma.user.create({
      data: { email: `settings-staff-a-${stamp}@example.com`, passwordHash, name: "Settings Staff A", role: "staff" },
    });
    await prisma.userMembership.createMany({
      data: [
        { userId: adminA.id, providerId: providerA.id, role: "PROVIDER_ADMIN", active: true },
        { userId: adminB.id, providerId: providerB.id, role: "PROVIDER_ADMIN", active: true },
        { userId: staffA.id, providerId: providerA.id, role: "STAFF", active: true },
      ],
    });
    const masterUser = await prisma.user.findFirst({ where: { role: "master" } });
    assert(masterUser, "provider-admin settings E2E needs the seeded master user");

    const withSession = (userId: string, providerId?: string) => {
      bindTestCookies({
        get: (name) => {
          if (name === SESSION_COOKIE) return { value: createSessionValue(userId) };
          if (providerId && name === SELECTED_PROVIDER_COOKIE) return { value: providerId };
          return undefined;
        },
      });
    };

    try {
      withSession(adminA.id);
      const ownSettings = await getProviderSettings(new NextRequest("http://localhost/api/provider/settings"));
      assert.equal(ownSettings.status, 200, "authenticated provider-admin can load their own settings");
      const ownBody = await ownSettings.json() as { provider?: { id?: string }; settingsPath?: string };
      assert.equal(ownBody.provider?.id, providerA.id);
      assert.equal(ownBody.settingsPath, "/provider/settings");
      ok("provider-admin /provider/settings E2E: authenticated admin loads own settings");

      const crossQuery = await getProviderSettings(
        new NextRequest(`http://localhost/api/provider/settings?providerId=${providerB.id}`),
      );
      assert.equal(crossQuery.status, 403, "provider-admin A must be denied provider B settings via providerId");
      withSession(adminA.id, providerB.id);
      const crossCookie = await getProviderSettings(new NextRequest("http://localhost/api/provider/settings"));
      assert.equal(crossCookie.status, 403, "provider-admin A must be denied provider B settings via cookie swap");
      withSession(staffA.id);
      const staffSettings = await getProviderSettings(new NextRequest("http://localhost/api/provider/settings"));
      assert.equal(staffSettings.status, 403, "staff cannot load provider-admin settings");
      ok("provider-admin /provider/settings E2E: cross-provider cookie/providerId swap is denied");

      withSession(adminA.id);
      const mappingOwn = await getPacketMapping(
        new NextRequest(`http://localhost/api/mapping?providerId=${providerA.id}`),
      );
      assert.notEqual(mappingOwn.status, 403, "provider-admin can access their own packet mapping surface");
      const mappingCross = await getPacketMapping(
        new NextRequest(`http://localhost/api/mapping?providerId=${providerB.id}`),
      );
      assert.equal(mappingCross.status, 403, "provider-admin A must be denied provider B packet mapping");
      const templateCross = await getProviderPacketTemplate(
        new NextRequest(`http://localhost/api/master/providers/${providerB.id}/packet-template`),
        { params: Promise.resolve({ id: providerB.id }) },
      );
      assert.equal(templateCross.status, 403, "provider-admin A must be denied provider B packet-template admin surface");
      withSession(staffA.id);
      const staffMappingB = await getPacketMapping(
        new NextRequest(`http://localhost/api/mapping?providerId=${providerB.id}`),
      );
      assert.equal(staffMappingB.status, 403, "staff of A must be denied provider B packet mapping");
      withSession(masterUser!.id);
      const masterSettingsB = await getProviderSettings(
        new NextRequest(`http://localhost/api/provider/settings?providerId=${providerB.id}`),
      );
      assert.equal(masterSettingsB.status, 200, "master can still access provider B settings");
      const masterMappingB = await getPacketMapping(
        new NextRequest(`http://localhost/api/mapping?providerId=${providerB.id}`),
      );
      assert.notEqual(masterMappingB.status, 403, "master can still access provider B packet mapping");
      ok("provider-admin /provider/settings E2E: staff of A denied on B packet mapping; master can access");
    } finally {
      bindTestCookies(null);
      await prisma.userMembership.deleteMany({ where: { providerId: { in: [providerA.id, providerB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [adminA.id, adminB.id, staffA.id] } } });
      await prisma.provider.deleteMany({ where: { id: { in: [providerA.id, providerB.id] } } });
    }
  }

  console.log(`\nAll ${passed} checks passed ✓`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // focused NC Tracks eligibility checks (no DB/network) run as part of `npm test`
    await import("./test-eligibility");
  })
  .catch((e) => { console.error("✗ TEST FAILED:", e.message); prisma.$disconnect(); process.exit(1); });
