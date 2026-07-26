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
import { consentsFromAnswers, loadAnswers, loadSignatures } from "../src/lib/intakeData";
import { applyOperationalDefaults } from "../src/lib/answerDefaults";
import { clientLinkRenewalData, newIntakeToken, tokenExpiry } from "../src/lib/tokens";
import { clientDetailsSchema, missingRequired, newIntakeSchema, percentComplete } from "../src/lib/validation";
import { buildDashboardReadiness, needsStaffAction } from "../src/lib/dashboardWorkflow";
import { evaluatePacketFreshness } from "../src/lib/packetFreshness";
import { buildCompletionReadiness } from "../src/lib/completionReadiness";
import { COPY_ALLOWED_STATUSES } from "../src/lib/completedCopies";
import { buildSignatureStatuses } from "../src/lib/signatureStatus";
import {
  clientLinkExpired,
  clientLinkMessagingFinished,
  reminderCooldownSeconds,
} from "../src/lib/clientLinkState";
import { intakeShareMessage, signatureShareMessage } from "../src/lib/shareLinks";
import { clientDeliveryContacts } from "../src/lib/clientDeliveryContacts";
import { clientDetailsAnswerPatch, clientDetailsRecordPatch } from "../src/lib/clientDetails";
import { deliveryDashboardFlash } from "../src/lib/dashboardFlash";
import {
  GET as getClientIntakeByToken,
  POST as submitClientIntakeByToken,
} from "../src/app/api/intake/[token]/route";

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

  const correctedClient = clientDetailsSchema.parse({
    fullName: "Sheryl Barber",
    dob: "1962-03-03",
    midNumber: "9469188590",
    recordNumber: "CC-76976",
    email: "sheryl@example.com",
    phone: "(704) 576-2541",
    guardianName: "",
    guardianEmail: "",
    guardianPhone: "",
  });
  const correctedAnswers = clientDetailsAnswerPatch(correctedClient);
  const correctedRecord = clientDetailsRecordPatch(correctedClient);
  assert.equal(correctedAnswers.client_phone_cell, "(704) 576-2541");
  assert.equal(correctedAnswers.client_phone_home, "(704) 576-2541");
  assert.equal(correctedRecord.guardianName, null);
  assert.equal(correctedRecord.email, "sheryl@example.com");
  assert(!clientDetailsSchema.safeParse({ ...correctedClient, phone: "123" }).success);
  ok("dashboard client corrections stay in sync with packet answers");

  assert.equal(deliveryDashboardFlash([], ["sms failed"]), null);
  assert.equal(deliveryDashboardFlash(["email accepted"], [])?.kind, "success");
  assert.equal(deliveryDashboardFlash(["email accepted"], ["sms failed"])?.kind, "warning");
  assert(!deliveryDashboardFlash(["email accepted"], ["sms failed"])?.message.includes("email accepted"));
  ok("successful delivery returns to the dashboard without storing contact details");

  assert(needsStaffAction("SIGNED"), "signed intakes must remain in the staff action queue");
  assert(needsStaffAction("SUBMITTED"), "submitted intakes must remain in the staff action queue");
  assert(!needsStaffAction("IN_PROGRESS"), "in-progress intakes belong in the waiting-on-client queue");
  assert(!needsStaffAction("COMPLETED"), "completed intakes must leave the staff action queue");
  assert.equal(
    buildDashboardReadiness({
      status: "SIGNED",
      missingRequiredCount: 0,
      packetState: "missing",
      hasCca: false,
      expectCca: true,
      hasStaffSignature: false,
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
    }).state,
    "Ready for final staff review",
  );
  assert.equal(
    newIntakeSchema.parse({
      fullName: "Workflow Test",
      dob: "01/01/2000",
      recordNumber: "WORKFLOW-1",
      autoEmailProviderPacket: true,
    }).autoEmailProviderPacket,
    true,
    "new-intake validation must retain provider packet email choice",
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
  const blockedCompletion = buildCompletionReadiness({
    archived: false,
    submittedAt: packetCreatedAt,
    missingRequired: [],
    expectCca: true,
    hasCca: true,
    hasStaffSignature: false,
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
      packetState: "current",
    }).ready,
    true,
  );
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
  ok("client link status, cooldown, and privacy-safe SMS wording");

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

  console.log(`\nAll ${passed} checks passed ✓`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // focused NC Tracks eligibility checks (no DB/network) run as part of `npm test`
    await import("./test-eligibility");
  })
  .catch((e) => { console.error("✗ TEST FAILED:", e.message); prisma.$disconnect(); process.exit(1); });
