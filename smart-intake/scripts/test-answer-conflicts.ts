import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { AnswerConflictError, findAnswerConflicts } from "../src/lib/answerRevisions";
import { createAnswerSaveQueue, type SaveableAnswers } from "../src/lib/answerSaveQueue";
import { assertReviewedContentRevision, ContentRevisionConflictError, nextReviewedContentRevision } from "../src/lib/contentRevision";
import { NextRequest } from "next/server";

async function queueConflictChecks() {
  let local: SaveableAnswers = { field: "mine", other: "unchanged" };
  const queue = createAnswerSaveQueue({ field: "original", other: "unchanged" }, { field: 1, other: 1 });
  let requests = 0;
  const conflict = { key: "field", serverValue: "theirs", serverRevision: 2 };
  assert.equal(await queue.save({ readSnapshot: () => local, write: async (patch, revisions) => {
    requests++;
    assert.deepEqual(patch, { field: "mine" });
    assert.deepEqual(revisions, { field: 1 });
    return { ok: false, conflicts: [conflict] };
  } }), false);
  assert.equal(queue.hasUnsavedChanges(local), true);
  assert.equal(await queue.save({ readSnapshot: () => local, write: async () => { requests++; return true; } }), false);
  assert.equal(requests, 1, "Autosave cannot overwrite while a conflict awaits a choice");
  local = queue.resolveConflict("field", "local", local);
  assert.equal(local.field, "mine");
  assert.equal(await queue.save({ readSnapshot: () => local, write: async (patch, revisions) => {
    assert.deepEqual(patch, { field: "mine" });
    assert.deepEqual(revisions, { field: 2 }, "Explicit keep-local retries against the returned revision");
    return { ok: true, answerRevisions: { field: 3 } };
  } }), true);
  local = { ...local, field: "new edit" };
  await queue.save({ readSnapshot: () => local, write: async () => ({ ok: false, conflicts: [{ ...conflict, serverRevision: 4 }] }) });
  local = queue.resolveConflict("field", "server", local);
  assert.equal(local.field, "theirs");
  assert.equal(queue.hasUnsavedChanges(local), false);
}

