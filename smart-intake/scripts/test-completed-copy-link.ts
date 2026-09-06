import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { createSessionValue, SESSION_COOKIE } from "../src/lib/auth";
import { bindTestCookies } from "../src/lib/requestCookies";
import { SELECTED_PROVIDER_COOKIE } from "../src/lib/staffGuard";
import { CompletedCopyLinkError, prepareCompletedCopyLink } from "../src/lib/completedCopyLink";
import { completionReadinessForIntake } from "../src/lib/completionReadiness";
import { findIntakeByCopyToken, copyLinkIsAvailable } from "../src/lib/completedCopiesLookup";
import { ensureCompletedCopyToken } from "../src/lib/copyTokens";
import { POST } from "../src/app/api/intakes/[id]/copies/link/route";

async function main() {
  assert.match(process.env.DATABASE_URL || "", /completed-copy-link-tests\.db$/, "Use the isolated completed-copy test runner.");
  const tag = randomUUID();
  const providers: string[] = [], users: string[] = [], clients: string[] = [], intakes: string[] = [];
  try {
    const provider = await prisma.provider.create({ data: { name: "Synthetic Copy Provider", slug: `copy-provider-${tag}` } }); providers.push(provider.id);
    const otherProvider = await prisma.provider.create({ data: { name: "Synthetic Other Provider", slug: `copy-other-${tag}` } }); providers.push(otherProvider.id);
    async function addUser(role: string, providerId: string) {
      const user = await prisma.user.create({ data: { name: `Synthetic ${role}`, email: `copy-${role}-${providerId}-${tag}@example.invalid`, passwordHash: "synthetic-not-a-login", role: "staff", memberships: { create: { providerId, role, active: true } } } }); users.push(user.id); return user;
    }
    const staff = await addUser("STAFF", provider.id), reviewer = await addUser("REVIEWER", provider.id), outsider = await addUser("STAFF", otherProvider.id);
    const client = await prisma.client.create({ data: { providerId: provider.id, fullName: "Synthetic Copy Client", dob: "1990-01-01" } }); clients.push(client.id);
    const intakeToken = `synthetic-intake-${tag}`;
    const intake = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, status: "COMPLETED", token: intakeToken, tokenExpiresAt: new Date(Date.now() - 86_400_000), submittedAt: new Date(), expectCca: false } }); intakes.push(intake.id);
    const packet = await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath: "synthetic-unused-packet.pdf", contentRevision: intake.contentRevision } });
    const request = new NextRequest(`http://localhost:3096/api/intakes/${intake.id}/copies/link`, { method: "POST" });
    const ready: NonNullable<Awaited<ReturnType<typeof completionReadinessForIntake>>> = {
      ready: true, blockers: [], packetState: "current",
      packet: { state: "current", pdfId: packet.id, filePath: packet.filePath, generatedAt: packet.createdAt, sourceUpdatedAt: null },
    };
    // Real scoped rows/token writes; readiness is supplied independently so token
    // behavior does not depend on unrelated packet mapping or clinical fixtures.
    const checkedReady: typeof completionReadinessForIntake = async (intakeId, providerId) => {
      assert.equal(intakeId, intake.id); assert.equal(providerId, provider.id); return ready;
    };
    const access = await prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady);
    const copyToken = new URL(access.link).pathname.split("/").at(-1)!;
    assert.notEqual(copyToken, intakeToken);
    assert.equal(access.packetId, packet.id);
    assert.equal(access.renewed, true);
    assert(new Date(access.expiresAt).getTime() > Date.now());
    assert.equal(await findIntakeByCopyToken(intakeToken), null, "the intake token never opens completed copies");
    const found = await findIntakeByCopyToken(copyToken);
    assert.equal(found?.id, intake.id);
    assert(found && copyLinkIsAvailable(found), "expired intake token does not block its live dedicated copy token");
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } })).token, intakeToken);
    const second = await prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady);
    assert.equal(second.link, access.link, "repeat requests reuse the current copies-only token");
    assert.equal(second.renewed, false);
    await prisma.intake.update({ where: { id: intake.id }, data: { copyTokenExpiresAt: new Date(Date.now() - 1000) } });
    const renewed = await prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady);
    assert.notEqual(renewed.link, access.link, "expired copy token is renewed independently");
    assert.equal(renewed.renewed, true);
    assert.equal(await findIntakeByCopyToken(copyToken), null);
    // Both the existing delivery path and the staff Copy link action may renew
    // an expired token. Every caller must return the same surviving token.
    await prisma.intake.update({ where: { id: intake.id }, data: { copyTokenExpiresAt: new Date(0) } });
    const simultaneous = await Promise.all([
      ensureCompletedCopyToken(intake.id),
      prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady),
      ensureCompletedCopyToken(intake.id),
      prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady),
    ]);
    const survivingToken = (await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } })).copyToken;
    assert.equal(simultaneous[0].copyToken, survivingToken);
    assert.equal(simultaneous[2].copyToken, survivingToken);
    assert.equal(new URL(simultaneous[1].link).pathname.split("/").at(-1), survivingToken);
    assert.equal(new URL(simultaneous[3].link).pathname.split("/").at(-1), survivingToken);
    assert.equal(Number(simultaneous[0].minted) + Number(simultaneous[1].renewed) + Number(simultaneous[2].minted) + Number(simultaneous[3].renewed), 1,
      "Only one concurrent request can mint a replacement; all others reuse it");
    await assert.rejects(prepareCompletedCopyLink(intake.id, otherProvider.id, request, checkedReady), (error: unknown) => error instanceof CompletedCopyLinkError && error.status === 404);
    for (const blocker of ["packet_stale", "packet_missing", "client_signature_invalid", "staff_signature_missing"] as const) {
      await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, async () => ({ ...ready, ready: false, blockers: [{ code: blocker, message: "Synthetic readiness blocker" }] })), (error: unknown) => error instanceof CompletedCopyLinkError && error.blockers[0]?.code === blocker);
    }
    for (const state of [{ archived: true }, { submittedAt: null }, { status: "SIGNED" }]) {
      await prisma.intake.update({ where: { id: intake.id }, data: state });
      await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady), CompletedCopyLinkError);
      await prisma.intake.update({ where: { id: intake.id }, data: { archived: false, submittedAt: intake.submittedAt, status: "COMPLETED" } });
    }
    await prisma.provider.update({ where: { id: provider.id }, data: { status: "INACTIVE" } });
    await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, checkedReady), CompletedCopyLinkError);
    await prisma.provider.update({ where: { id: provider.id }, data: { status: "ACTIVE" } });
    await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, async () => {
      await prisma.signature.create({ data: { intakeId: intake.id, role: "staff", imageData: "synthetic-not-an-image", printedName: "Synthetic Staff", signedDate: "2026-09-06", contentRevision: intake.contentRevision } });
      return ready;
    }), (error: unknown) => error instanceof CompletedCopyLinkError && /signature changed/.test(error.message));
    await prisma.signature.deleteMany({ where: { intakeId: intake.id } });
    let newPacketId = "";
    await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, async () => {
      const changed = await prisma.generatedPdf.create({ data: { intakeId: intake.id, packetVersion: 2, filePath: "synthetic-new-packet.pdf", contentRevision: intake.contentRevision, createdAt: new Date(packet.createdAt.getTime() + 1000) } });
      newPacketId = changed.id;
      return ready;
    }), (error: unknown) => error instanceof CompletedCopyLinkError && /changed/.test(error.message));
    await prisma.generatedPdf.delete({ where: { id: newPacketId } });
    await assert.rejects(prepareCompletedCopyLink(intake.id, provider.id, request, async () => {
      await prisma.intake.update({ where: { id: intake.id }, data: { contentRevision: { increment: 1 } } });
      return ready;
    }), (error: unknown) => error instanceof CompletedCopyLinkError && /changed/.test(error.message));
    function signIn(id: string | null) {
      const session = id ? createSessionValue(id) : undefined;
      bindTestCookies({ get: (name) => name === SESSION_COOKIE && session ? { value: session } : name === SELECTED_PROVIDER_COOKIE ? { value: provider.id } : undefined });
    }
    const params = { params: Promise.resolve({ id: intake.id }) };
    signIn(null); assert.equal((await POST(request, params)).status, 401);
    signIn(outsider.id); assert.equal((await POST(request, params)).status, 404);
    signIn(reviewer.id); assert.equal((await POST(request, params)).status, 403);
    signIn(staff.id);
    const unready = await POST(request, params);
    assert.equal(unready.status, 409, "actual route fails closed on real missing signatures and packet readiness");
    const unreadyBody = await unready.json();
    assert(unreadyBody.blockers.some((blocker: { code: string }) => blocker.code.includes("signature")));
    assert.equal((await prisma.intake.findUniqueOrThrow({ where: { id: intake.id } })).linkSentAt, null);
    assert.equal(await prisma.messageDelivery.count({ where: { intakeId: intake.id } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { intakeId: intake.id } }), 0, "preparing a URL never records a send or receipt");
    console.log("Completed-copy link: independent token and expiry, reuse/renewal, scope/read-only authorization, readiness/signature blockers, concurrent content/packet/signature changes, and no-send/no-receipt behavior passed.");
  } finally {
    bindTestCookies(null);
    await prisma.intake.deleteMany({ where: { id: { in: intakes } } });
    await prisma.client.deleteMany({ where: { id: { in: clients } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.provider.deleteMany({ where: { id: { in: providers } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
