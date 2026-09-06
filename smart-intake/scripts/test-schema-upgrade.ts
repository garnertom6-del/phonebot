import assert from "node:assert/strict";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { isolatedSqlite } from "./isolatedSqlite";

async function main() {
  const context = isolatedSqlite("schema-upgrade-tests.db");
  const before = fs.readFileSync("scripts/fixtures/pre-workflow-schema.prisma", "utf8");
  const after = fs.readFileSync("prisma/schema.prisma", "utf8");
  assert.match(before, /054376c376273902fb59cf41ec2c7eca9042259c/, "Keep the historical migration fixture pinned after new changes are committed.");
  assert(!/model SupportReferral\s*\{/.test(before));
  const prisma = new PrismaClient({ datasources: { db: { url: context.databaseUrl } } });
  try {
    context.pushSchema(before, "before.prisma");
    const timestamp = new Date("2026-01-15T12:00:00.000Z");
    const legacyPlans = ["Vaya Health", "Trillium Health Resources", "Alliance Health", "Partners Health Management", "Cardinal Innovations", "Sandhills Center", "Medicaid", "Self Pay", "Uninsured", "United Health Care"];
    await prisma.$executeRaw`INSERT INTO "Provider" ("id","name","slug","status","updatedAt") VALUES ('upgrade-provider','Synthetic Upgrade Provider','synthetic-upgrade-provider','ACTIVE',${timestamp})`;
    await prisma.$executeRaw`INSERT INTO "User" ("id","email","passwordHash","name","role") VALUES ('upgrade-user','synthetic-upgrade@example.invalid','test-only-not-a-login','Synthetic Staff','staff')`;
    await prisma.$executeRaw`INSERT INTO "UserMembership" ("id","userId","providerId","role","active") VALUES ('upgrade-membership','upgrade-user','upgrade-provider','STAFF',1)`;
    for (const [index, plan] of legacyPlans.entries()) {
      const clientId = `upgrade-client-${index}`;
      const intakeId = `upgrade-intake-${index}`;
      const record = `TEST-${index}`;
      const answerId = `upgrade-plan-answer-${index}`;
      const noteId = `upgrade-note-answer-${index}`;
      const signatureId = `upgrade-signature-${index}`;
      const token = `synthetic-upgrade-token-${index}`;
      const value = JSON.stringify(plan);
      const note = JSON.stringify(`Synthetic untouched answer ${index}: punctuation & line\nbreak.`);
      const signatureImage = `data:image/png;base64,SYNTHETIC_UNCHANGED_${index}`;
      await prisma.$executeRaw`INSERT INTO "Client" ("id","providerId","fullName","dob","recordNumber") VALUES (${clientId},'upgrade-provider','Synthetic Upgrade Client','1990-01-01',${record})`;
      await prisma.$executeRaw`INSERT INTO "Intake" ("id","providerId","clientId","token","tokenExpiresAt","status","updatedAt","contentRevision") VALUES (${intakeId},'upgrade-provider',${clientId},${token},${timestamp},'SIGNED',${timestamp},7)`;
      await prisma.$executeRaw`INSERT INTO "IntakeAnswer" ("id","intakeId","key","value","updatedAt") VALUES (${answerId},${intakeId},'provider_choice_plan',${value},${timestamp})`;
      await prisma.$executeRaw`INSERT INTO "IntakeAnswer" ("id","intakeId","key","value","updatedAt") VALUES (${noteId},${intakeId},'presenting_problem',${note},${timestamp})`;
      await prisma.$executeRaw`INSERT INTO "Signature" ("id","intakeId","role","imageData","printedName","signedDate","dobVerified","contentRevision","subjectNameSnapshot","subjectDobSnapshot","createdAt","updatedAt") VALUES (${signatureId},${intakeId},'client',${signatureImage},'Synthetic Upgrade Client','2026-01-15',1,7,'Synthetic Upgrade Client','1990-01-01',${timestamp},${timestamp})`;
    }
    await prisma.$executeRaw`INSERT INTO "Referral" ("id","intakeId","slot","name","phone") VALUES ('upgrade-legacy-referral','upgrade-intake-0',1,'Synthetic Packet Referral','2025550101')`;
    const oldAnswers = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT "id","intakeId","key","value","updatedAt" FROM "IntakeAnswer" ORDER BY "id"`;
    const oldSignatures = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "Signature" ORDER BY "id"`;
    const oldClients = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "Client" ORDER BY "id"`;
    const oldIntakes = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT "id","status","contentRevision","token","updatedAt" FROM "Intake" ORDER BY "id"`;
    const oldReferral = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "Referral"`;
    await prisma.$disconnect();
    // No --accept-data-loss, --force-reset, or source database connection.
    context.pushSchema(after, "after.prisma");
    assert.deepEqual(await prisma.$queryRaw`SELECT "id","intakeId","key","value","updatedAt" FROM "IntakeAnswer" ORDER BY "id"`, oldAnswers, "all answer values and timestamps remain unchanged");
    assert.deepEqual(await prisma.$queryRaw`SELECT * FROM "Signature" ORDER BY "id"`, oldSignatures, "signature bytes, identity bindings, dates and revisions remain unchanged");
    assert.deepEqual(await prisma.$queryRaw`SELECT * FROM "Client" ORDER BY "id"`, oldClients);
    assert.deepEqual(await prisma.$queryRaw`SELECT "id","status","contentRevision","token","updatedAt" FROM "Intake" ORDER BY "id"`, oldIntakes);
    assert.deepEqual(await prisma.$queryRaw`SELECT * FROM "Referral"`, oldReferral, "legacy packet referrals remain intact");
    const upgradedAnswers = await prisma.intakeAnswer.findMany({ orderBy: { id: "asc" } });
    assert.equal(upgradedAnswers.length, legacyPlans.length * 2);
    assert(upgradedAnswers.every((answer) => answer.revision === 1), "existing answers receive revision 1");
    assert.deepEqual(new Set(upgradedAnswers.filter((answer) => answer.key === "provider_choice_plan").map((answer) => JSON.parse(answer.value))), new Set(legacyPlans), "legacy insurance plan strings are not renamed or normalized by migration");
    const upgradedIntakes = await prisma.intake.findMany();
    assert(upgradedIntakes.every((intake) => intake.workflowOwnerUserId === null && intake.abandonedAt === null), "existing cases receive no inferred owner or abandonment");
    assert.equal(await prisma.supportReferral.count(), 0, "upgrade does not invent support referrals");
    assert.equal(await prisma.supportReferralEvent.count(), 0);
    assert.equal(await prisma.workflowInterval.count(), 0, "upgrade does not backfill inferred waiting history");
    console.log(`Schema upgrade: ${legacyPlans.length} legacy plan values, ${oldAnswers.length} answers, ${oldSignatures.length} signatures, client/intake rows and packet referrals preserved; additive defaults verified without data-loss approval.`);
  } finally {
    await prisma.$disconnect();
    context.cleanup();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
