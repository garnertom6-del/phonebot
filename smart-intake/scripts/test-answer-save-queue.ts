import assert from "node:assert/strict";
import { createAnswerSaveQueue, type SaveableAnswers } from "../src/lib/answerSaveQueue";

async function main() {
  let current: SaveableAnswers = { answer: "initial" };
  const queue = createAnswerSaveQueue(current);
  const writes: SaveableAnswers[] = [];
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  current = { answer: "A" };
  const first = queue.save({ readSnapshot: () => current, write: async (patch) => { writes.push(patch); await slow; return true; } });
  await Promise.resolve();
  current = { answer: "B" };
  const second = queue.save({ readSnapshot: () => current, write: async (patch) => { writes.push(patch); return true; } });
  await Promise.resolve();
  assert.equal(writes.length, 1, "A delayed request must block later network writes");
  current = { answer: "initial" }; // User reverses their edit while the first save is pending.
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(writes, [{ answer: "A" }, { answer: "initial" }], "Queued saves must read the latest answer when they begin");
  assert.equal(queue.hasUnsavedChanges(current), false);

  current = { answer: "retry me" };
  assert.equal(await queue.save({ readSnapshot: () => current, write: async () => false }), false);
  assert.equal(queue.hasUnsavedChanges(current), true, "Rejected requests must remain dirty");
  await assert.rejects(queue.save({ readSnapshot: () => current, write: async () => { throw new Error("offline"); } }), /offline/);
  let accepted: SaveableAnswers | undefined;
  assert.equal(await queue.save({ readSnapshot: () => current, write: async (patch) => { accepted = patch; return true; } }), true);
  assert.deepEqual(accepted, current, "A rejection must not poison later retries");
  let forced = false;
  await queue.save({ readSnapshot: () => current, force: true, write: async (patch) => { assert.deepEqual(patch, {}); forced = true; return true; } });
  assert(forced, "Section events must be written even without changed answers");
  let emptyWrite = false;
  await queue.save({ readSnapshot: () => current, write: async () => { emptyWrite = true; return true; } });
  assert.equal(emptyWrite, false, "A final flush should wait for prior saves without redundant writes");
  console.log("Answer save queue: delayed writes, newest edits, reversions, failures, retries and final flush passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
