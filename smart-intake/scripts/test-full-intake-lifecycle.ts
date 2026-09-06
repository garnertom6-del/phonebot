import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { NextRequest } from "next/server";
import { isolatedSqlite } from "./isolatedSqlite";
import { buildSyntheticCcaPdf, syntheticCcaFixture, SYNTHETIC_CCA_IDENTITY } from "./synthetic-cca-fixture";
import { startSyntheticCcaServer, SYNTHETIC_ANTHROPIC_KEY } from "./synthetic-cca-server";
import { SECTIONS, CLIENT_ANSWER_KEYS } from "../src/config/mooreDivineQuestions";
import { askIfSatisfied, missingRequired, missingOptional } from "../src/lib/validation";
import { applyOperationalDefaults } from "../src/lib/answerDefaults";
import type { Answers } from "../src/lib/fillPdf";
import type { FieldMapping } from "../src/config/mooreDivinePacketMap";

async function main() {
  const database = isolatedSqlite("full-intake-lifecycle-tests.db");
  database.pushSchema(readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  const today = new Date().toISOString().slice(0, 10), tag = randomUUID();
  const fixturePath = path.join(database.directory, "synthetic-e2e-cca-response.json");
  const ccaPdf = await buildSyntheticCcaPdf(today);
  await fs.writeFile(path.join(database.directory, "synthetic-e2e-cca.pdf"), ccaPdf);
  await fs.writeFile(fixturePath, JSON.stringify(syntheticCcaFixture(today)));
  const fixture = await startSyntheticCcaServer(fixturePath);
  const previousEnv = ["DATABASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"].map((key) => [key, process.env[key]] as const);
  process.env.DATABASE_URL = database.databaseUrl;
  process.env.ANTHROPIC_API_KEY = SYNTHETIC_ANTHROPIC_KEY;
  process.env.ANTHROPIC_BASE_URL = fixture.url;
  const realFetch = globalThis.fetch;
  const outbound: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert(url.startsWith(`${fixture.url}/`), "Lifecycle test must never contact an external service");
    outbound.push(url); return realFetch(input, init);
  };
  const { prisma } = await import("../src/lib/prisma");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { SELECTED_PROVIDER_COOKIE } = await import("../src/lib/staffGuard");
  const { loadAnswerSnapshot } = await import("../src/lib/intakeData");
  const { generationReadinessForIntake } = await import("../src/lib/generationReadiness");
  const { completionReadinessForIntake } = await import("../src/lib/completionReadiness");
  const { extractPdfText } = await import("../src/lib/pdfText");
  const { prepareCompletedCopyLink } = await import("../src/lib/completedCopyLink");
  const { POST: create } = await import("../src/app/api/intakes/route");
  const { PATCH: staffPatch } = await import("../src/app/api/intakes/[id]/route");
  const { PATCH: copiesSettings } = await import("../src/app/api/intakes/[id]/copies/settings/route");
  const { POST: ccaUpload } = await import("../src/app/api/intakes/[id]/cca/route");
  const { GET: clientGet, PATCH: clientPatch, POST: submit } = await import("../src/app/api/intake/[token]/route");
  const { POST: clientSign } = await import("../src/app/api/intake/[token]/signature/route");
  const { POST: staffSign } = await import("../src/app/api/intakes/[id]/signature/route");
  const { POST: preflight } = await import("../src/app/api/intakes/[id]/preflight/route");
  const { POST: generate } = await import("../src/app/api/intakes/[id]/generate/route");
  const { GET: copyPacket } = await import("../src/app/api/copies/[token]/packet/route");
  const templateRoot = path.resolve("storage/lifecycle-tests", tag);
  let intakeId = "";
  const request = (pathname: string, method = "POST", body?: unknown) => new NextRequest(`http://localhost:3097${pathname}`, {
    method, ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const success = async (response: Response, label: string) => { const body = await response.json(); assert.equal(response.status, 200, `${label}: ${JSON.stringify(body)}`); return body; };
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic Lifecycle Provider", slug: `synthetic-lifecycle-${tag}` } });
    const user = await prisma.user.create({ data: { name: "Synthetic Lifecycle Staff", email: `lifecycle-${tag}@example.invalid`, passwordHash: "synthetic-not-login", role: "master" } });
    bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(user.id) } : key === SELECTED_PROVIDER_COOKIE ? { value: provider.id } : undefined });
    // Test-only approved blank form, unrelated to real provider paperwork.
    const template = await PDFDocument.create(); const font = await template.embedFont(StandardFonts.Helvetica);
    const page = template.addPage([612, 792]); page.drawText("SYNTHETIC INTAKE PACKET - TEST ONLY", { x: 40, y: 750, size: 16, font });
    await fs.mkdir(templateRoot, { recursive: true });
    await fs.writeFile(path.join(templateRoot, "template.pdf"), await template.save());
    const mappings: FieldMapping[] = [
      ["name", "client_full_name", "text", 700, "client"], ["dob", "dob", "date", 670, "client"],
      ["client_signature", "signature_client", "signature", 600, "client"], ["staff_signature", "signature_staff", "signature", 530, "staff"],
    ].map(([fieldKey, source, type, y, role]) => ({ fieldKey, source, type, y, role, page: 1, x: 40, width: 480, height: 45, fontSize: 12, lines: 1, lineHeight: 14, required: true, consentKey: null, notes: "Synthetic lifecycle test mapping" } as FieldMapping));
    await prisma.pdfTemplate.create({ data: { providerId: provider.id, name: `Synthetic Lifecycle Template ${tag}`, filePath: `lifecycle-tests/${tag}/template.pdf`, originalFileName: "synthetic-lifecycle.pdf", pageCount: 1, pageWidth: 612, pageHeight: 792,
      isActive: true, mappingStatus: "APPROVED", mappingScore: 100, approvedAt: new Date(), approvedByUserId: user.id,
      fieldMappings: { create: mappings.map((mapping) => ({ fieldKey: mapping.fieldKey, page: mapping.page, data: JSON.stringify(mapping) })) } } });
    const created = await success(await create(request("/api/intakes", "POST", { providerId: provider.id, ...SYNTHETIC_CCA_IDENTITY, recordNumber: `SYNTHETIC-${tag}`, phone: "2025550101", email: "synthetic-e2e@example.invalid", intakeDate: today, providerChoicePlan: "Healthy Blue", expectCca: true, autoEmailProviderPacket: false })), "create");
    intakeId = created.id;
    const context = { params: Promise.resolve({ id: intakeId }) };
    const intake = await prisma.intake.findUniqueOrThrow({ where: { id: intakeId } });
    const publicContext = { params: Promise.resolve({ token: intake.token }) };
    const publicPath = `/api/intake/${intake.token}`;
    await success(await copiesSettings(request(`/api/intakes/${intakeId}/copies/settings`, "PATCH", { autoSend: false, autoEmailProvider: false }), context), "disable delivery");
    assert.equal((await generate(request(`/api/intakes/${intakeId}/generate`), context)).status, 409, "Generation is blocked before source, consent and signatures");
    const form = new FormData(); form.set("file", new File([new Uint8Array(ccaPdf)], "synthetic-e2e-cca.pdf", { type: "application/pdf" }));
    await success(await ccaUpload(request(`/api/intakes/${intakeId}/cca`, "POST", form), context), "CCA upload");
    const initial = await loadAnswerSnapshot(intakeId);
    let answers: Answers = { ...initial.answers };
    for (let pass = 0; pass < 4; pass++) for (const section of SECTIONS) for (const q of section.questions) {
      if ((!q.required && !q.essential) || q.type === "info" || q.type === "heading" || !askIfSatisfied(q.askIf, answers) || answers[q.key] != null && answers[q.key] !== "") continue;
      answers[q.key] = q.type === "consent" ? true : q.type === "yesno" ? (q.options?.includes("No") ? "No" : "Yes")
        : q.type === "date" ? today : q.type === "phone" ? "2025550102" : q.type === "email" ? "synthetic@example.invalid"
          : q.type === "chips" ? [q.options?.[0] || "Synthetic test selection"] : q.options?.[0] || "Synthetic test answer";
    }
    Object.assign(answers, {
      hipaa_understood: "Yes", roi_understand_1: "Yes", roi_understand_2: "Yes", roi_understand_3: "Yes",
      client_full_name: SYNTHETIC_CCA_IDENTITY.fullName, dob: SYNTHETIC_CCA_IDENTITY.dob,
      client_email: "synthetic-e2e@example.invalid", client_phone_cell: "2025550101", ec1_name: "Synthetic Emergency Contact", ec1_cell_phone: "2025550102",
      record_number: `SYNTHETIC-${tag}`, is_minor_or_incompetent: "No", intake_date: today, screening_date: today, initial_assessment_date: today,
      auto_send_completed_copies: false, auto_email_provider_packet: false, plan_ready_for_client_review: "No",
      pcp_name: "Synthetic Test PCP", pcp_phone: "2025550103", pcp_address: "200 Synthetic Test Way", preferred_emergency_facility: "Synthetic Test Facility", dis_pcp_plan: "Synthetic test follow-up",
      crisis_warning_signs: "Synthetic warning", crisis_steps: "Synthetic response", crisis_supports: "Synthetic support", dis_crisis_contact: "Synthetic Emergency Contact", dis_crisis_phone: "2025550102",
      pcp_plan_source: "staff", crisis_plan_source: "staff", pcp_plan_date: today, crisis_plan_date: today,
    });
    // Resolve remaining staff-checklist blanks from explicit synthetic values.
    for (const missing of missingOptional(answers)) if (!answers[missing.key]) answers[missing.key] = missing.key.includes("phone") ? "2025550102" : missing.key.includes("date") ? today : "Synthetic staff test answer";
    answers = applyOperationalDefaults(answers);
    const consentAnswers = Object.fromEntries(Object.entries(answers).filter(([key]) => CLIENT_ANSWER_KEYS.has(key) && (key.startsWith("consent_") || key.startsWith("roi_understand_") || key === "hipaa_understood")));
    const staffAnswers = Object.fromEntries(Object.entries(answers).filter(([key]) => !(key in consentAnswers)));
    await success(await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { answers: staffAnswers, expectedAnswerRevisions: initial.answerRevisions }), context), "staff source answers");
    const beforeConsent = await loadAnswerSnapshot(intakeId);
    await success(await clientPatch(request(publicPath, "PATCH", { answers: consentAnswers, expectedAnswerRevisions: beforeConsent.answerRevisions }), publicContext), "client consents");
    const viewed = await success(await clientGet(request(publicPath, "GET"), publicContext), "review public snapshot");
    assert.equal(missingRequired(viewed.answers, true, provider).length, 0, "Every applicable client requirement has a synthetic response");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2cAAAAASUVORK5CYII=";
    await success(await clientSign(request(`${publicPath}/signature`, "POST", { role: "client", imageData: png, printedName: SYNTHETIC_CCA_IDENTITY.fullName, relationship: "client", signedDate: today, dobCheck: "02/03/1991", expectedContentRevision: viewed.contentRevision }), publicContext), "client signature");
    await success(await submit(request(publicPath), publicContext), "client submit");
    const staffReviewedSnapshot = await loadAnswerSnapshot(intakeId);
    await success(await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { answers: {}, expectedAnswerRevisions: {}, recordStaffReview: true, expectedContentRevision: staffReviewedSnapshot.contentRevision }), context), "staff review");
    const preflightResult = await success(await preflight(request(`/api/intakes/${intakeId}/preflight`), context), "preflight");
    assert(preflightResult.aiUsed, "Local fixture adapter exercised preflight response handling");
    assert(!preflightResult.findings.some((finding: { severity: string }) => finding.severity === "error" || finding.severity === "warning"), JSON.stringify(preflightResult.findings));
    let readiness = await generationReadinessForIntake(intakeId, provider.id);
    assert.deepEqual(readiness?.blockers.map((blocker) => blocker.code), ["staff_signature_missing"]);
    await success(await staffSign(request(`/api/intakes/${intakeId}/signature`, "POST", { role: "staff", imageData: png, printedName: user.name, signedDate: today, expectedContentRevision: readiness!.contentRevision }), context), "QP signature");
    readiness = await generationReadinessForIntake(intakeId, provider.id); assert(readiness?.ready, JSON.stringify(readiness?.blockers));
    await success(await generate(request(`/api/intakes/${intakeId}/generate`), context), "generate completed packet");
    const generated = await prisma.generatedPdf.findFirstOrThrow({ where: { intakeId }, orderBy: { packetVersion: "desc" } });
    const bytes = await fs.readFile(path.resolve("storage", generated.filePath));
    assert((await PDFDocument.load(bytes)).getPageCount() >= 2);
    assert((await extractPdfText(bytes)).includes(SYNTHETIC_CCA_IDENTITY.fullName));
    assert((await completionReadinessForIntake(intakeId, provider.id))?.ready);
    const completed = await success(await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { status: "COMPLETED" }), context), "mark completed");
    assert(completed.completionDelivery.clientCopies.skipped); assert(completed.completionDelivery.providerPacket.skipped);
    const copy = await prepareCompletedCopyLink(intakeId, provider.id, request(`/api/intakes/${intakeId}/copies/link`));
    const copyToken = new URL(copy.link).pathname.split("/").at(-1)!;
    const copyContext = { params: Promise.resolve({ token: copyToken }) };
    assert.equal((await copyPacket(request(`/api/copies/${copyToken}/packet`, "GET"), copyContext)).status, 200);
    const completedSnapshot = await loadAnswerSnapshot(intakeId);
    const completedSignatures = await prisma.signature.findMany({ where: { intakeId }, orderBy: { role: "asc" } });
    await success(await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { answers: {}, expectedAnswerRevisions: {}, recordStaffReview: true, expectedContentRevision: completedSnapshot.contentRevision }), context), "review unchanged completed packet");
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intakeId } })).status, "COMPLETED");
    assert.deepEqual(await loadAnswerSnapshot(intakeId), completedSnapshot);
    assert.deepEqual(await prisma.signature.findMany({ where: { intakeId }, orderBy: { role: "asc" } }), completedSignatures, "A no-op review preserves captured signatures");
    assert((await completionReadinessForIntake(intakeId, provider.id))?.ready);
    assert.equal((await copyPacket(request(`/api/copies/${copyToken}/packet`, "GET"), copyContext)).status, 200, "Unchanged completed-case review preserves the existing protected copy URL");
    assert.equal(await prisma.messageDelivery.count({ where: { intakeId } }), 0);
    assert(outbound.length >= 2 && outbound.every((url) => url.startsWith(fixture.url)), "Only local fixture requests occurred");
    const beforeEdit = await loadAnswerSnapshot(intakeId);
    await success(await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { answers: { presenting_problem: "Synthetic changed answer after completion" }, expectedAnswerRevisions: beforeEdit.answerRevisions }), context), "changed answer");
    const changed = await completionReadinessForIntake(intakeId, provider.id);
    assert.equal(changed?.ready, false);
    assert(changed?.blockers.some((blocker) => blocker.code === "client_signature_invalid"));
    assert(changed?.blockers.some((blocker) => blocker.code === "staff_signature_invalid"));
    assert.equal(changed?.packetState, "stale");
    await assert.rejects(() => prepareCompletedCopyLink(intakeId, provider.id, request(`/api/intakes/${intakeId}/copies/link`)));
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intakeId } })).status, "NEEDS_REVIEW");
    assert.equal((await copyPacket(request(`/api/copies/${copyToken}/packet`, "GET"), copyContext)).status, 404, "The old copy URL cannot serve a packet after the case returns to review");
    assert.equal((await staffPatch(request(`/api/intakes/${intakeId}`, "PATCH", { status: "COMPLETED" }), context)).status, 409);
    console.log("Full synthetic lifecycle passed: create, CCA, required answers/consents, reviewed signatures, submit, staff review, preflight, generation, completion, protected copies, and changed-answer invalidation. No external messages or services.");
  } finally {
    bindTestCookies(null); globalThis.fetch = realFetch; await prisma.$disconnect();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    for (const [key, value] of previousEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const target of [templateRoot, ...(intakeId ? [path.resolve("storage/uploads", intakeId), path.resolve("storage/generated", intakeId)] : [])]) {
      const allowedParent = [path.resolve("storage/lifecycle-tests"), path.resolve("storage/uploads"), path.resolve("storage/generated")];
      assert(allowedParent.includes(path.dirname(target))); await fs.rm(target, { recursive: true, force: true });
    }
    database.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
