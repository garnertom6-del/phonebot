import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { NextRequest } from "next/server";
import { BENEFIT_RESOURCES } from "../src/lib/benefitsResources";
import { DIRECTORY_RELEASE, directoryReviewDueOn } from "../src/lib/directoryCatalog";
import { directoryReviewState } from "../src/lib/directoryStewardship";
import { INSURANCE_PLAN_DIRECTORY, insurancePlanDisplayLabel, normalizeInsuranceValue, recordNumberPrefix, PROVIDER_CHOICE_PLAN_OPTIONS } from "../src/lib/insurancePlans";

assert(!existsSync("src/app/benefits/page.tsx"), "Public finder must be removed");
assert(!existsSync("src/components/BenefitsFinder.tsx"));
assert.equal(normalizeInsuranceValue("Wellcare", "mco"), "Wellcare");
assert.equal(normalizeInsuranceValue("Wellcare", "providerChoice"), "Wellcare");
assert.equal(recordNumberPrefix("Wellcare"), "WELL");
assert.equal(recordNumberPrefix("Carolina Complete"), "CC");
assert(PROVIDER_CHOICE_PLAN_OPTIONS.includes("Wellcare"));
assert.match(insurancePlanDisplayLabel("Wellcare"), /historical/);
assert.match(insurancePlanDisplayLabel("Carolina Complete"), /current/);
assert.equal(INSURANCE_PLAN_DIRECTORY.find((plan) => plan.id === "wellcare")?.source.effectiveOn, "2026-04-01");
for (const resource of BENEFIT_RESOURCES) {
  const url = new URL(resource.url);
  assert.equal(url.protocol, "https:"); assert.equal(url.search, "");
  assert(["medicaid.ncdhhs.gov", "www.ncdhhs.gov", "ncchildcare.ncdhhs.gov", "www.ssa.gov", "nc211.org"].includes(url.hostname));
  assert.equal(resource.version, DIRECTORY_RELEASE.version);
  assert.equal(resource.checkedOn, "2026-09-06");
  assert(resource.ownerRole && resource.reviewEveryDays > 0);
}
assert.match(BENEFIT_RESOURCES.find((resource) => resource.id === "hop")!.availability!, /pending/);
assert.equal(directoryReviewDueOn("2026-09-06", 30), "2026-10-06");
assert.equal(directoryReviewState(null, false, "2026-09-06").status, "Owner needed");
assert.equal(directoryReviewState("2026-09-06", true, "2026-09-13").status, "HOP review due");
assert.equal(directoryReviewState("2026-09-06", true, "2026-10-06").status, "Review due");

