import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

async function main() {
  assert.match(process.env.DATABASE_URL || "", /(?:^file:\.\/|\/)codex-admin-browser\.db$/);
  const { prisma } = await import("../src/lib/prisma");
  try {
    assert.equal(await prisma.provider.count(), 0, "Fixture setup only runs on an empty disposable database");
    const passwordHash = await bcrypt.hash("SyntheticOld2026!", 10);
    const master = await prisma.user.create({ data: { email: "synthetic-master@example.invalid", name: "SYNTHETIC Master", role: "master", passwordHash: await bcrypt.hash("SyntheticMaster2026!", 10) } });
    const provider = await prisma.provider.create({ data: { name: "ZZ SYNTHETIC Delete This Provider", slug: "synthetic-delete-browser", email: "synthetic-admin@example.invalid", contactName: "SYNTHETIC Administrator" } });
    await prisma.user.create({ data: { email: "synthetic-admin@example.invalid", name: "SYNTHETIC Provider Admin", passwordHash, memberships: { create: { providerId: provider.id, role: "PROVIDER_ADMIN" } } } });
    const preserved = await prisma.provider.create({ data: { name: "ZZ SYNTHETIC Preserve This Provider", slug: "synthetic-preserve-browser" } });
    const client = await prisma.client.create({ data: { providerId: provider.id, fullName: "SYNTHETIC Deletion Browser Client", dob: "1991-02-03", email: "synthetic-client@example.invalid" } });
    const intake = await prisma.intake.create({ data: { clientId: client.id, providerId: provider.id, token: "synthetic-deletion-browser-client-token", tokenExpiresAt: new Date(Date.now() + 86400000), answers: { create: { key: "synthetic_test_only", value: "true" } } } });
    const filePath = "synthetic-admin-browser/test-upload.txt";
    fs.mkdirSync(path.resolve("storage/synthetic-admin-browser"), { recursive: true });
    fs.writeFileSync(path.resolve("storage", filePath), "SYNTHETIC DELETION BROWSER TEST ONLY");
    await prisma.uploadedDocument.create({ data: { intakeId: intake.id, docType: "other", filePath, fileName: "SYNTHETIC.txt", mimeType: "text/plain" } });
    await prisma.client.create({ data: { providerId: preserved.id, fullName: "SYNTHETIC Preserved Client", dob: "1991-02-03" } });
    console.log(JSON.stringify({ masterId: master.id, targetProviderId: provider.id, preservedProviderId: preserved.id, targetIntakeId: intake.id, database: "codex-admin-browser.db" }));
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
