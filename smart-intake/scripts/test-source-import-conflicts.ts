import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { AnswerConflictError } from "../src/lib/answerRevisions";

async function main() {
  const testDir = mkdtempSync(join(tmpdir(), "smart-intake-source-conflicts-"));
  const previousUrl = process.env.DATABASE_URL;
  writeFileSync(join(testDir, "test.db"), "");
  process.env.DATABASE_URL = `file:${join(testDir, "test.db").replace(/\\/g, "/")}`;
  const pushed = spawnSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);
  const { prisma } = await import("../src/lib/prisma");
  const { loadAnswerSnapshot, saveAnswers, saveAnswerSnapshotChanges } = await import("../src/lib/intakeData");
  const { applyCcaAnswers } = await import("../src/lib/ccaApply");
  const { applyNcTracksResult } = await import("../src/lib/ncTracksLookup");
  try {
    const client = await prisma.client.create({ data: { fullName: "Synthetic Source Test", dob: "2000-01-01", email: "old@example.invalid", phone: "9195550101" } });
    const intake = await prisma.intake.create({ data: { clientId: client.id, token: "synthetic-source-token", tokenExpiresAt: new Date("2099-01-01") } });
    await saveAnswers(intake.id, { client_email: "old@example.invalid", client_phone_cell: "9195550101", medications: "Original medicine" });

    const scanStart = await loadAnswerSnapshot(intake.id);
    await saveAnswerSnapshotChanges(intake.id, scanStart, { client_phone_cell: "9195550102" }, { syncClient: true });
    await prisma.signature.create({ data: { intakeId: intake.id, role: "client", imageData: "synthetic", printedName: client.fullName, signedDate: "2026-09-06" } });
    await assert.rejects(applyCcaAnswers({
      intakeId: intake.id, clientId: client.id, baseline: scanStart, overwrite: true, confirmInvalidateSignatures: true,
      extracted: { client_phone_cell: "9195550103", client_email: "document@example.invalid" },
    }), AnswerConflictError);
    const afterConflict = await loadAnswerSnapshot(intake.id);
    assert.equal(afterConflict.answers.client_phone_cell, "9195550102", "A delayed CCA cannot replace a human edit to the same field");
    assert.equal(afterConflict.answers.client_email, "old@example.invalid", "A conflict rolls back every extracted field");
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).phone, "9195550102");
    assert.equal((await prisma.signature.findFirstOrThrow({ where: { intakeId: intake.id } })).invalidatedAt, null, "Rejected imports must preserve signatures");

    const separateStart = await loadAnswerSnapshot(intake.id);
    await saveAnswerSnapshotChanges(intake.id, separateStart, { medications: "Staff updated medicine", client_email: "" }, { syncClient: true });
    await applyCcaAnswers({
      intakeId: intake.id, clientId: client.id, baseline: separateStart, overwrite: true, confirmInvalidateSignatures: true,
      extracted: { client_phone_cell: "9195550104" },
    });
    const afterCca = await loadAnswerSnapshot(intake.id);
    assert.equal(afterCca.answers.medications, "Staff updated medicine", "A source import never writes unrelated values from its old snapshot");
    assert.equal(afterCca.answers.client_email, "");
    const afterClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    assert.equal(afterClient.email, null, "A cleared delivery contact is not resurrected by a delayed source import");
    assert.equal(afterClient.phone, "9195550104", "Accepted extracted contact changes sync with the Client record");

    const lookupStart = await loadAnswerSnapshot(intake.id);
    const lookupResult = applyNcTracksResult(lookupStart.answers, { mco: "Alliance", pcp_name: "Synthetic PCP" }).next;
    await saveAnswers(intake.id, { mco: "Vaya" });
    await assert.rejects(saveAnswerSnapshotChanges(intake.id, lookupStart, lookupResult, { syncClient: true }), AnswerConflictError);
    const afterLookup = await loadAnswerSnapshot(intake.id);
    assert.equal(afterLookup.answers.mco, "Vaya");
    assert.equal(afterLookup.answers.pcp_name, undefined, "Conflicted coverage imports do not partially apply their remaining result");
    const identityStart = await loadAnswerSnapshot(intake.id);
    const identity = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    await prisma.client.update({ where: { id: client.id }, data: { dob: "2001-01-01" } });
    await assert.rejects(saveAnswerSnapshotChanges(intake.id, identityStart, { mco: "Alliance" }, { syncClient: true, expectedClientIdentity: identity }), AnswerConflictError);
    assert.equal((await loadAnswerSnapshot(intake.id)).answers.mco, "Vaya", "A lookup for an identity changed during its request cannot attach coverage to the new identity");
    await assert.rejects(applyCcaAnswers({
      intakeId: intake.id, clientId: client.id, baseline: identityStart, expectedClientIdentity: identity, overwrite: false,
      extracted: {},
    }), AnswerConflictError, "Even a CCA with no new answer fields must validate its starting identity before attachment");
    console.log("Source imports: real DB CCA/NCTracks conflicts, atomic rejection, unrelated edits, contact sync and signature preservation passed.");
  } finally {
    await prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    const resolved = resolve(testDir);
    if (resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith("smart-intake-source-conflicts-")) rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
