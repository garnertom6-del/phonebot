import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { bindTestCookies } from "../src/lib/requestCookies";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { SELECTED_PROVIDER_COOKIE } from "../src/lib/staffGuard";
import { POST } from "../src/app/api/nctracks/search/route";

async function main() {
  const a = await prisma.provider.create({ data: { name: "Synthetic Lookup Search A", slug: "synthetic-lookup-search-a" } });
  const b = await prisma.provider.create({ data: { name: "Synthetic Lookup Search B", slug: "synthetic-lookup-search-b" } });
  const staff = await prisma.user.create({ data: { name: "Synthetic Search Staff", email: "search@example.invalid", passwordHash: "not-a-login", role: "staff", memberships: { create: { providerId: a.id, role: "STAFF" } } } });
  const query = (providerId: string, value: string) => POST(new Request("http://localhost/api/nctracks/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, query: value }) }));
  try {
    const clientA = await prisma.client.create({ data: { providerId: a.id, fullName: "Synthetic Compound Name", dob: "02/03/1991", recordNumber: "SEARCH-A", midNumber: "000001A" } });
    const clientB = await prisma.client.create({ data: { providerId: b.id, fullName: "Synthetic Compound Name", dob: "1991-02-03", recordNumber: "SEARCH-B" } });
    const old = await prisma.intake.create({ data: { providerId: a.id, clientId: clientA.id, token: "search-old", tokenExpiresAt: new Date("2027-01-01"), createdAt: new Date("2020-01-01") } });
    await prisma.intake.create({ data: { providerId: b.id, clientId: clientB.id, token: "search-other", tokenExpiresAt: new Date("2027-01-01") } });
    await prisma.intake.create({ data: { providerId: a.id, clientId: clientA.id, token: "search-archived", tokenExpiresAt: new Date("2027-01-01"), archived: true } });
    // Search must find an older record beyond the initial context's 150 rows.
    const newerClient = await prisma.client.create({ data: { providerId: a.id, fullName: "Synthetic Recent Search", dob: "1990-01-01" } });
    await prisma.$transaction(Array.from({ length: 151 }, (_, index) => prisma.intake.create({ data: { providerId: a.id, clientId: newerClient.id, token: `search-new-${index}`, tokenExpiresAt: new Date("2027-01-01") } })));
    bindTestCookies({ get: () => undefined });
    assert.equal((await query(a.id, "Compound")).status, 401);
    bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(staff.id) } : key === SELECTED_PROVIDER_COOKIE ? { value: b.id } : undefined });
    const response = await query(a.id, "Compound");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const body = await response.json();
    assert.equal(body.intakes.length, 1);
    assert.equal(body.intakes[0].id, old.id);
    assert.equal(body.intakes[0].dob, "1991-02-03");
    assert.equal(body.intakes[0].midNumber, "000001A");
    assert.deepEqual(Object.keys(body.intakes[0]).sort(), ["dob", "fullName", "id", "midNumber"]);
    assert.equal((await query(b.id, "Compound")).status, 403, "Explicit wrong provider cannot fall back to membership or cookie");
    assert.equal((await query("", "Compound")).status, 400);
    assert.equal((await query(a.id, "C")).status, 400);
    assert.equal((await (await query(a.id, "SEARCH-A")).json()).intakes[0].id, old.id);
    const many = await (await query(a.id, "Recent")).json();
    assert.equal(many.intakes.length, 50);
    assert.equal(many.hasMore, true);
    await prisma.userMembership.update({ where: { userId_providerId: { userId: staff.id, providerId: a.id } }, data: { role: "REVIEWER" } });
    assert.equal((await query(a.id, "Compound")).status, 200, "Search is a read-only staff operation");
    console.log("NCTracks search: older records, explicit provider isolation, archived exclusion, limited results, date normalization and no-store passed.");
  } finally { bindTestCookies(null); await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
