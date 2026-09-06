import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { bindTestCookies } from "../src/lib/requestCookies";
import { SELECTED_PROVIDER_COOKIE } from "../src/lib/staffGuard";
import { GET, POST } from "../src/app/api/intakes/[id]/support-referrals/route";
import { PATCH } from "../src/app/api/intakes/[id]/support-referrals/[referralId]/route";
import { DELETE as deleteProvider } from "../src/app/api/master/providers/[id]/route";
import { GET as dashboard } from "../src/app/api/intakes/route";

async function main() {
  assert.match(process.env.DATABASE_URL || "", /support-referral-tests\.db$/, "Use the dedicated synthetic referral test database.");
  const tag = randomUUID();
  const providerIds: string[] = [];
  const userIds: string[] = [];
  const intakeIds: string[] = [];
  const clientIds: string[] = [];
  try {
    async function provider(label: string) {
      const item = await prisma.provider.create({ data: { name: `Synthetic ${label}`, slug: `test-referral-${label}-${tag}` } }); providerIds.push(item.id); return item;
    }
    const a = await provider("A"); const b = await provider("B");
    async function user(label: string, providerId: string, role = "STAFF", active = true) {
      const item = await prisma.user.create({ data: { email: `referral-${label}-${tag}@example.invalid`, name: `Synthetic ${label}`, passwordHash: "test-only-not-a-login", role: "staff", memberships: { create: { providerId, role, active } } } }); userIds.push(item.id); return item;
    }
    const actor = await user("actor", a.id);
    const owner = await user("owner", a.id);
    const reviewer = await user("reviewer", a.id, "REVIEWER");
    const inactive = await user("inactive", a.id, "STAFF", false);
    const outsider = await user("outsider", b.id);
    async function intake(providerId: string) {
      const client = await prisma.client.create({ data: { fullName: "Synthetic Referral Test", dob: "1990-01-01", providerId } }); clientIds.push(client.id);
      const item = await prisma.intake.create({ data: { providerId, clientId: client.id, token: randomUUID(), tokenExpiresAt: new Date(Date.now() + 86_400_000) } }); intakeIds.push(item.id); return item;
    }
    const intakeA = await intake(a.id); const intakeB = await intake(b.id);
    function signIn(userId: string | null, selectedProvider = a.id) {
      const session = userId ? createSessionValue(userId) : undefined;
      bindTestCookies({ get: (name) => name === SESSION_COOKIE && session ? { value: session } : name === SELECTED_PROVIDER_COOKIE ? { value: selectedProvider } : undefined });
    }
    const params = { params: Promise.resolve({ id: intakeA.id }) };
    const request = (method: string, body?: unknown) => new NextRequest(`http://localhost/api/intakes/${intakeA.id}/support-referrals`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    async function patch(referralId: string, body: unknown) { return PATCH(request("PATCH", body), { params: Promise.resolve({ id: intakeA.id, referralId }) }); }
    signIn(null);
    assert.equal((await GET(request("GET"), params)).status, 401);
    signIn(actor.id);
    assert.equal((await POST(request("POST", { resourceId: "fns", category: "food", resourceUrl: "https://example.invalid" }), params)).status, 400, "source URLs cannot be overridden");
    const createdResponse = await POST(request("POST", { resourceId: "fns", category: "food" }), params);
    assert.equal(createdResponse.status, 201);
    let referral = (await createdResponse.json()).referral;
    assert.equal(referral.status, "SUGGESTED");
    assert.equal(referral.permissionGrantedAt, null);
    assert.equal(referral.contactedAt, null);
    assert.equal(referral.confirmedAssistanceAt, null);
    assert.equal(referral.events.length, 1);
    const firstEvent = referral.events[0];
    assert.equal((await POST(request("POST", { resourceId: "fns", category: "food" }), params)).status, 409, "retry cannot create another tracker for the same resource");
    const listing = await (await GET(request("GET"), params)).json();
    assert.deepEqual(new Set(listing.staff.map((item: { id: string }) => item.id)), new Set([actor.id, owner.id]));
    signIn(outsider.id, b.id);
    assert.equal((await GET(request("GET"), params)).status, 404);
    assert.equal((await patch(referral.id, { expectedRevision: 1, status: "DECLINED" })).status, 404);
    const otherCreated = await POST(request("POST", { resourceId: "fns", category: "food" }), { params: Promise.resolve({ id: intakeB.id }) });
    assert.equal(otherCreated.status, 201);
    const otherReferral = (await otherCreated.json()).referral;
    signIn(reviewer.id);
    assert.equal((await GET(request("GET"), params)).status, 200);
    assert.equal((await POST(request("POST", { resourceId: "ssi", category: "income" }), params)).status, 403);
    assert.equal((await patch(referral.id, { expectedRevision: 1, status: "DECLINED" })).status, 403);
    signIn(actor.id);
    assert.equal((await patch(otherReferral.id, { expectedRevision: 1, status: "DECLINED" })).status, 404, "referral ID cannot cross the scoped intake");
    for (const assignedUserId of [outsider.id, inactive.id, reviewer.id]) {
      assert.equal((await patch(referral.id, { expectedRevision: 1, assignedUserId })).status, 400);
    }
    assert.equal((await patch(referral.id, { expectedRevision: 1, status: "WANTS_HELP", assignedUserId: owner.id })).status, 400, "progress requires explicit permission");
    const permissionAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const grant = { expectedRevision: 1, permissionAction: "GRANT", permissionAt, permissionSource: "CLIENT", permissionConfirmed: true, note: "Synthetic client explicitly requested help with this food resource.", assignedUserId: owner.id, status: "WANTS_HELP" };
    assert.equal((await patch(referral.id, { ...grant, permissionConfirmed: false })).status, 400);
    assert.equal((await patch(referral.id, { ...grant, note: "" })).status, 400);
    const granted = await patch(referral.id, grant);
    assert.equal(granted.status, 200);
    referral = (await granted.json()).referral;
    assert.equal(referral.revision, 2);
    assert.equal((await patch(referral.id, { expectedRevision: 1, status: "DECLINED" })).status, 409, "stale updates are rejected");
    assert.equal((await patch(referral.id, { expectedRevision: 2, status: "CONTACTED" })).status, 400, "opening a link is not actual contact");
    async function accept(body: Record<string, unknown>) {
      const response = await patch(referral.id, { expectedRevision: referral.revision, ...body });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result)); referral = result.referral;
    }
    const contactedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await accept({ status: "CONTACTED", contactedAt, note: "Synthetic contact confirmed." });
    await accept({ status: "APPLIED" });
    await accept({ status: "WAITING" });
    await accept({ status: "APPROVED" });
    assert.equal(referral.confirmedAssistanceAt, null, "approval is not assistance received");
    const assistanceAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    assert.equal((await patch(referral.id, { expectedRevision: referral.revision, confirmedAssistanceAt: assistanceAt })).status, 400, "receipt requires supporting confirmation note");
    await accept({ confirmedAssistanceAt: assistanceAt, note: "Synthetic client confirmed actual receipt." });
    await accept({ nextContactAt: new Date(Date.now() + 86_400_000).toISOString() });
    await prisma.supportReferral.update({ where: { id: otherReferral.id }, data: { nextContactAt: new Date(), permissionGrantedAt: new Date(), assignedUserId: outsider.id } });
    const dashboardRequest = (providerId: string) => new NextRequest(`http://localhost/api/intakes?providerId=${providerId}`);
    const scheduled = await (await dashboard(dashboardRequest(a.id))).json();
    assert.deepEqual(scheduled.referralFollowUps.map((r: { id: string }) => r.id), [referral.id], "dashboard referral data stays scoped to the requested provider");
    assert.equal(scheduled.referralFollowUps[0].assignedUser.id, owner.id);
    assert.equal(scheduled.referralFollowUps[0].ownerActive, true);
    assert.equal(scheduled.referralFollowUps[0].nextContactAt, referral.nextContactAt, "server preserves exact dates for local-calendar filtering");
    signIn(outsider.id, b.id);
    const otherDashboard = await (await dashboard(dashboardRequest(b.id))).json();
    assert.deepEqual(otherDashboard.referralFollowUps.map((r: { id: string }) => r.id), [otherReferral.id]);
    signIn(actor.id);
    const beforeWithdrawal = referral.events;
    await prisma.userMembership.update({ where: { userId_providerId: { userId: owner.id, providerId: a.id } }, data: { active: false } });
    const inactiveOwnerDashboard = await (await dashboard(dashboardRequest(a.id))).json();
    assert.equal(inactiveOwnerDashboard.referralFollowUps[0].ownerActive, false, "deactivated staff stay visible as needing reassignment");
    assert.equal(await prisma.messageDelivery.count({ where: { intakeId: intakeA.id } }), 0, "opening the follow-up dashboard does not send messages");
    await accept({ permissionAction: "WITHDRAW", permissionAt: new Date(Date.now() - 86_400_000).toISOString(), note: "Synthetic client withdrew permission." });
    assert.equal(referral.status, "DECLINED");
    assert.equal(referral.nextContactAt, null);
    assert.equal(referral.contactedAt, contactedAt);
    assert.equal(referral.confirmedAssistanceAt, assistanceAt);
    assert.deepEqual(referral.events.slice(1), beforeWithdrawal, "old events remain unchanged after withdrawal");
    assert.deepEqual(referral.events.at(-1), firstEvent);
    assert.equal((await patch(referral.id, { expectedRevision: referral.revision, status: "CONTACTED", assignedUserId: actor.id })).status, 400, "withdrawal blocks new progress");
    await accept({ permissionAction: "GRANT", permissionAt: new Date().toISOString(), permissionSource: "CLIENT", permissionConfirmed: true, note: "Synthetic client renewed permission.", assignedUserId: actor.id, status: "WANTS_HELP" });
    await accept({ status: "DENIED" });
    await accept({ status: "UNAVAILABLE" });
    const legacy = await prisma.referral.create({ data: { intakeId: intakeA.id, slot: 1, name: "Synthetic packet row" } });
    await prisma.referral.delete({ where: { id: legacy.id } });
    assert.equal(await prisma.supportReferral.count({ where: { providerId: a.id, intakeId: intakeA.id } }), 1, "packet row replacement leaves support tracker intact");
    assert.equal(await prisma.supportReferralEvent.count({ where: { providerId: a.id, referralId: referral.id } }), referral.revision);
    const otherProviderSnapshot = await prisma.provider.findUnique({ where: { id: b.id }, include: { clients: true, intakes: true, memberships: true, supportReferrals: { include: { events: true } } } });
    const removeProvider = (body: unknown) => deleteProvider(new NextRequest(`http://localhost/api/master/providers/${a.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: a.id }) });
    assert.equal((await removeProvider({ confirmName: a.name })).status, 403, "ordinary staff cannot permanently delete a provider");
    await prisma.user.update({ where: { id: actor.id }, data: { role: "master" } });
    assert.equal((await removeProvider({})).status, 400, "master deletion still requires exact provider-name confirmation");
    assert.equal((await removeProvider({ confirmName: a.name.toLowerCase() })).status, 400, "provider-name confirmation remains case sensitive");
    assert.equal(await prisma.supportReferral.count({ where: { providerId: a.id } }), 1, "failed confirmation preserves referral data");
    const removedResponse = await removeProvider({ confirmName: a.name });
    assert.equal(removedResponse.status, 200);
    const removed = await removedResponse.json();
    assert.equal(removed.deleted.supportReferrals, 1);
    assert.equal(removed.deleted.supportReferralEvents, referral.revision);
    assert.equal(removed.deleted.intakes, 1);
    assert.equal(removed.deleted.clients, 1);
    assert.equal(await prisma.provider.count({ where: { id: a.id } }), 0);
    assert.equal(await prisma.supportReferral.count({ where: { providerId: a.id } }), 0);
    assert.equal(await prisma.supportReferralEvent.count({ where: { providerId: a.id } }), 0);
    assert.deepEqual(await prisma.provider.findUnique({ where: { id: b.id }, include: { clients: true, intakes: true, memberships: true, supportReferrals: { include: { events: true } } } }), otherProviderSnapshot, "confirmed deletion preserves the other provider and its referral history");
    const deletionAudit = await prisma.auditLog.findFirst({ where: { userId: actor.id, event: "provider_profile_deleted" }, orderBy: { createdAt: "desc" } });
    assert(deletionAudit?.detail?.includes("1 support referral(s)"));
    assert(deletionAudit?.detail?.includes(`${referral.revision} support referral event(s)`));
    console.log("Support referrals: scoped read/write, reviewer restrictions, active assignees, explicit permission, dates, revision conflicts, withdrawal, append-only history, approval/receipt distinction, duplicate prevention, legacy separation, and confirmed provider-deletion compatibility passed.");
  } finally {
    bindTestCookies(null);
    await prisma.supportReferralEvent.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.supportReferral.deleteMany({ where: { providerId: { in: providerIds } } });
    await prisma.referral.deleteMany({ where: { intakeId: { in: intakeIds } } });
    await prisma.intake.deleteMany({ where: { id: { in: intakeIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.userMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.provider.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