// Real handlers and authentication guards; synthetic in-memory database only.
async function apiRegressions() {
  const providers = [{ id: "provider-a", name: "Synthetic A", status: "ACTIVE", slug: "a" }, { id: "provider-b", name: "Synthetic B", status: "ACTIVE", slug: "b" }];
  const users = ["admin", "owner", "other", "reviewer", "outsider"].map((id) => ({ id, name: `Synthetic ${id}`, role: "staff" }));
  const memberships = users.map((user) => ({ userId: user.id, providerId: user.id === "outsider" ? "provider-b" : "provider-a", active: true, role: user.id === "admin" ? "PROVIDER_ADMIN" : user.id === "reviewer" ? "REVIEWER" : "STAFF", user }));
  type Event = { id: number; providerId: string; directoryVersion: string; action: string; ownerUserId: string; ownerName: string; actorUserId: string; actorName: string; note: string; createdAt: Date };
  const events: Event[] = [];
  const matchingEvents = (where: { providerId: string; directoryVersion: string; action?: string }) => events.filter((event) => event.providerId === where.providerId && event.directoryVersion === where.directoryVersion && (!where.action || event.action === where.action)).reverse();
  const matchesMember = (member: typeof memberships[number], where: { userId?: string; providerId: string; active?: boolean; role?: { in: string[] } }) => member.providerId === where.providerId && (!where.userId || member.userId === where.userId) && (!where.active || member.active) && (!where.role || where.role.in.includes(member.role));
  const globalWithPrisma = globalThis as unknown as { prisma?: unknown };
  const previous = globalWithPrisma.prisma;
  globalWithPrisma.prisma = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.find((user) => user.id === where.id) || null },
    provider: { findFirst: async ({ where }: { where: { id: string } }) => providers.find((provider) => provider.id === where.id) || null },
    userMembership: {
      findFirst: async ({ where }: { where: Parameters<typeof matchesMember>[1] }) => memberships.find((member) => matchesMember(member, where)) || null,
      findMany: async ({ where }: { where: Parameters<typeof matchesMember>[1] }) => memberships.filter((member) => matchesMember(member, where)),
    },
    directoryStewardship: {
      findFirst: async ({ where }: { where: Parameters<typeof matchingEvents>[0] }) => matchingEvents(where)[0] || null,
      findMany: async ({ where }: { where: Parameters<typeof matchingEvents>[0] }) => matchingEvents(where),
      create: async ({ data }: { data: Omit<Event, "id" | "createdAt"> }) => { const event = { ...data, id: events.length + 1, createdAt: new Date() }; events.push(event); return event; },
    },
  };
  const { bindTestCookies } = await import("../src/lib/requestCookies");
  try {
    const { createSessionValue, SESSION_COOKIE } = await import("../src/lib/auth");
    const { GET, POST } = await import("../src/app/api/provider/directory/route");
    const asUser = (id: string | null) => bindTestCookies({ get: (key) => key === SESSION_COOKIE && id ? { value: createSessionValue(id) } : undefined });
    const post = (body: Record<string, unknown>) => POST(new NextRequest("http://localhost/api/provider/directory", { method: "POST", body: JSON.stringify({ providerId: "provider-a", version: DIRECTORY_RELEASE.version, ...body }) }));
    const get = (providerId = "provider-a") => GET(new NextRequest(`http://localhost/api/provider/directory?providerId=${providerId}`));
    asUser(null); assert.equal((await get()).status, 401);
    asUser("outsider"); assert.equal((await get()).status, 403, "Cross-provider reads denied");
    asUser("owner"); assert.equal((await post({ action: "assign", ownerUserId: "owner" })).status, 403, "Staff cannot assign themselves");
    asUser("admin"); assert.equal((await post({ action: "assign", ownerUserId: "outsider" })).status, 400, "Owner must belong to the provider");
    assert.equal((await post({ action: "assign", ownerUserId: "reviewer" })).status, 400);
    assert.equal((await post({ action: "assign", ownerUserId: "owner" })).status, 200);
    assert.equal((await post({ action: "review", note: "Checked sources", version: "old-version" })).status, 400, "Review binds to version");
    asUser("other"); assert.equal((await post({ action: "review", note: "Unauthorized" })).status, 403);
    asUser("reviewer"); assert.equal((await post({ action: "review", note: "Read-only" })).status, 403);
    asUser("owner"); assert.equal((await post({ action: "review", note: "Checked official sources; HOP restart pending." })).status, 200);
    let response = await get(); assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    let body = await response.json(); assert.equal(body.review.actorUserId, "owner"); assert.equal(body.assignment.ownerUserId, "owner"); assert.equal(body.history.length, 2);
    asUser("admin"); assert.equal((await post({ action: "assign", ownerUserId: "other" })).status, 200);
    asUser("owner"); assert.equal((await post({ action: "review", note: "No longer owner" })).status, 403);
    asUser("other"); response = await get(); body = await response.json(); assert.equal(body.assignment.ownerUserId, "other"); assert.equal(body.history.length, 3, "Reassignment preserves history");
    asUser("outsider"); body = await (await get("provider-b")).json(); assert.equal(body.history.length, 0, "History remains provider scoped");
  } finally { bindTestCookies(null); if (previous === undefined) delete globalWithPrisma.prisma; else globalWithPrisma.prisma = previous; }
}

apiRegressions().then(() => console.log("Staff directory: legacy values, metadata, provider isolation, owner authorization and review history passed (synthetic; no network)."))
  .catch((error) => { console.error(error); process.exitCode = 1; });
