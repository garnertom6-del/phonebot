import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { bindTestCookies } from "../src/lib/requestCookies";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { SELECTED_PROVIDER_COOKIE } from "../src/lib/staffGuard";
import { requestNcTracksJob, changeNcTracksJob, configureNcTracks, heartbeatNcTracks, claimNcTracks, resultNcTracks, ncTracksContext, NcTracksJobError } from "../src/lib/ncTracksJobs";
import { POST as create } from "../src/app/api/nctracks/jobs/route";
import { POST as cancel } from "../src/app/api/nctracks/jobs/[id]/cancel/route";
import { POST as configure } from "../src/app/api/nctracks/config/route";
import { GET as context } from "../src/app/api/nctracks/context/route";
import type { NcTracksHostJob } from "../src/lib/ncTracksJobTypes";
import { validNpi } from "../src/lib/npi";
import { savedLookupDob, lookupFormError, NCTRACKS_STATUS_DETAILS } from "../src/lib/ncTracksUi";

async function main() {
  const a = await prisma.provider.create({ data: { name: "Synthetic NCTracks A", slug: "nctracks-test-a" } });
  const b = await prisma.provider.create({ data: { name: "Synthetic NCTracks B", slug: "nctracks-test-b" } });
  const staff = await prisma.user.create({ data: { name: "Synthetic Staff", email: "nctracks@example.invalid", passwordHash: "not-a-login", role: "staff", memberships: { create: { providerId: a.id, role: "PROVIDER_ADMIN" } } } });
  const client = await prisma.client.create({ data: { providerId: a.id, fullName: "Synthetic Compound Person", dob: "02/03/1991", midNumber: "  " } });
  const intake = await prisma.intake.create({ data: { providerId: a.id, clientId: client.id, token: "nctracks-synthetic-intake", tokenExpiresAt: new Date("2027-01-01") } });
  const input = { intakeId: intake.id, firstName: "Synthetic", lastName: "Compound Person", dob: "1991-02-03", serviceDateFrom: "2026-09-01", serviceDateTo: "2026-09-06", idempotencyKey: "synthetic-request-1" };
  const req = (endpoint: string, providerId: string, body?: unknown) => new Request(`http://localhost/api/nctracks/${endpoint}?providerId=${providerId}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const login = () => bindTestCookies({ get: (key) => key === SESSION_COOKIE ? { value: createSessionValue(staff.id) } : key === SELECTED_PROVIDER_COOKIE ? { value: b.id } : undefined });
  const rejected = (action: () => Promise<unknown>, status = 409) => assert.rejects(action, (e: unknown) => e instanceof NcTracksJobError && e.status === status);
  const evidence = (job: NcTracksHostJob) => ({ leaseToken: job.leaseToken, status: "VERIFIED_LOCAL", coverage: "ACTIVE", subject: { ...job.subject, midNumber: "001234567A" }, authorizedNpi: job.authorizedNpi,
    serviceDateFrom: job.serviceDateFrom, serviceDateTo: job.serviceDateTo, actualInquiryFrom: "2026-09-01", actualInquiryTo: "2026-09-30", selectedCoveragePeriod: "September 2026",
    provenance: { source: "NCTRACKS_PORTAL", observedAt: new Date().toISOString(), reference: "SYNTHETIC_ONLY" }, artifactSha256: "a".repeat(64) });
  try {
    assert(validNpi("1234567893")); assert(!validNpi("1234567890")); assert(!validNpi("0000000000"));
    assert.equal(savedLookupDob("02/03/1991"), "1991-02-03"); assert.equal(savedLookupDob("02/30/1991"), "");
    assert.equal(lookupFormError(input), ""); assert(lookupFormError({ ...input, serviceDateTo: "2026-08-31" }));
    assert.match(NCTRACKS_STATUS_DETAILS.VERIFIED_LOCAL, /not attached/);
    bindTestCookies({ get: () => undefined });
    const denied = await context(req("context", a.id)); assert.equal(denied.status, 401); assert.match(denied.headers.get("cache-control")!, /no-store/);
    login();
    assert.equal((await context(req("context", b.id))).status, 403);
    assert.equal((await context(new Request("http://localhost/api/nctracks/context"))).status, 400);
    assert.equal((await create(req("jobs", b.id, input))).status, 403);
    assert.equal((await configure(req("config", a.id, { action: "configure", authorizedNpi: "0000000000" }))).status, 400);
    let initial = await requestNcTracksJob(a.id, staff.id, input);
    assert.equal(initial.status, "NOT_CONFIGURED"); assert.equal(initial.subject.midNumber, null);
    assert.equal((await ncTracksContext(a.id, true)).intakes[0].dob, "1991-02-03");
    assert.equal((await requestNcTracksJob(a.id, staff.id, input)).id, initial.id);
    assert.equal((await requestNcTracksJob(a.id, staff.id, { ...input, idempotencyKey: "synthetic-second-key" })).id, initial.id);
    assert.equal((await requestNcTracksJob(a.id, staff.id, { ...input, firstName: "synthetic", lastName: "compound   person", idempotencyKey: "synthetic-case-key" })).id, initial.id);
    await rejected(() => requestNcTracksJob(a.id, staff.id, { ...input, dob: "1991-02-04" }));
    await rejected(() => requestNcTracksJob(b.id, staff.id, input), 404);
    await configureNcTracks(a.id, staff.id, { action: "configure", authorizedNpi: "1134943608" });
    const registration = await configureNcTracks(a.id, staff.id, { action: "provision_host", hostName: "Synthetic Host" });
    assert(registration.hostToken); const token = registration.hostToken;
    assert.notEqual((await prisma.ncTracksHost.findUniqueOrThrow({ where: { providerId: a.id } })).credentialHash, token);
    assert.equal((await claimNcTracks(token)).job, null, "No ready adapter, no job");
    await heartbeatNcTracks(token, { adapterReady: true });
    initial = await changeNcTracksJob(a.id, staff.id, initial.id, "retry"); assert.equal(initial.status, "QUEUED");
    const first = (await claimNcTracks(token)).job!; assert(first); assert.equal(first.attempt, 1);
    assert.equal((await claimNcTracks(token)).job, null, "Only one job per host");
    assert.equal((await cancel(req("jobs/cancel", b.id, {}), { params: Promise.resolve({ id: first.id }) })).status, 403);
    await changeNcTracksJob(a.id, staff.id, first.id, "cancel");
    await rejected(() => resultNcTracks(token, first.id, evidence(first)));
    await changeNcTracksJob(a.id, staff.id, first.id, "retry");
    const second = (await claimNcTracks(token)).job!; assert.equal(second.attempt, 2); assert.notEqual(second.leaseToken, first.leaseToken);
    await rejected(() => heartbeatNcTracks(token, { adapterReady: true, jobId: first.id, leaseToken: first.leaseToken }));
    await rejected(() => resultNcTracks(token, second.id, { ...evidence(second), subject: second.subject }), 400);
    await rejected(() => resultNcTracks(token, second.id, { ...evidence(second), localPath: "C:/not-allowed.pdf" }), 400);
    const accepted = await resultNcTracks(token, second.id, evidence(second));
    assert.equal(accepted.status, "VERIFIED_LOCAL"); assert.equal(accepted.result?.subject.midNumber, "001234567A");
    assert(!JSON.stringify(accepted).includes(second.leaseToken));
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).midNumber, "  ", "Never auto-apply observed MID");
    await rejected(() => resultNcTracks(token, second.id, evidence(second)));
    // Changed provider configuration invalidates work and a retry deduplicates against the NEW NPI.
    const old = await requestNcTracksJob(a.id, staff.id, { ...input, serviceDateTo: "2026-09-07", idempotencyKey: "synthetic-change-npi" });
    const oldLease = (await claimNcTracks(token)).job!;
    await rejected(() => configureNcTracks(a.id, staff.id, { action: "configure", authorizedNpi: "1999999976" }), 400);
    // Simulate a legacy job from a different NPI; saving the fixed provider invalidates its lease.
    await prisma.ncTracksJob.update({ where: { id: old.id }, data: { authorizedNpi: "1234567893", dedupKey: "legacy-other-npi" } });
    await configureNcTracks(a.id, staff.id, { action: "configure", authorizedNpi: "1134943608" });
    await rejected(() => heartbeatNcTracks(token, { adapterReady: true, jobId: oldLease.id, leaseToken: oldLease.leaseToken }));
    const replacement = await requestNcTracksJob(a.id, staff.id, { ...input, serviceDateTo: "2026-09-07", idempotencyKey: "synthetic-new-npi-key" });
    assert.equal((await changeNcTracksJob(a.id, staff.id, old.id, "retry")).id, replacement.id);
    // A lease expiry releases the queue; the old lease cannot submit afterward.
    const expired = (await claimNcTracks(token)).job!;
    await prisma.ncTracksJob.update({ where: { id: expired.id }, data: { leaseExpiresAt: new Date(Date.now() - 1) } });
    const renewed = (await claimNcTracks(token)).job!; assert.equal(renewed.id, expired.id); assert.notEqual(renewed.leaseToken, expired.leaseToken);
    await rejected(() => resultNcTracks(token, expired.id, evidence(expired)));
    // Same-provider host credentials cannot be used to claim another provider's job.
    const hostB = await configureNcTracks(b.id, staff.id, { action: "provision_host", hostName: "Synthetic Other Host" }); assert(hostB.hostToken);
    const tokenB = hostB.hostToken;
    await rejected(() => resultNcTracks(tokenB, renewed.id, evidence(renewed)));
    const conflict = await resultNcTracks(token, renewed.id, { ...evidence(renewed), subject: { ...renewed.subject, lastName: "Wrong Person" } });
    assert.equal(conflict.status, "REVIEW_REQUIRED"); assert.equal(conflict.result, null);
    await changeNcTracksJob(a.id, staff.id, renewed.id, "retry");
    const identityLease = (await claimNcTracks(token)).job!;
    await prisma.client.update({ where: { id: client.id }, data: { dob: "1992-02-03" } });
    const stale = await resultNcTracks(token, identityLease.id, evidence(identityLease)); assert.equal(stale.status, "REVIEW_REQUIRED");
    await rejected(() => changeNcTracksJob(a.id, staff.id, stale.id, "retry"));
    await configureNcTracks(a.id, staff.id, { action: "revoke_host" });
    await rejected(() => claimNcTracks(token), 401);
    await prisma.userMembership.update({ where: { userId_providerId: { userId: staff.id, providerId: a.id } }, data: { role: "REVIEWER" } });
    assert.equal((await create(req("jobs", a.id, input))).status, 403);
    assert.equal((await configure(req("config", a.id, { action: "revoke_host" }))).status, 403);
    assert.equal((await context(req("context", a.id))).status, 200);
    console.log("NCTracks jobs passed: provider/role isolation, NPI checks, queue, deduplication, lease expiry, cancellation, identity conflict, evidence requirements, credential revocation and no automatic answer writes.");
  } finally { bindTestCookies(null); await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
