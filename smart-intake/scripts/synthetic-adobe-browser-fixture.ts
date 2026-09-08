import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../src/lib/prisma";
import { saveFile } from "../src/lib/storage";

async function main() {
  assert.match(process.env.DATABASE_URL || "", /codex-adobe-browser\.db$/);
  assert.equal(await prisma.provider.count(), 0, "Only use a new disposable database.");
  const provider = await prisma.provider.create({ data: { name: "SYNTHETIC Adobe Test Provider", slug: "synthetic-adobe" } });
  const user = await prisma.user.create({ data: { name: "SYNTHETIC Review Staff", email: "synthetic-adobe@example.invalid", passwordHash: await bcrypt.hash("SyntheticAdobe2026!", 10), memberships: { create: { providerId: provider.id, role: "PROVIDER_ADMIN" } } } });
  const client = await prisma.client.create({ data: { providerId: provider.id, fullName: "SYNTHETIC Adobe Client", dob: "1990-01-01", recordNumber: "SYNTHETIC-ADOBE" } });
  const intake = await prisma.intake.create({ data: { providerId: provider.id, clientId: client.id, token: "synthetic-adobe-browser-test-token", tokenExpiresAt: new Date(Date.now() + 86400000), answers: { create: [ { key: "client_full_name", value: JSON.stringify(client.fullName) }, { key: "dob", value: JSON.stringify(client.dob) } ] } } });
  const pdf = await PDFDocument.create();
  for (let page = 1; page <= 3; page++) { const item = pdf.addPage([612, 792]); item.drawText(`SYNTHETIC ADOBE REVIEW - PAGE ${page}`, { x: 40, y: 750, size: 18 }); item.drawText("This document contains no real client information.", { x: 40, y: 700, size: 12 }); }
  const filePath = `synthetic-adobe-browser/${intake.id}/packet.pdf`;
  saveFile(filePath, Buffer.from(await pdf.save()));
  await prisma.generatedPdf.create({ data: { intakeId: intake.id, filePath, contentRevision: 1 } });
  await prisma.pdfTemplate.create({ data: { providerId: provider.id, name: "Synthetic Adobe Browser Template", filePath, originalFileName: "synthetic-adobe.pdf", pageCount: 3, pageWidth: 612, pageHeight: 792, mappingStatus: "APPROVED", mappingScore: 100, approvedAt: new Date(), approvedByUserId: user.id, fieldMappings: { create: { fieldKey: "synthetic_name", page: 1, data: JSON.stringify({ source: "client_full_name", type: "text", x: 40, y: 650, width: 450, height: 20, fontSize: 12, required: false }) } } } });
  console.log(JSON.stringify({ intakeId: intake.id, providerId: provider.id, login: "synthetic-adobe@example.invalid" }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
