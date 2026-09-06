import assert from "node:assert/strict";
import { batchRetryDrafts } from "../src/lib/batchRetryDrafts";

const blank = () => ({ name: "", phone: "" });
const first = { name: "Synthetic First", phone: "2025550101" };
const second = { name: "Synthetic Second", phone: "2025550102" };
const drafts = [first, blank(), second];

const partial = batchRetryDrafts(drafts, [0, 2], [{ row: 2, error: "Please retry" }], blank);
assert.deepEqual(partial.drafts, [blank(), blank(), second], "retain failed data and remove successful drafts from retry");
assert.equal(partial.failures[0].row, 3, "map compressed API row back to the visible row");
assert.deepEqual(drafts, [first, blank(), second], "preserve the submitted snapshot");
assert.deepEqual(partial.drafts.filter((row) => row.name), [second], "retry submits only the failed client");

const allFailed = batchRetryDrafts(drafts, [0, 2], [{ row: 1, error: "First failed" }, { row: 2, error: "Second failed" }], blank);
assert.deepEqual(allFailed.drafts, drafts, "preserve all data if every row failed");
assert.deepEqual(allFailed.failures.map((failure) => failure.row), [1, 3]);

const retried = batchRetryDrafts(partial.drafts, [2], [], blank);
assert.deepEqual(retried.drafts, [blank(), blank(), blank()], "successful retry clears only the remaining draft");
console.log("Batch retry tests passed.");