async function main() {
  assert.equal(nextReviewedContentRevision(2, 2, 3), 3, "Own consecutive save advances the reviewed snapshot");
  assert.equal(nextReviewedContentRevision(2, 3, 4), 2, "An unrelated intervening edit cannot be approved by saving another field");
  assert.equal(nextReviewedContentRevision(2, undefined, 4), 2, "Missing response history cannot approve unseen content");
  assert.throws(() => assertReviewedContentRevision(undefined, 4), ContentRevisionConflictError);
  assert.throws(() => assertReviewedContentRevision(3, 4), ContentRevisionConflictError);
  assert.equal(findAnswerConflicts({ a: "new" }, [{ key: "a", value: '"old"', revision: 2 }], { a: 1 }).length, 1);
  assert.equal(findAnswerConflicts({ a: "new" }, [{ key: "a", value: '"old"', revision: 2 }], undefined).length, 1);
  assert.equal(findAnswerConflicts({ a: "new" }, [], {}).length, 0, "An absent field starts at revision zero");
  await queueConflictChecks();

  // Use an isolated SQLite database with the real schema and transaction code.
  // No production database, message service, or patient data is accessed.
  const testDir = mkdtempSync(join(tmpdir(), "smart-intake-answer-conflicts-"));
  const previousUrl = process.env.DATABASE_URL;
  writeFileSync(join(testDir, "test.db"), "");
  process.env.DATABASE_URL = `file:${join(testDir, "test.db").replace(/\\/g, "/")}`;
  const pushed = spawnSync(process.execPath, [
    join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate",
  ], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);
  const { prisma } = await import("../src/lib/prisma");
  const { saveAnswers, loadAnswerSnapshot } = await import("../src/lib/intakeData");
  try {
    const client = await prisma.client.create({ data: { fullName: "Synthetic Conflict Test", dob: "2000-01-01" } });
    const intake = await prisma.intake.create({ data: {
      clientId: client.id, token: "synthetic-conflict-token", tokenExpiresAt: new Date("2099-01-01"),
    } });
    await saveAnswers(intake.id, { a: "original", b: "original" });
    const first = await loadAnswerSnapshot(intake.id);
    assert.deepEqual(first.answerRevisions, { a: 1, b: 1 });
    const options = { expectedAnswerRevisions: first.answerRevisions, requireExpectedRevisions: true };
    await saveAnswers(intake.id, { a: "staff edit" }, options);
    await assert.rejects(saveAnswers(intake.id, { a: "client edit", b: "must roll back" }, options),
      (error: unknown) => error instanceof AnswerConflictError && error.conflicts[0].serverRevision === 2);
    assert.equal((await loadAnswerSnapshot(intake.id)).answers.b, "original", "A conflict rolls back the entire answer patch");
    await saveAnswers(intake.id, { b: "unrelated edit" }, options);
    assert.equal((await loadAnswerSnapshot(intake.id)).answers.b, "unrelated edit", "Unrelated fields can save from an older page");
    await assert.rejects(saveAnswers(intake.id, { a: "blind overwrite" }, { requireExpectedRevisions: true }), AnswerConflictError);
    await saveAnswers(intake.id, { staff_helper_notes: "note 1" });
    await saveAnswers(intake.id, { staff_helper_notes: "note 2" });
    assert.equal((await loadAnswerSnapshot(intake.id)).answerRevisions.staff_helper_notes, 2, "Nonmaterial answers increment their own revision too");
    const before = await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } });
    await assert.rejects(saveAnswers(intake.id, { a: "still stale" }, options), AnswerConflictError);
    const after = await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } });
    assert.equal(after.contentRevision, before.contentRevision, "Conflicts do not invalidate signatures or change content revision");
    await saveAnswers(intake.id, { a: "client approved edit" }, { expectedAnswerRevisions: { a: 2 }, requireExpectedRevisions: true });
    assert.equal((await loadAnswerSnapshot(intake.id)).answerRevisions.a, 3);
    await saveAnswers(intake.id, { a: "client approved edit" }, options);
    assert.equal((await loadAnswerSnapshot(intake.id)).answerRevisions.a, 3, "A lost-response retry with identical content is idempotent");
    const concurrent = await Promise.allSettled([
      saveAnswers(intake.id, { concurrent: "window one" }, { expectedAnswerRevisions: { concurrent: 0 }, requireExpectedRevisions: true }),
      saveAnswers(intake.id, { concurrent: "window two" }, { expectedAnswerRevisions: { concurrent: 0 }, requireExpectedRevisions: true }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert(concurrent.some((result) => result.status === "rejected" && result.reason instanceof AnswerConflictError), "Concurrent same-field writers must produce a visible conflict");
    const provider = await prisma.provider.create({ data: { name: "Synthetic Signing Provider", slug: "synthetic-signing-provider" } });
    const signer = await prisma.user.create({ data: { name: "Synthetic Signer", email: "signer@example.invalid", passwordHash: "synthetic-no-login", role: "master" } });
    await prisma.intake.update({ where: { id: intake.id }, data: { providerId: provider.id } });
    const { bindTestCookies } = await import("../src/lib/requestCookies");
    const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
    const { POST: sign } = await import("../src/app/api/intakes/[id]/signature/route");
    bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(signer.id) } : undefined });
    try {
      const reviewed = await loadAnswerSnapshot(intake.id);
      await saveAnswers(intake.id, { unseen: "New content in another window" });
      const signRequest = (expectedContentRevision: number | undefined) => sign(new NextRequest(`http://localhost/api/intakes/${intake.id}/signature`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "staff", imageData: "data:image/png;base64,iVBORw0KGgo=", printedName: "Synthetic Signer", signedDate: "09/06/2026", expectedContentRevision }),
      }), { params: Promise.resolve({ id: intake.id }) });
      for (const version of [undefined, reviewed.contentRevision]) {
        const rejected = await signRequest(version);
        assert.equal(rejected.status, 409);
        assert.equal((await rejected.json()).code, "CONTENT_REVISION_CONFLICT");
        assert.equal(await prisma.signature.count({ where: { intakeId: intake.id } }), 0, "Stale staff signing writes no signature");
      }
      const refreshed = await loadAnswerSnapshot(intake.id);
      assert.equal((await signRequest(refreshed.contentRevision)).status, 200);
      assert.equal((await prisma.signature.findFirstOrThrow({ where: { intakeId: intake.id } })).contentRevision, refreshed.contentRevision);
    } finally { bindTestCookies(null); }
    console.log("Answer conflicts: real DB atomic rejection, unrelated edits, revisions, explicit choices, queue pause/retry, and staff signing revision protection passed.");
  } finally {
    await prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    const resolved = resolve(testDir);
    if (resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith("smart-intake-answer-conflicts-")) {
      rmSync(resolved, { recursive: true, force: true });
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
