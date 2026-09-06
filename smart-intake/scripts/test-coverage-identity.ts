import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { bindTestCookies } from "../src/lib/requestCookies";
import { GET, POST } from "../src/app/api/intakes/[id]/eligibility/route";
import { eligibilityIdentityFingerprint } from "../src/lib/eligibilityIdentity";
import { snapshotFromAnswers, snapshotToAnswers } from "../src/lib/eligibilityState";
import { loadAnswers, saveAnswers } from "../src/lib/intakeData";

async function main() {
  assert.match(process.env.DATABASE_URL || "", /coverage-identity-tests\.db$/, "Use an isolated synthetic database.");
  const identity = { fullName: "Synthetic Coverage Client", dob: "1990-01-15", midNumber: "987654321A" };
  const fingerprint = eligibilityIdentityFingerprint(identity);
  assert.equal(fingerprint, eligibilityIdentityFingerprint({ fullName: "  SYNTHETIC   Coverage Client ", dob: "01/15/1990", midNumber: "987654321a" }));
  const snapshotAnswers = snapshotToAnswers({ status: "active", checkedAt: "2026-09-06T00:00:00Z", source: "nctracks_edi", identityFingerprint: fingerprint });
  assert.equal(snapshotFromAnswers(snapshotAnswers, fingerprint).status, "active");
  assert.equal(snapshotFromAnswers({}, fingerprint).status, "not_checked");
  const originalFetch = globalThis.fetch;
  const envKeys = ["NCTRACKS_EDI_URL", "NCTRACKS_SUBMITTER_ID", "NCTRACKS_PROVIDER_NPI"] as const;
  const oldEnv = envKeys.map(key => [key, process.env[key]] as const);
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic coverage agency", slug: "synthetic-coverage" } });
    const staff = await prisma.user.create({ data: { name: "Synthetic staff", email: "coverage@example.invalid", passwordHash: "synthetic-only", memberships: { create: { providerId: provider.id, role: "STAFF" } } } });
    const otherProvider = await prisma.provider.create({ data: { name: "Other synthetic agency", slug: "other-synthetic-coverage" } });
    const outsider = await prisma.user.create({ data: { name: "Synthetic outsider", email: "outsider@example.invalid", passwordHash: "synthetic-only", memberships: { create: { providerId: otherProvider.id, role: "STAFF" } } } });
    const client = await prisma.client.create({ data: { ...identity, providerId: provider.id } });
    const intake = await prisma.intake.create({ data: { clientId: client.id, providerId: provider.id, token: "synthetic-coverage-token", tokenExpiresAt: new Date("2099-01-01") } });
    const params = { params: Promise.resolve({ id: intake.id }) };
    const request = (method: string) => new NextRequest(`http://localhost/api/intakes/${intake.id}/eligibility`, { method });
    const asUser = (id: string | null) => bindTestCookies({ get: key => key === SESSION_COOKIE && id ? { value: createSessionValue(id) } : undefined });
    asUser(null); assert.equal((await GET(request("GET"), params)).status, 401);
    asUser(outsider.id); assert.equal((await GET(request("GET"), params)).status, 404);
    asUser(staff.id);
    await saveAnswers(intake.id, snapshotAnswers);
    const read = async () => (await GET(request("GET"), params)).json();
    assert.equal((await read()).snapshot.status, "active");
    for (const patch of [{ dob: "1991-01-15" }, { fullName: "Different Synthetic Client" }, { midNumber: "OTHER-MID" }]) {
      await prisma.client.update({ where: { id: client.id }, data: { ...identity, ...patch } });
      const changed = await read();
      assert.equal(changed.snapshot.status, "needs_review", "Every subject identity change invalidates the green badge");
      assert.match(changed.message, /changed after this check/);
    }
    await prisma.client.update({ where: { id: client.id }, data: identity });
    await saveAnswers(intake.id, { eligibility_subject_fingerprint: "" });
    assert.equal((await read()).snapshot.status, "needs_review", "Legacy snapshots cannot imply that subject identity was verified");

    process.env.NCTRACKS_EDI_URL = "https://synthetic.invalid/eligibility";
    process.env.NCTRACKS_SUBMITTER_ID = "SYNTHETIC";
    process.env.NCTRACKS_PROVIDER_NPI = "1234567890";
    const unmatchedEdi = readFileSync("test/fixtures/nctracks/271-active.edi", "utf8");
    const edi = unmatchedEdi.replace(/NM1\*IL[^~]*/, "NM1*IL*1*CLIENT*SYNTHETIC*COVERAGE***MI*987654321A")
      .replace(/DMG\*D8\*\d{8}/, "DMG*D8*19900115");
    globalThis.fetch = async () => new Response(edi, { status: 200 });
    assert.equal((await POST(request("POST"), params)).status, 200);
    assert.equal((await read()).snapshot.status, "active", "A fresh matching inquiry restores the verified snapshot");
    assert.equal((await loadAnswers(intake.id)).eligibility_subject_fingerprint, fingerprint);

    await prisma.client.update({ where: { id: client.id }, data: { midNumber: "DIFFERENT" } });
    const mismatch = await (await POST(request("POST"), params)).json();
    assert.equal(mismatch.snapshot.status, "needs_review");
    assert.match(mismatch.message, /returned MID does not match/);
    assert.equal(mismatch.snapshot.memberId, undefined);
    assert.equal(mismatch.snapshot.planName, undefined);
    assert.deepEqual(mismatch.filled, [], "A result for another MID cannot fill packet fields");
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).midNumber, "DIFFERENT");

    await prisma.client.update({ where: { id: client.id }, data: { midNumber: null } });
    await saveAnswers(intake.id, { mid_number: "" });
    globalThis.fetch = async () => new Response(unmatchedEdi, { status: 200 });
    const unmatchedNameOnly = await (await POST(request("POST"), params)).json();
    assert.equal(unmatchedNameOnly.snapshot.status, "needs_review", "A name-only query must not accept another subscriber's response");
    assert.deepEqual(unmatchedNameOnly.filled, []);
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).midNumber, null);
    assert.equal((await loadAnswers(intake.id)).mid_number, "", "Rejected response cannot populate a missing MID");
    globalThis.fetch = async () => new Response(edi, { status: 200 });
    assert.equal((await POST(request("POST"), params)).status, 200);
    assert.equal((await read()).snapshot.status, "active", "A newly returned MID binds to the identity saved in the same transaction");
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).midNumber, identity.midNumber);
    console.log("Coverage identity: real handlers preserve provider scope, reject stale identity and mismatched MID, and bind fresh results atomically (synthetic; no network).");
  } finally {
    bindTestCookies(null);
    globalThis.fetch = originalFetch;
    for (const [key, value] of oldEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
