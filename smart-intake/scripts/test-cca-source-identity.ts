import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { NextRequest } from "next/server";
import { isolatedSqlite } from "./isolatedSqlite";
import { checkCcaSourceIdentity } from "../src/lib/ccaMedicalNecessity";
import { buildSyntheticCcaPdf, SYNTHETIC_CCA_IDENTITY, syntheticCcaFixture } from "./synthetic-cca-fixture";

async function main() {
  const identity = SYNTHETIC_CCA_IDENTITY;
  const fixture = syntheticCcaFixture();
  assert(checkCcaSourceIdentity(fixture.ccaReview, identity).matches);
  assert(checkCcaSourceIdentity({ sourceClientName: "  SYNTHETIC   E2E INTAKE ", sourceClientDob: "02/03/1991" }, identity).matches);
  assert(!checkCcaSourceIdentity({ ...fixture.ccaReview, sourceClientName: "Other Synthetic Person" }, identity).matches);
  assert.equal(checkCcaSourceIdentity({ ...fixture.ccaReview, sourceClientDob: "" }, identity).code, "CCA_IDENTITY_UNVERIFIED");
  assert.equal(checkCcaSourceIdentity({ ...fixture.ccaReview, sourceClientDob: "1991-02-30" }, identity).code, "CCA_IDENTITY_UNVERIFIED");
  assert(!checkCcaSourceIdentity(fixture.ccaReview, identity, { dob: "1992-02-03" }).matches);

  const database = isolatedSqlite("cca-identity-tests.db");
  database.pushSchema(readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  const previous = { database: process.env.DATABASE_URL, key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  let responseFixture = structuredClone(fixture);
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.url, "/v1/messages"); assert.equal(req.method, "POST");
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.messages[0].content[0].source.media_type, "application/pdf");
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "synthetic-message", type: "message", role: "assistant", model: "synthetic-fixture", stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(responseFixture) }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.DATABASE_URL = database.databaseUrl;
  process.env.ANTHROPIC_API_KEY = "synthetic-loopback-only";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { prisma } = await import("../src/lib/prisma");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { POST: upload } = await import("../src/app/api/intakes/[id]/cca/route");
  const { POST: rescrub } = await import("../src/app/api/intakes/[id]/cca/rescrub/route");
  let storageDirectory = "";
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic CCA Agency", slug: "synthetic-cca-identity" } });
    const user = await prisma.user.create({ data: { name: "Synthetic CCA Tester", email: "cca-tester@example.invalid", passwordHash: "synthetic", role: "master" } });
    bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(user.id) } : undefined });
    const client = await prisma.client.create({ data: { ...identity, email: "synthetic@example.invalid", phone: "2025550101" } });
    const intake = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: "synthetic-cca-token", tokenExpiresAt: new Date("2099-01-01"), contentRevision: 4,
      answers: { create: [{ key: "client_full_name", value: JSON.stringify(identity.fullName) }, { key: "dob", value: JSON.stringify(identity.dob) }, { key: "medications", value: JSON.stringify("Original synthetic answer") }] },
      signatures: { create: { role: "client", printedName: identity.fullName, imageData: "synthetic", signedDate: "2026-09-06", contentRevision: 4 } } } });
    storageDirectory = path.resolve("storage/uploads", intake.id);
    const pdf = await buildSyntheticCcaPdf();
    const context = { params: Promise.resolve({ id: intake.id }) };
    const request = (scan = false) => {
      const form = new FormData(); form.set("overwrite", "true"); form.set("confirmInvalidateSignatures", "true");
      if (!scan) form.set("file", new File([new Uint8Array(pdf)], "synthetic-cca.pdf", { type: "application/pdf" }));
      return new NextRequest(`http://localhost/api/intakes/${intake.id}/cca${scan ? "/rescrub" : ""}`, { method: "POST", body: form });
    };
    const snapshot = async () => ({
      client: await prisma.client.findUniqueOrThrow({ where: { id: client.id } }),
      intake: await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } }),
      answers: await prisma.intakeAnswer.findMany({ where: { intakeId: intake.id }, orderBy: { key: "asc" } }),
      signatures: await prisma.signature.findMany({ where: { intakeId: intake.id } }),
      documents: await prisma.uploadedDocument.findMany({ where: { intakeId: intake.id } }),
      auditCount: await prisma.auditLog.count({ where: { intakeId: intake.id } }),
      files: existsSync(storageDirectory) ? readdirSync(storageDirectory) : [],
    });
    const initial = await snapshot();
    for (const patch of [{ sourceClientName: "Other Synthetic Person" }, { sourceClientDob: "1992-02-03" }, { sourceClientName: "" }, { sourceClientDob: "1991-02-30" }]) {
      responseFixture = { ...structuredClone(fixture), ccaReview: { ...fixture.ccaReview, ...patch } };
      const rejected = await upload(request(), context);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.match((await rejected.json()).code, /^CCA_IDENTITY_/);
      assert.deepEqual(await snapshot(), initial, "Wrong/unverified CCA changes no answers, Client, revision, signatures, documents, files or audits");
    }
    responseFixture = structuredClone(fixture);
    responseFixture.answers = responseFixture.answers.map((answer) => answer.key === "dob" ? { ...answer, value: "1992-02-03" } : answer);
    assert.equal((await upload(request(), context)).status, 409, "Contradictory extracted identity also rejects");
    assert.deepEqual(await snapshot(), initial);
    responseFixture = structuredClone(fixture);
    const accepted = await upload(request(), context);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const afterMatch = await snapshot();
    assert.equal(afterMatch.documents.length, 1); assert.equal(afterMatch.files.length, 1);
    assert(afterMatch.answers.some((answer) => answer.key === "presenting_problem"));
    assert(afterMatch.signatures[0].invalidatedAt, "A matching material import follows the existing re-sign confirmation flow");
    responseFixture = { ...structuredClone(fixture), ccaReview: { ...fixture.ccaReview, sourceClientName: "Wrong Saved Synthetic Person" } };
    const rejectedScan = await rescrub(request(true), context);
    assert.equal(rejectedScan.status, 409);
    assert.deepEqual(await snapshot(), afterMatch, "Rejected rescan preserves the stored review and original attachment too");
    assert.equal(calls, 7);
    console.log("CCA source identity: matching, mismatched, missing, invalid DOB, contradictory extraction and rescan passed with isolated DB and loopback AI only.");
  } finally {
    bindTestCookies(null); await prisma.$disconnect(); await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of [["DATABASE_URL", previous.database], ["ANTHROPIC_API_KEY", previous.key], ["ANTHROPIC_BASE_URL", previous.base]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (storageDirectory && path.dirname(storageDirectory) === path.resolve("storage/uploads")) rmSync(storageDirectory, { recursive: true, force: true });
    database.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
