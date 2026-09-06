import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { isolatedSqlite } from "./isolatedSqlite";
import { createProviderContextReady } from "../src/lib/newIntakeReadiness";
import { generateBatchRecordNumbers } from "../src/lib/batchRecordNumbers";
import { makeRecordNumber } from "../src/lib/insurancePlans";

async function main() {
  assert.equal(createProviderContextReady("provider-a", false, ""), false, "A pending provider request cannot enable Create");
  assert.equal(createProviderContextReady("", true, ""), false, "An incomplete context response cannot enable Create");
  assert.equal(createProviderContextReady("provider-a", true, "Unavailable"), false);
  assert.equal(createProviderContextReady("provider-a", true, ""), true, "Packet setup does not block answer collection once provider context is known");
  const rows = [
    { name: "Synthetic A", providerChoicePlan: "Blue Cross Blue Shield", recordNumber: "" },
    { name: "Synthetic B", providerChoicePlan: "Carolina Complete", recordNumber: "" },
    { name: "Synthetic C", providerChoicePlan: "Alliance", recordNumber: "" },
    { name: "Synthetic D", providerChoicePlan: "", recordNumber: "" },
    { name: "Synthetic E", providerChoicePlan: "United Health Care", recordNumber: "OFFICIAL-1" },
    { name: "", providerChoicePlan: "", recordNumber: "" },
  ];
  let sequence = 0;
  const generated = generateBatchRecordNumbers(rows, "AmeriHealth", (row) => !!row.name,
    (plan) => makeRecordNumber(plan, () => ++sequence / 100));
  assert.match(generated.rows[0].recordNumber, /^BCBS-/);
  assert.match(generated.rows[1].recordNumber, /^CC-/);
  assert.equal(generated.rows[2].recordNumber, "", "A lookup plan never receives the default plan's generated number");
  assert.match(generated.rows[3].recordNumber, /^AMERI-/);
  assert.equal(generated.rows[3].providerChoicePlan, "AmeriHealth");
  assert.equal(generated.rows[4].recordNumber, "OFFICIAL-1");
  assert.deepEqual(generated.rows[5], rows[5], "Blank rows stay blank");
  assert.deepEqual(generated.manualRows, [3]);
  assert.equal(generated.generatedCount, 3);
  assert.equal(rows[0].recordNumber, "", "Generation does not mutate a submitted draft snapshot");
  const collision = generateBatchRecordNumbers([
    { providerChoicePlan: "AmeriHealth", recordNumber: "AMERI-10000" },
    { providerChoicePlan: "AmeriHealth", recordNumber: "" },
  ], "", () => true, () => "AMERI-10000");
  assert.deepEqual(collision.failedRows, [2], "Repeated collisions must stop instead of locking the mobile page");
  assert.deepEqual(generateBatchRecordNumbers([{ providerChoicePlan: "", recordNumber: "" }], "", () => true).missingPlanRows, [1]);

  const database = isolatedSqlite("create-provider-context-tests.db");
  const previousUrl = process.env.DATABASE_URL;
  database.pushSchema(readFileSync("prisma/schema.prisma", "utf8"), "current-schema.prisma");
  process.env.DATABASE_URL = database.databaseUrl;
  const { prisma } = await import("../src/lib/prisma");
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
  const { SELECTED_PROVIDER_COOKIE } = await import("../src/lib/staffGuard");
  const { POST: single } = await import("../src/app/api/intakes/route");
  const { POST: batch } = await import("../src/app/api/intakes/batch/route");
  try {
    const agencyA = await prisma.provider.create({ data: { name: "Synthetic Agency A", slug: "synthetic-create-a" } });
    const agencyB = await prisma.provider.create({ data: { name: "Synthetic Agency B", slug: "synthetic-create-b" } });
    const master = await prisma.user.create({ data: { name: "Synthetic master", email: "master@create.invalid", passwordHash: "synthetic-only", role: "master" } });
    const staff = await prisma.user.create({ data: { name: "Synthetic staff", email: "staff@create.invalid", passwordHash: "synthetic-only", memberships: { create: { providerId: agencyA.id, role: "STAFF" } } } });
    const reviewer = await prisma.user.create({ data: { name: "Synthetic reviewer", email: "reviewer@create.invalid", passwordHash: "synthetic-only", memberships: { create: { providerId: agencyA.id, role: "REVIEWER" } } } });
    const asUser = (userId: string) => bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(userId) }
      : key === SELECTED_PROVIDER_COOKIE ? { value: agencyB.id } : undefined });
    const client = (record: string) => ({ fullName: "Synthetic Provider Test", dob: "1990-01-15", email: "synthetic@example.invalid", providerChoicePlan: "Healthy Blue", recordNumber: record });
    const request = (path: string, body: object) => new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });
    const runSingle = (body: object) => single(request("/api/intakes", body));
    const runBatch = (body: object) => batch(request("/api/intakes/batch", body));
    asUser(master.id);
    let response = await runSingle({ ...client("SINGLE-A"), providerId: agencyA.id });
    assert.equal(response.status, 200, await response.clone().text());
    let body = await response.json();
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: body.id } })).providerId, agencyA.id, "Single create uses the page's provider after another tab changes the cookie");
    assert.equal(response.cookies.get(SELECTED_PROVIDER_COOKIE)?.value, agencyA.id);
    response = await runBatch({ providerId: agencyA.id, intakes: [client("BATCH-A1"), client("BATCH-A2")] });
    assert.equal(response.status, 200, await response.clone().text());
    body = await response.json();
    assert.equal(body.created.length, 2);
    assert.equal(await prisma.intake.count({ where: { id: { in: body.created.map((item: { id: string }) => item.id) }, providerId: agencyA.id } }), 2, "Every batch row stays in its captured provider");
    assert.equal(response.cookies.get(SELECTED_PROVIDER_COOKIE)?.value, agencyA.id);
    assert.equal((await runSingle(client("NO-PROVIDER"))).status, 400);
    assert.equal((await runBatch({ intakes: [client("NO-PROVIDER-BATCH")] })).status, 400);
    assert.equal((await runBatch({ providerId: "missing", intakes: [client("MISSING")] })).status, 404);
    asUser(staff.id);
    assert.equal((await runSingle({ ...client("STAFF-A"), providerId: agencyA.id })).status, 200, "Authorized staff remain compatible with explicit page context");
    assert.equal((await runBatch({ providerId: agencyB.id, intakes: [client("FORBIDDEN")] })).status, 403);
    asUser(reviewer.id);
    assert.equal((await runSingle({ ...client("REVIEWER"), providerId: agencyA.id })).status, 403);
    assert.equal((await runBatch({ providerId: agencyA.id, intakes: [client("REVIEWER-BATCH")] })).status, 403);
    assert.equal(await prisma.intake.count({ where: { providerId: agencyB.id } }), 0, "The selected-cookie provider receives no records");
    console.log("Create workflow: pending context guards, real-DB single/batch provider binding, membership restrictions and mixed-plan numbers passed.");
  } finally {
    bindTestCookies(null);
    await prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    database.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
