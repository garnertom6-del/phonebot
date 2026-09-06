import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { clientRecordPatchFromAnswerPatch, clientUpdateFromAnswers } from "../src/lib/clientAnswerSync";

const original = {
  fullName: "Synthetic Contact Test", dob: "2000-01-02", midNumber: "SYNTHETIC-MID",
  recordNumber: "SYNTHETIC-RECORD", email: "old@example.invalid", phone: "2025550101",
  guardianName: "Synthetic Guardian", guardianEmail: "guardian@example.invalid", guardianPhone: "2025550103",
};

assert.deepEqual(clientUpdateFromAnswers(original, { presenting_problem: "Unrelated answer" }), {},
  "Sparse unrelated answers must not write stale Client values");
assert.deepEqual(clientUpdateFromAnswers(original, {
  client_email: " ", client_phone_cell: "", client_phone_home: "",
  guardian_name: "", guardian_email: "", guardian_phone: "",
}), { email: null, phone: null, guardianName: null, guardianEmail: null, guardianPhone: null },
"Explicit empty contacts remove old destinations");
assert.deepEqual(clientUpdateFromAnswers(original, {
  client_full_name: " ", mid_number: "", record_number: "", dob: "02/30/2000",
}), {}, "Blank or invalid required identity answers must not erase the Client identity");
assert.deepEqual(clientUpdateFromAnswers(original, { dob: "01/03/2000" }), { dob: "2000-01-03" });
assert.deepEqual(clientUpdateFromAnswers(original, { dob: "2099-01-01" }), {}, "Future DOB must not replace identity");
assert.deepEqual(clientRecordPatchFromAnswerPatch({ client_phone_cell: "", client_phone_home: "2025550102" },
  ["client_phone_cell"]), { phone: "2025550102" }, "Cleared cell retains saved home fallback");
assert.deepEqual(clientRecordPatchFromAnswerPatch({ client_phone_cell: "2025550101", client_phone_home: "" },
  ["client_phone_home"]), { phone: "2025550101" }, "Cleared home retains saved cell");
assert.deepEqual(clientRecordPatchFromAnswerPatch({ client_email: "stale-answer@example.invalid", guardian_email: "" },
  ["guardian_email"]), { guardianEmail: null }, "Merged context must not update keys absent from the patch");
assert.deepEqual(clientRecordPatchFromAnswerPatch({}, ["client_email", "client_phone_cell", "dob"]), {},
  "Changed-key metadata without an actual answer must not clear contacts");

// Exercise the public PATCH boundary with synthetic in-memory delegates. No
// network or database connection is created, and no external message is sent.
async function publicPatchRegression() {
  const record = { ...original, id: "synthetic-client" };
  const rows = new Map<string, string>(Object.entries({
    client_phone_cell: "2025550101", client_phone_home: "2025550102",
    client_email: "stale-answer@example.invalid", guardian_phone: "2025550103",
  }).map(([key, value]) => [key, JSON.stringify(value)]));
  const revisions = new Map([...rows.keys()].map((key) => [key, 1]));
  const writes: Record<string, unknown>[] = [];
  const intake = {
    id: "synthetic-intake", clientId: record.id, providerId: "synthetic-provider",
    token: "synthetic-token", status: "IN_PROGRESS", submittedAt: null,
    tokenExpiresAt: new Date(Date.now() + 86_400_000), client: record,
    provider: { status: "ACTIVE", name: "Synthetic Provider", phone: "2025550199" },
    signatures: [], uploadedDocuments: [],
  };
  const tx = {
    intake: {
      findUnique: async () => intake,
      updateMany: async () => ({ count: 1 }),
      update: async () => intake,
    },
    intakeAnswer: {
      findMany: async (args: { where: { key?: { in: string[] } } }) => [...rows]
        .filter(([key]) => !args.where.key || args.where.key.in.includes(key))
        .map(([key, value]) => ({ key, value, revision: revisions.get(key) || 1 })),
      upsert: async (args: { create: { key: string; value: string } }) => {
        rows.set(args.create.key, args.create.value);
        revisions.set(args.create.key, (revisions.get(args.create.key) || 0) + 1);
        return args.create;
      },
    },
    signature: { updateMany: async () => ({ count: 0 }) },
    client: {
      update: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        Object.assign(record, args.data);
        return record;
      },
    },
  };
  const globalWithPrisma = globalThis as unknown as { prisma?: unknown };
  const previous = globalWithPrisma.prisma;
  globalWithPrisma.prisma = { ...tx, $transaction: async (operation: (db: typeof tx) => unknown) => operation(tx) };
  try {
    const { PATCH } = await import("../src/app/api/intake/[token]/route");
    const patch = async (answers: Record<string, string>) => {
      const result = await PATCH(new NextRequest("http://localhost/api/intake/synthetic-token", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers,
          expectedAnswerRevisions: Object.fromEntries(Object.keys(answers).map((key) => [key, revisions.get(key) || 0])),
        }),
      }), { params: Promise.resolve({ token: intake.token }) });
      assert.equal(result.status, 200);
    };
    await patch({ client_phone_cell: "" });
    assert.equal(record.phone, "2025550102", "Public sparse PATCH must retain the stored home number");
    assert.equal(record.email, original.email, "Unrelated stale answer context must not overwrite Client email");
    assert.deepEqual(writes[0], { phone: "2025550102" });
    await patch({ client_phone_home: "", client_email: "", guardian_name: "", guardian_email: "", guardian_phone: "" });
    assert.equal(record.phone, "2025550102", "Public answers must not alter the staff-only home phone");
    assert.equal(record.email, null);
    assert.equal(record.guardianName, null);
    assert.equal(record.guardianEmail, null);
    assert.equal(record.guardianPhone, null);
    rows.set("client_phone_home", JSON.stringify("")); // No saved home fallback in this case.
    await patch({ client_phone_cell: "" });
    assert.equal(record.phone, null, "Explicit cell removal clears a phone with no stored fallback");
    await patch({ dob: "01/03/2000" });
    assert.equal(record.dob, "2000-01-03", "Public DOB edit must update normalized Client identity");
    await patch({ dob: "02/30/2000", client_full_name: "" });
    assert.equal(record.dob, "2000-01-03");
    assert.equal(record.fullName, original.fullName);
  } finally {
    if (previous === undefined) delete globalWithPrisma.prisma;
    else globalWithPrisma.prisma = previous;
  }
}

publicPatchRegression().then(() => {
  console.log("Client answer sync and public PATCH regressions passed (synthetic in-memory data only).");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
