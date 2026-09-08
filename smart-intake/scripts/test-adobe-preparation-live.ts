// Explicit opt-in, synthetic local database only. Never use this against production/client records.
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "../src/lib/prisma";
import { uploadPreparationFile, startPreparationJob, refreshPreparationJob, readPreparationFile } from "../src/lib/adobePreparation";
import { ADOBE_OPERATIONS, estimatedAdobeUnits } from "../src/lib/adobePreparationTypes";

async function main() {
  assert.equal(process.argv[2], "--run-synthetic-cloud-test", "Explicit opt-in required: uses Adobe transactions for synthetic files.");
  assert.match(process.env.DATABASE_URL || "", /codex-adobe-browser\.db$/);
  const credential = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  assert(credential.CLIENT_ID && credential.CLIENT_SECRETS?.[0]);
  process.env.ADOBE_PDF_SERVICES_CLIENT_ID = credential.CLIENT_ID;
  process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET = credential.CLIENT_SECRETS[0];
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "synthetic-adobe@example.invalid" } });
  const membership = await prisma.userMembership.findFirstOrThrow({ where: { userId: user.id } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: membership.providerId } });
  assert.match(provider.name, /synthetic/i);
  const scope = { providerId: provider.id, userId: user.id };
  if (process.argv.includes("--resume-pending")) {
    // The guarded local test process was stopped. Recover recorded remote jobs without resubmitting.
    const pending = await prisma.adobePreparationJob.findMany({ where: { providerId: provider.id, status: "RUNNING" } });
    for (const job of pending) {
      await prisma.adobePreparationJob.update({ where: { id: job.id }, data: { leaseUntil: null, leaseToken: null, nextPollAt: null } });
      await refreshPreparationJob(scope, job.id);
      console.log(`Recovered ${job.operation}: ${(await prisma.adobePreparationJob.findUniqueOrThrow({ where: { id: job.id } })).status}`);
    }
    const protectedJob = await prisma.adobePreparationJob.findFirstOrThrow({ where: { providerId: provider.id, operation: "protect", status: "DONE" }, orderBy: { createdAt: "desc" } });
    const protectedFile = await prisma.adobePreparationFile.findFirstOrThrow({ where: { jobId: protectedJob.id } });
    const job = await startPreparationJob(scope, { idempotencyKey: randomUUID(), operation: "unprotect", inputIds: [protectedFile.id], options: { password: "Synthetic-Only-Adobe-2026!" }, confirmedNoClientData: true, acknowledgedUnits: estimatedAdobeUnits("unprotect", protectedFile.pageCount || 50) });
    for (let attempt = 0; attempt < 35; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 3500)); await refreshPreparationJob(scope, job.id);
      if ((await prisma.adobePreparationJob.findUniqueOrThrow({ where: { id: job.id } })).status !== "RUNNING") break;
    }
    const results = [];
    for (const operation of ADOBE_OPERATIONS) {
      const latest = await prisma.adobePreparationJob.findFirstOrThrow({ where: { providerId: provider.id, operation: operation.id }, orderBy: { createdAt: "desc" } });
      const outputs = await prisma.adobePreparationFile.findMany({ where: { jobId: latest.id } });
      results.push({ operation: operation.id, status: latest.status, outputs: outputs.map(o => ({ name: o.name, byteCount: o.byteCount, pageCount: o.pageCount })), message: latest.message });
      console.log(`${operation.id}: ${latest.status}; ${outputs.length} output(s)`);
    }
    if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify({ testedAt: new Date().toISOString(), syntheticOnly: true, results }, null, 2));
    assert(results.every(r => ["DONE", "NO_CHANGE"].includes(r.status)), "One or more live operations need attention.");
    delete process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET; await prisma.$disconnect(); return;
  }
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`SYNTHETIC BLANK FORM - PAGE ${i}`, { x: 40, y: 740, size: 16, font });
    page.drawText("No client information. Adobe integration test only.", { x: 40, y: 710, size: 11, font });
    page.drawText("Name: ______________________      Date: __________", { x: 40, y: 665, size: 12, font });
    page.drawText("Item                      Quantity                 Notes", { x: 40, y: 605, size: 12, font });
    page.drawText("Sample form A          1                           Test only", { x: 40, y: 570, size: 12, font });
    page.drawText("Sample form B          2                           Test only", { x: 40, y: 540, size: 12, font });
  }
  const bytes = Buffer.from(await doc.save());
  const base = await uploadPreparationFile(scope, bytes, "synthetic-adobe-two-pages.pdf", true);
  const one = await PDFDocument.create(); const [page] = await one.copyPages(doc, [0]); one.addPage(page);
  const second = await uploadPreparationFile(scope, Buffer.from(await one.save()), "synthetic-adobe-one-page.pdf", true);
  const text = await uploadPreparationFile(scope, Buffer.from("SYNTHETIC BLANK FORM\nNo client information.\nName: ______________\nDate: ______________\n"), "synthetic-adobe.txt", true);
  const results: { operation: string; status: string; outputs: string[]; message?: string | null }[] = [];
  let protectedId: string | undefined;
  try {
    for (const operation of ADOBE_OPERATIONS) {
      const multi = ["combine", "insert", "replace", "watermark"].includes(operation.id);
      const inputIds = operation.id === "create" ? [text.id] : operation.id === "unprotect" ? [protectedId || base.id] : multi ? [base.id, second.id] : [base.id];
      const pages = operation.id === "create" ? 50 : multi ? 3 : 2;
      const requested = await startPreparationJob(scope, { idempotencyKey: randomUUID(), operation: operation.id, inputIds, options: { pages: operation.id === "reorder" ? "2,1" : "1", pageSize: 1, basePage: 1, password: ["protect", "unprotect"].includes(operation.id) ? "Synthetic-Only-Adobe-2026!" : undefined }, confirmedNoClientData: true, acknowledgedUnits: estimatedAdobeUnits(operation.id, pages) });
      const deadline = Date.now() + 150000;
      let job;
      do {
        await new Promise(resolve => setTimeout(resolve, 3500));
        await refreshPreparationJob(scope, requested.id);
        job = await prisma.adobePreparationJob.findUniqueOrThrow({ where: { id: requested.id } });
      } while (job.status === "RUNNING" && Date.now() < deadline);
      const outputs = await prisma.adobePreparationFile.findMany({ where: { jobId: requested.id } });
      if (operation.id === "protect") protectedId = outputs[0]?.id;
      for (const output of outputs) assert((await readPreparationFile(scope, output.id)).bytes.length > 0);
      results.push({ operation: operation.id, status: job.status, outputs: outputs.map(o => `${o.name} (${o.byteCount} bytes, ${o.pageCount ?? "?"} pages)`), message: job.message });
      console.log(`${operation.id}: ${job.status}; ${outputs.length} output(s)`);
      if (job.status === "SUBMISSION_UNKNOWN") console.log("Submission uncertain; this test will not retry that operation.");
    }
    assert.deepEqual((await readPreparationFile(scope, base.id)).bytes, bytes);
    const target = process.argv[4];
    if (target) fs.writeFileSync(target, JSON.stringify({ testedAt: new Date().toISOString(), syntheticOnly: true, providerId: provider.id, results }, null, 2));
    const failures = results.filter(r => !["DONE", "NO_CHANGE"].includes(r.status));
    console.log(`Live Adobe synthetic tests: ${results.length - failures.length}/${results.length} completed.`);
    if (failures.length) process.exitCode = 1;
  } finally { delete process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET; await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Synthetic test failed."); process.exitCode = 1; });
