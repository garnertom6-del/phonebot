import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash, createHmac, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { NextRequest } from "next/server";
import { isolatedSqlite } from "./isolatedSqlite";
import { SECTIONS } from "../src/config/mooreDivineQuestions";
import { askIfSatisfied } from "../src/lib/validation";
import { applyOperationalDefaults } from "../src/lib/answerDefaults";
import type { Answers } from "../src/lib/fillPdf";
import type { FieldMapping } from "../src/config/mooreDivinePacketMap";

/** Real loopback HTTP, a disposable DB, fictional recipients, and generated RSA keys.
 * The transport denies every external host instead of relying on empty secrets. */
async function main() {
  const database = isolatedSqlite("docusign-http-integration.db");
  database.pushSchema(fs.readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  const keys = ["DATABASE_URL", "SESSION_SECRET", "DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY", "DOCUSIGN_BASE_PATH", "DOCUSIGN_CONNECT_SECRET"];
  const previous = keys.map(key => [key, process.env[key]] as const);
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const connectSecret = "synthetic-connect-hmac";
  Object.assign(process.env, { DATABASE_URL: database.databaseUrl, SESSION_SECRET: "synthetic-docusign-http-test-only-secret", DOCUSIGN_INTEGRATION_KEY: "synthetic-integration", DOCUSIGN_USER_ID: "synthetic-user", DOCUSIGN_ACCOUNT_ID: "synthetic-account", DOCUSIGN_PRIVATE_KEY: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), DOCUSIGN_CONNECT_SECRET: connectSecret });
  const requests: Array<{ method: string; path: string; body: any }> = [];
  const envelopes = new Map<string, { payload: any; status: string; pdf: Buffer; transactionId?: string }>();
  let createMode: "ok" | "reject" | "malformed" | "disconnect" = "ok";
  let documentMode: "pdf" | "html" | "truncated" = "pdf";
  let badStatus = false, badToken = false;
  let createEntered: (() => void) | undefined, releaseCreate: Promise<void> | undefined;
  let downloadEntered: (() => void) | undefined, releaseDownload: Promise<void> | undefined;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString(); const route = req.url || "";
      if (route === "/oauth/token") {
        const form = new URLSearchParams(raw), jwt = form.get("assertion")!.split(".");
        assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        assert(verify("RSA-SHA256", Buffer.from(`${jwt[0]}.${jwt[1]}`), rsa.publicKey, Buffer.from(jwt[2], "base64url")));
        const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
        assert.equal(claims.iss, "synthetic-integration"); assert.equal(claims.sub, "synthetic-user"); assert.equal(claims.aud, "account-d.docusign.com"); assert.equal(claims.scope, "signature impersonation");
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(badToken ? {} : { access_token: "synthetic-local-token" })); return;
      }
      assert.equal(req.headers.authorization, "Bearer synthetic-local-token");
      const body = raw ? JSON.parse(raw) : undefined; requests.push({ method: req.method!, path: route, body });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && route.endsWith("/envelopes")) {
        createEntered?.(); if (releaseCreate) await releaseCreate;
        if (createMode === "reject") { res.writeHead(400); res.end(JSON.stringify({ errorCode: "SYNTHETIC_REJECTED" })); return; }
        if (createMode === "malformed") { res.end("{}"); return; }
        if (createMode === "disconnect") { req.socket.destroy(); return; }
        const envelopeId = randomUUID();
        envelopes.set(envelopeId, { payload: body, status: "sent", pdf: Buffer.from(body.documents[0].documentBase64, "base64"), transactionId: body.transactionId });
        res.writeHead(201); res.end(JSON.stringify({ envelopeId, status: "sent" })); return;
      }
      const pathOnly = route.split("?")[0];
      if (req.method === "GET" && pathOnly.endsWith("/envelopes")) {
        const query = new URL(route, "http://127.0.0.1").searchParams;
        const ids = `${query.get("transaction_ids") || query.get("transactionIds") || ""}`.split(",").map(id => id.trim()).filter(Boolean);
        const found = [...envelopes.entries()].filter(([, envelope]) => envelope.transactionId && ids.includes(envelope.transactionId));
        res.end(JSON.stringify({ envelopes: found.map(([envelopeId, envelope]) => ({ envelopeId, status: envelope.status })) })); return;
      }
      const match = /\/envelopes\/([^/]+)(\/documents\/combined)?$/.exec(route); assert(match);
      const envelope = envelopes.get(match[1]); assert(envelope);
      if (match[2]) {
        downloadEntered?.(); if (releaseDownload) await releaseDownload;
        res.setHeader("Content-Type", documentMode === "html" ? "text/html" : "application/pdf");
        res.end(documentMode === "html" ? "<html>synthetic upstream failure</html>" : documentMode === "truncated" ? "%PDF-1.7 truncated" : envelope.pdf); return;
      }
      res.end(JSON.stringify(badStatus ? {} : { envelopeId: match[1], status: envelope.status }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
  process.env.DOCUSIGN_BASE_PATH = `${base}/demo/restapi`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://account-d.docusign.com/oauth/token") return realFetch(`${base}/oauth/token`, init);
    assert(url.startsWith(`${base}/demo/restapi/`), "Test refused an external request");
    return realFetch(input, init);
  };
  const { prisma } = await import("../src/lib/prisma");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { saveAnswers, loadAnswerSnapshot } = await import("../src/lib/intakeData");
  const { loadPreflightSnapshot, recordPreflightReview } = await import("../src/lib/preflightSnapshot");
  const { generationReadinessForIntake } = await import("../src/lib/generationReadiness");
  const { completionReadinessForIntake } = await import("../src/lib/completionReadiness");
  const { POST: send } = await import("../src/app/api/intakes/[id]/docusign/route");
  const { POST: status } = await import("../src/app/api/intakes/[id]/docusign/status/route");
  const { POST: reconcile } = await import("../src/app/api/intakes/[id]/docusign/reconcile/route");
  const { POST: connect } = await import("../src/app/api/webhooks/docusign/route");
  const { GET: copies } = await import("../src/app/api/copies/[token]/packet/route");
  const tag = randomUUID(), templateRoot = path.resolve("storage/docusign-http-tests", tag), intakeIds: string[] = [];
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ2cAAAAASUVORK5CYII=";
  const today = new Date().toISOString().slice(0, 10);
  const post = (handler: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, path = "docusign", body?: unknown) => handler(new NextRequest(`http://localhost/api/intakes/${id}/${path}`, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id }) });
  const expectResponse = async (response: Response, code = 200) => { const body = await response.json(); assert.equal(response.status, code, JSON.stringify(body)); return body; };
  const signedConnect = (payload: unknown, secret = connectSecret) => {
    const raw = JSON.stringify(payload);
    return { raw, request: new NextRequest("http://localhost/api/webhooks/docusign", { method: "POST", headers: { "Content-Type": "application/json", "x-docusign-signature-1": createHmac("sha256", secret).update(raw).digest("base64") }, body: raw }) };
  };
  const creates = () => requests.filter(r => r.method === "POST" && r.path.endsWith("/envelopes"));
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic DocuSign Provider", slug: `docusign-test-${tag}` } });
    const master = await prisma.user.create({ data: { email: `master-${tag}@example.invalid`, name: "Synthetic Signing Staff", role: "master", passwordHash: "synthetic-not-login" } });
    const login = (user = master) => bindTestCookies({ get: key => key === SESSION_COOKIE ? { value: createSessionValue(user.id, user.sessionVersion) } : undefined }); login();
    const template = await PDFDocument.create(), font = await template.embedFont(StandardFonts.Helvetica);
    template.addPage([612, 792]).drawText("SYNTHETIC DOCUSIGN TEST ONLY - NOT A CLINICAL RECORD", { x: 35, y: 750, size: 11, font });
    fs.mkdirSync(templateRoot, { recursive: true }); fs.writeFileSync(path.join(templateRoot, "template.pdf"), await template.save());
    const fields: FieldMapping[] = [
      { fieldKey: "client_name", source: "client_full_name", type: "text", role: "client", y: 700 },
      { fieldKey: "client_signature", source: "signature_client", type: "signature", role: "client", y: 600 },
      { fieldKey: "staff_signature", source: "signature_staff", type: "signature", role: "staff", y: 500 },
      { fieldKey: "hipaa_signature", source: "signature_client", type: "signature", role: "client", y: 400, consentKey: "consent_hipaa", required: false },
      { fieldKey: "roi1_sig", source: "signature_client", type: "signature", role: "client", y: 300, consentKey: "roi1_agreed", required: false },
      { fieldKey: "guardian_signature", source: "signature_guardian", type: "signature", role: "guardian", y: 250 },
      { fieldKey: "signed_date", source: "sign_date", type: "date", role: "client", y: 200 },
      { fieldKey: "guardian_signed_date", source: "sign_date", type: "date", role: "guardian", y: 160 },
    ].map(field => ({ page: 1, x: 35, width: 440, height: 40, required: true, ...field } as FieldMapping));
    await prisma.pdfTemplate.create({ data: { providerId: provider.id, name: "Synthetic DocuSign Template", filePath: `docusign-http-tests/${tag}/template.pdf`, isActive: true, mappingStatus: "APPROVED", mappingScore: 100, approvedAt: new Date(), pageCount: 1, pageWidth: 612, pageHeight: 792, fieldMappings: { create: fields.map(field => ({ fieldKey: field.fieldKey, page: field.page, data: JSON.stringify(field) })) } } });
    const makeCase = async (opts: boolean | { withClient?: boolean; guardian?: boolean; minor?: boolean } = {}) => {
      const withClient = opts === true || (typeof opts === "object" && !!opts.withClient);
      const useGuardian = typeof opts === "object" && !!opts.guardian;
      const minor = typeof opts === "object" && !!opts.minor;
      const client = await prisma.client.create({ data: {
        providerId: provider.id, fullName: "Synthetic DocuSign Client", dob: minor ? "2014-02-03" : "1991-02-03",
        email: "synthetic-docusign@example.invalid", phone: "2025550101",
        guardianName: useGuardian ? "Synthetic Guardian" : null,
        guardianEmail: useGuardian ? "synthetic-guardian@example.invalid" : null,
      } });
      const intake = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: randomUUID(), tokenExpiresAt: new Date("2099-01-01"), expectCca: false, submittedAt: new Date(), status: "SIGNED" } }); intakeIds.push(intake.id);
      let answers: Answers = {};
      for (let pass = 0; pass < 4; pass++) for (const section of SECTIONS) for (const q of section.questions) {
        if ((!q.required && !q.essential) || q.type === "info" || q.type === "heading" || !askIfSatisfied(q.askIf, answers) || answers[q.key] != null && answers[q.key] !== "") continue;
        answers[q.key] = q.type === "consent" ? true : q.type === "yesno" ? (q.options?.includes("No") ? "No" : "Yes") : q.type === "date" ? today : q.type === "phone" ? "2025550102" : q.type === "email" ? "synthetic@example.invalid" : q.type === "chips" ? [q.options?.[0] || "Synthetic selection"] : q.options?.[0] || "Synthetic test answer";
      }
      Object.assign(answers, { client_full_name: client.fullName, dob: client.dob, client_email: client.email, client_phone_cell: client.phone, is_minor_or_incompetent: minor ? "Yes" : "No", guardian_name: useGuardian ? "Synthetic Guardian" : "", guardian_email: useGuardian ? "synthetic-guardian@example.invalid" : "", hipaa_understood: "Yes", consent_hipaa: "Declined acknowledgment", roi_understand_1: "Yes", roi_understand_2: "Yes", roi_understand_3: "Yes", intake_date: today, screening_date: today, initial_assessment_date: today, auto_send_completed_copies: false, auto_email_provider_packet: false, plan_ready_for_client_review: "No" });
      answers = applyOperationalDefaults(answers); await saveAnswers(intake.id, answers);
      const snapshot = await loadAnswerSnapshot(intake.id);
      for (const role of withClient ? ["staff", "client"] : ["staff"]) await prisma.signature.create({ data: { intakeId: intake.id, role, printedName: role === "client" ? client.fullName : master.name, imageData: png, signedDate: today, contentRevision: snapshot.contentRevision } });
      await prisma.auditLog.create({ data: { providerId: provider.id, intakeId: intake.id, userId: master.id, event: "staff_reviewed", detail: `Synthetic review; contentRevision:${snapshot.contentRevision}` } });
      const preflight = await loadPreflightSnapshot(intake.id, provider.id); assert(preflight); await recordPreflightReview(preflight, provider.id, master.id, "Synthetic fixture review");
      let ready = await generationReadinessForIntake(intake.id, provider.id, { allowMissingClientSignature: true }); assert(ready);
      for (const finding of ready.unresolvedPreflight.filter(f => f.severity === "warning")) await prisma.auditLog.create({ data: { providerId: provider.id, intakeId: intake.id, userId: master.id, event: "preflight_overridden", detail: JSON.stringify({ findingKey: finding.key, reason: "Synthetic test fixture intentionally leaves optional fields blank." }) } });
      ready = await generationReadinessForIntake(intake.id, provider.id, { allowMissingClientSignature: true }); assert(ready?.ready, JSON.stringify(ready?.blockers));
      return { intake, client, revision: snapshot.contentRevision };
    };
    const missingClient = await makeCase();
    bindTestCookies({ get: () => undefined }); await expectResponse(await post(send, missingClient.intake.id), 401); await expectResponse(await post(status, missingClient.intake.id), 401); login();
    const reviewer = await prisma.user.create({ data: { name: "Synthetic Reviewer", email: `reviewer-${tag}@example.invalid`, passwordHash: "unused", memberships: { create: { providerId: provider.id, role: "REVIEWER" } } } }); login(reviewer); await expectResponse(await post(send, missingClient.intake.id), 403); await expectResponse(await post(status, missingClient.intake.id), 403); login();
    const otherProvider = await prisma.provider.create({ data: { name: "Other Synthetic Provider", slug: `other-docusign-${tag}` } });
    const other = await prisma.user.create({ data: { name: "Other Synthetic Staff", email: `other-${tag}@example.invalid`, passwordHash: "unused", memberships: { create: { providerId: otherProvider.id, role: "STAFF" } } } }); login(other); await expectResponse(await post(send, missingClient.intake.id), 404); await expectResponse(await post(status, missingClient.intake.id), 404); login(); assert.equal(creates().length, 0);
    const sent = await expectResponse(await post(send, missingClient.intake.id)); const envelope = envelopes.get(sent.envelopeId)!; assert(envelope);
    const payload = envelope.payload; assert.equal(payload.status, "sent"); assert.equal(payload.recipients.signers.length, 1); assert.equal(payload.recipients.signers[0].email, missingClient.client.email); assert.equal(payload.recipients.signers[0].name, missingClient.client.fullName); assert.equal(payload.documents[0].fileExtension, "pdf"); assert.match(payload.emailSubject, /Synthetic DocuSign Provider/); assert.match(payload.transactionId, /^[0-9a-f-]{36}$/); assert((await PDFDocument.load(envelope.pdf)).getPageCount() >= 1);
    const tabs = payload.recipients.signers[0].tabs; assert(tabs.signHereTabs.some((tab: any) => tab.tabLabel === "sign_client_signature")); assert(!tabs.signHereTabs.some((tab: any) => /staff|hipaa|roi1/.test(tab.tabLabel))); assert(tabs.dateSignedTabs.length > 0); assert(tabs.signHereTabs.every((tab: any) => tab.recipientId === "1" && tab.documentId === "1"));
    const sendAudit = await prisma.auditLog.findFirstOrThrow({ where: { intakeId: missingClient.intake.id, event: "docusign_sent" } }); assert.equal(JSON.parse(sendAudit.detail!).contentRevision, missingClient.revision);
    await expectResponse(await post(send, missingClient.intake.id)); assert.equal(creates().length, 1, "Repeated send does not create another envelope");
    for (const remoteStatus of ["sent", "delivered", "declined", "voided"]) { envelope.status = remoteStatus; assert.equal((await expectResponse(await post(status, missingClient.intake.id))).status, remoteStatus); assert.equal(await prisma.generatedPdf.count({ where: { intakeId: missingClient.intake.id } }), 0); }
    assert.equal(await prisma.auditLog.count({ where: { intakeId: missingClient.intake.id, event: "docusign_status" } }), 4);
    badStatus = true; await expectResponse(await post(status, missingClient.intake.id), 502); badStatus = false;
    envelope.status = "completed";
    for (const mode of ["html", "truncated"] as const) { documentMode = mode; await expectResponse(await post(status, missingClient.intake.id), 502); assert.equal(await prisma.generatedPdf.count({ where: { intakeId: missingClient.intake.id } }), 0); assert.equal(await prisma.auditLog.count({ where: { intakeId: missingClient.intake.id, event: "docusign_completed" } }), 0); } documentMode = "pdf";
    const imported = await expectResponse(await post(status, missingClient.intake.id)); assert(imported.blockers.some((b: any) => b.code === "client_signature_missing")); assert.match(imported.message, /in-app|secure intake app/); assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: missingClient.intake.id } })).copyToken, null);
    const packet = await prisma.generatedPdf.findFirstOrThrow({ where: { intakeId: missingClient.intake.id } }); assert.equal(packet.contentRevision, missingClient.revision); assert.equal(packet.sha256, createHash("sha256").update(envelope.pdf).digest("hex")); assert.deepEqual(fs.readFileSync(path.resolve("storage", packet.filePath)), envelope.pdf);
    await Promise.all([post(status, missingClient.intake.id), post(status, missingClient.intake.id)]); assert.equal(await prisma.generatedPdf.count({ where: { intakeId: missingClient.intake.id } }), 1); assert.equal(await prisma.auditLog.count({ where: { intakeId: missingClient.intake.id, event: "docusign_completed" } }), 1);
    const complete = await makeCase(true), completeSent = await expectResponse(await post(send, complete.intake.id)); envelopes.get(completeSent.envelopeId)!.status = "completed";
    await expectResponse(await post(status, complete.intake.id)); const completed = await prisma.intake.findUniqueOrThrow({ where: { id: complete.intake.id } }); assert.equal(completed.status, "COMPLETED"); assert(completed.copyToken); assert((await completionReadinessForIntake(complete.intake.id, provider.id))?.ready);
    const download = await copies(new NextRequest(`http://localhost/api/copies/${completed.copyToken}/packet`), { params: Promise.resolve({ token: completed.copyToken }) }); assert.equal(download.status, 200); assert.match(download.headers.get("Content-Type")!, /pdf/); await expectResponse(await post(status, complete.intake.id)); assert.equal(await prisma.generatedPdf.count({ where: { intakeId: complete.intake.id } }), 1);
    const stale = await makeCase(true), staleSent = await expectResponse(await post(send, stale.intake.id)); envelopes.get(staleSent.envelopeId)!.status = "completed";
    let release!: () => void; releaseDownload = new Promise(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { downloadEntered = resolve; }); const delayed = post(status, stale.intake.id); await entered; await saveAnswers(stale.intake.id, { presenting_problem: "Synthetic change while envelope download was pending" }); release(); await expectResponse(await delayed); downloadEntered = undefined; releaseDownload = undefined;
    const staleState = await prisma.intake.findUniqueOrThrow({ where: { id: stale.intake.id } }); assert.equal(staleState.status, "NEEDS_REVIEW"); assert.equal(staleState.copyToken, null); assert.equal((await completionReadinessForIntake(stale.intake.id, provider.id))?.packetState, "stale");
    const concurrent = await makeCase(); let unlock!: () => void; releaseCreate = new Promise(resolve => { unlock = resolve; }); const createStarted = new Promise<void>(resolve => { createEntered = resolve; }); const first = post(send, concurrent.intake.id); await createStarted; const beforeSecond = creates().length; const second = await expectResponse(await post(send, concurrent.intake.id), 409); assert.equal(second.code, "DOCUSIGN_SEND_PENDING"); assert.equal(creates().length, beforeSecond); unlock(); await expectResponse(await first); createEntered = undefined; releaseCreate = undefined;
    const rejected = await makeCase(); createMode = "reject"; await expectResponse(await post(send, rejected.intake.id), 502); assert.equal(await prisma.auditLog.count({ where: { intakeId: rejected.intake.id, event: "docusign_send_pending" } }), 0); createMode = "ok"; await expectResponse(await post(send, rejected.intake.id));
    for (const mode of ["malformed", "disconnect"] as const) { const uncertain = await makeCase(); createMode = mode; await expectResponse(await post(send, uncertain.intake.id), 409); const count = creates().length; await expectResponse(await post(send, uncertain.intake.id), 409); assert.equal(creates().length, count); assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: uncertain.intake.id } })).docusignEnvelopeId, null); } createMode = "ok";
    const authFailure = await makeCase(); badToken = true; const count = creates().length; await expectResponse(await post(send, authFailure.intake.id), 502); badToken = false; assert.equal(creates().length, count); await expectResponse(await post(send, authFailure.intake.id));

    const guardianOnly = await makeCase({ guardian: true, minor: true });
    const guardianSent = await expectResponse(await post(send, guardianOnly.intake.id));
    const guardianEnvelope = envelopes.get(guardianSent.envelopeId)!;
    assert.equal(guardianEnvelope.payload.recipients.signers.length, 1);
    assert.equal(guardianEnvelope.payload.recipients.signers[0].email, "synthetic-guardian@example.invalid");
    assert.equal(guardianEnvelope.payload.recipients.signers[0].name, "Synthetic Guardian");
    assert.equal(guardianEnvelope.payload.recipients.signers[0].routingOrder, "1");
    assert(guardianEnvelope.payload.recipients.signers[0].tabs.signHereTabs.some((tab: any) => tab.tabLabel === "sign_client_signature"));
    assert(guardianEnvelope.payload.recipients.signers[0].tabs.signHereTabs.some((tab: any) => tab.tabLabel === "sign_guardian_signature"));
    assert(!guardianEnvelope.payload.recipients.signers[0].tabs.signHereTabs.some((tab: any) => /staff/.test(tab.tabLabel)));

    const both = await makeCase({ guardian: true });
    const bothSent = await expectResponse(await post(send, both.intake.id));
    const bothEnvelope = envelopes.get(bothSent.envelopeId)!;
    assert.equal(bothEnvelope.payload.recipients.signers.length, 2);
    assert.equal(bothEnvelope.payload.recipients.signers[0].email, both.client.email);
    assert.equal(bothEnvelope.payload.recipients.signers[0].routingOrder, "1");
    assert.equal(bothEnvelope.payload.recipients.signers[1].email, "synthetic-guardian@example.invalid");
    assert.equal(bothEnvelope.payload.recipients.signers[1].routingOrder, "2");
    const clientTabs = bothEnvelope.payload.recipients.signers[0].tabs.signHereTabs;
    const guardianTabs = bothEnvelope.payload.recipients.signers[1].tabs.signHereTabs;
    assert(clientTabs.some((tab: any) => tab.tabLabel === "sign_client_signature" && tab.recipientId === "1"));
    assert(!clientTabs.some((tab: any) => tab.tabLabel === "sign_guardian_signature"));
    assert(guardianTabs.some((tab: any) => tab.tabLabel === "sign_guardian_signature" && tab.recipientId === "2"));
    assert(!guardianTabs.some((tab: any) => tab.tabLabel === "sign_client_signature"));
    assert(![...clientTabs, ...guardianTabs].some((tab: any) => /staff/.test(tab.tabLabel)));

    const missingGuardianEmail = await makeCase({ minor: true });
    await prisma.client.update({ where: { id: missingGuardianEmail.client.id }, data: { guardianName: "Synthetic Guardian Without Email", guardianEmail: null } });
    const missingGuardian = await expectResponse(await post(send, missingGuardianEmail.intake.id), 400);
    assert.match(missingGuardian.error, /guardian email/i);
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: missingGuardianEmail.intake.id } })).docusignEnvelopeId, null);

    const hookCase = await makeCase();
    const hookSent = await expectResponse(await post(send, hookCase.intake.id));
    envelopes.get(hookSent.envelopeId)!.status = "completed";
    const validHook = signedConnect({ event: "envelope-completed", data: { accountId: "synthetic-account", envelopeId: hookSent.envelopeId, envelopeSummary: { status: "completed" } } });
    const hooked = await expectResponse(await connect(validHook.request));
    assert.equal(hooked.status, "completed");
    assert.equal(await prisma.generatedPdf.count({ where: { intakeId: hookCase.intake.id } }), 1);
    assert.equal((await prisma.generatedPdf.findFirstOrThrow({ where: { intakeId: hookCase.intake.id } })).contentRevision, hookCase.revision);
    const replay = await expectResponse(await connect(signedConnect({ event: "envelope-completed", data: { accountId: "synthetic-account", envelopeId: hookSent.envelopeId, envelopeSummary: { status: "completed" } } }).request));
    assert.equal(replay.status, "completed");
    assert.equal(await prisma.generatedPdf.count({ where: { intakeId: hookCase.intake.id } }), 1);
    const unknown = await expectResponse(await connect(signedConnect({ event: "envelope-completed", data: { accountId: "synthetic-account", envelopeId: randomUUID(), envelopeSummary: { status: "completed" } } }).request));
    assert.equal(unknown.ignored, true);
    const badSig = signedConnect({ event: "envelope-completed", data: { envelopeId: hookSent.envelopeId, envelopeSummary: { status: "completed" } } }, "wrong-secret");
    await expectResponse(await connect(badSig.request), 403);
    const otherAccount = signedConnect({ event: "envelope-completed", data: { accountId: "other-account", envelopeId: hookSent.envelopeId, envelopeSummary: { status: "completed" } } });
    await expectResponse(await connect(otherAccount.request), 403);
    const previousSecret = process.env.DOCUSIGN_CONNECT_SECRET;
    delete process.env.DOCUSIGN_CONNECT_SECRET;
    await expectResponse(await connect(signedConnect({ event: "envelope-sent", data: { envelopeId: hookSent.envelopeId, envelopeSummary: { status: "sent" } } }).request), 503);
    process.env.DOCUSIGN_CONNECT_SECRET = previousSecret;
    envelopes.get(hookSent.envelopeId)!.status = "delivered";
    assert.equal((await expectResponse(await post(status, hookCase.intake.id))).status, "delivered");

    const pendingCase = await makeCase();
    const transactionId = randomUUID();
    const recoveredId = randomUUID();
    await prisma.auditLog.create({ data: { providerId: provider.id, intakeId: pendingCase.intake.id, userId: master.id, event: "docusign_send_pending", detail: JSON.stringify({ transactionId, contentRevision: pendingCase.revision }) } });
    await prisma.intake.update({ where: { id: pendingCase.intake.id }, data: { contentRevision: pendingCase.revision + 3 } });
    envelopes.set(recoveredId, { payload: { transactionId }, status: "sent", pdf: Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj"), transactionId });
    login(reviewer); await expectResponse(await post(reconcile, pendingCase.intake.id, "docusign/reconcile", { action: "lookup" }), 403); login();
    login(other); await expectResponse(await post(reconcile, pendingCase.intake.id, "docusign/reconcile", { action: "lookup" }), 404); login();
    const lookedUp = await expectResponse(await post(reconcile, pendingCase.intake.id, "docusign/reconcile", { action: "lookup" }));
    assert.equal(lookedUp.envelopeId, recoveredId);
    const attached = await expectResponse(await post(reconcile, pendingCase.intake.id, "docusign/reconcile", { action: "attach" }));
    assert.equal(attached.envelopeId, recoveredId);
    assert.equal(attached.contentRevision, pendingCase.revision);
    const recovered = await prisma.intake.findUniqueOrThrow({ where: { id: pendingCase.intake.id } });
    assert.equal(recovered.docusignEnvelopeId, recoveredId);
    const sentAudit = await prisma.auditLog.findFirstOrThrow({ where: { intakeId: pendingCase.intake.id, event: "docusign_sent" } });
    assert.equal(JSON.parse(sentAudit.detail!).contentRevision, pendingCase.revision);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: pendingCase.intake.id, event: "docusign_send_pending" } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: pendingCase.intake.id, event: "docusign_reconcile_attached" } }), 1);
    const createsAfterAttach = creates().length;
    const { sendIntakeToDocuSign } = await import("../src/lib/sendDocuSign");
    const alreadyAttached = await sendIntakeToDocuSign({ intakeId: pendingCase.intake.id, providerId: provider.id, userId: master.id });
    assert.equal(alreadyAttached.status, "already_sent");
    assert.equal("envelopeId" in alreadyAttached ? alreadyAttached.envelopeId : "", recoveredId);
    assert.equal(creates().length, createsAfterAttach, "Reconcile attach does not create another envelope");

    const failCase = await makeCase();
    await prisma.auditLog.create({ data: { providerId: provider.id, intakeId: failCase.intake.id, userId: master.id, event: "docusign_send_pending", detail: JSON.stringify({ transactionId: randomUUID(), contentRevision: failCase.revision }) } });
    const marked = await expectResponse(await post(reconcile, failCase.intake.id, "docusign/reconcile", { action: "mark_failed" }));
    assert.equal(marked.status, "marked_failed");
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: failCase.intake.id } })).docusignEnvelopeId, null);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: failCase.intake.id, event: "docusign_send_pending" } }), 0);
    await expectResponse(await post(send, failCase.intake.id));

    assert.equal(await prisma.messageDelivery.count(), 0, "No email or SMS delivery transport is called by fixture cases");
    console.log("DocuSign HTTP integration passed: JWT, provider/read-only guards, actual recipient/document/tab payload, preserved consent decline, guardian and client-then-guardian recipients, duplicate and uncertain-send protection, sent/delivered/declined/voided audit, Connect webhook import, pending reconcile, invalid response/PDF rejection, completed import/hash/idempotency, protected copies, missing in-app signature gate, and content-change race. All network traffic was loopback; no real envelope was sent.");
  } finally {
    bindTestCookies(null); globalThis.fetch = realFetch; await prisma.$disconnect(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    const targets = [templateRoot, ...intakeIds.map(id => path.resolve("storage/generated", id))];
    for (const target of targets) { assert([path.resolve("storage/docusign-http-tests"), path.resolve("storage/generated")].includes(path.dirname(target))); fs.rmSync(target, { recursive: true, force: true }); }
    database.cleanup();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
