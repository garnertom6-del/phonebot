import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClientEditSaveLock } from "../src/lib/clientEditSaveLock";

async function main() {
  const lock = createClientEditSaveLock();
  const pending: boolean[] = [];
  let draft = "Client A correction";
  let editing = "A";
  let saved = "";
  let writes = 0;
  let release!: () => void;
  const delayedResponse = new Promise<void>((resolve) => { release = resolve; });
  const saving = lock.run(async () => {
    writes++;
    saved = draft;
    await delayedResponse;
    editing = "";
  }, (value) => pending.push(value));
  assert.equal(lock.isPending(), true, "The lock applies in the same event, before a React rerender");
  // These mirror the event gates for typing, Cancel and opening a second row.
  if (!lock.isPending()) draft = "Newer unsaved correction";
  if (!lock.isPending()) editing = "";
  if (!lock.isPending()) { editing = "B"; draft = "Client B correction"; }
  await lock.run(async () => { writes++; }, (value) => pending.push(value));
  assert.equal(editing, "A", "A pending save cannot be replaced by another client's editor");
  assert.equal(draft, saved, "No accepted edit can be silently discarded by the pending save response");
  assert.equal(writes, 1, "Repeated submit events send one request");
  release();
  await saving;
  assert.equal(lock.isPending(), false);
  assert.deepEqual(pending, [true, false]);

  editing = "B";
  draft = "Retain this on failure";
  await assert.rejects(lock.run(async () => { throw new Error("Disconnected"); }, () => {}), /Disconnected/);
  assert.equal(lock.isPending(), false, "A failed request unlocks the same draft for retry");
  assert.equal(editing, "B");
  assert.equal(draft, "Retain this on failure");
  await lock.run(async () => { writes++; }, () => {});
  assert.equal(writes, 2, "Retry works after a failure");

  const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
  assert.match(dashboard, /<fieldset disabled=\{clientSavePending\} aria-busy=\{clientSavePending\}>/);
  assert.match(dashboard, /disabled=\{rowBusy \|\| clientSavePending\}[\s\S]*?onClick=\{\(\) => editingClientId/);
  for (const handler of ["beginClientEdit", "updateClientDraft", "resolveClientConflict"]) {
    assert.match(dashboard, new RegExp(`function ${handler}\\([^\\n]*\\) \\{\\s*if \\(clientSaveLock.isPending\\(\\)\\) return;`));
  }
  assert.match(dashboard, /function closeClientEdit\(\) \{\s*if \(!clientSaveLock.isPending\(\)\) clearClientEdit\(\);/);
  assert.match(dashboard, /Your changes are still here; check your connection and try again/);
  console.log("Client details: delayed saves block edits, cancellation, row switches and duplicate submit; failure retains the draft and unlocks retry.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
