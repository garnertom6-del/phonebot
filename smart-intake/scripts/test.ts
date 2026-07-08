/**
 * End-to-end verification (npm run test). Requires: npm run db:push && npm run seed.
 *  1. Staff login credentials verify against the seeded user
 *  2. Secure tokens are random and expire per config
 *  3. The ACTUAL packet PDF loads and has 43 pages
 *  4. fillPacket produces a PDF whose header carries the client name on ALL 43 pages
 *  5. Voice/typed answers land in the PDF (presenting problem on page 4 & 5)
 *  6. Consent signatures are placed on agreed forms; staff slots stay blank
 *  7. Required-field validation catches missing items
 *  8. Sample completed PDFs exist
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { fillPacket, loadTemplateBytes } from "../src/lib/fillPdf";
import { consentsFromAnswers, loadAnswers, loadSignatures } from "../src/lib/intakeData";
import { newIntakeToken, tokenExpiry } from "../src/lib/tokens";
import { missingRequired, percentComplete } from "../src/lib/validation";

const prisma = new PrismaClient();

async function extractPageTexts(pdfBytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  const texts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    texts.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  return texts;
}

async function main() {
  let passed = 0;
  const ok = (name: string) => { console.log(`✓ ${name}`); passed++; };

  // 1. staff login
  const user = await prisma.user.findUnique({ where: { email: "admin@mooredivinecare.local" } });
  assert(user, "seeded staff user missing - run npm run seed");
  assert(await bcrypt.compare("IntakeDemo123!", user!.passwordHash), "staff password mismatch");
  ok("staff login verifies (admin@mooredivinecare.local)");

  // 2. tokens
  const t1 = newIntakeToken(), t2 = newIntakeToken();
  assert(t1 !== t2 && t1.length >= 32, "tokens not random/long enough");
  const exp = tokenExpiry().getTime() - Date.now();
  assert(exp > 6.5 * 86400000 && exp < 7.5 * 86400000, "token expiry not ~7 days");
  ok("secure client tokens (random, 7-day expiry)");

  // 3. actual template
  const template = loadTemplateBytes();
  assert(template.length > 400000, "template PDF suspiciously small");
  ok("actual Moore Divine Care packet PDF loads");

  // 4-6. fill Angela's packet
  const client = await prisma.client.findFirst({
    where: { fullName: "Angela Demo" }, include: { intakes: true },
  });
  assert(client?.intakes[0], "Angela Demo not seeded");
  const intake = client!.intakes[0];
  const answers = await loadAnswers(intake.id);
  const signatures = await loadSignatures(intake.id);
  assert(signatures.client?.imageData.startsWith("data:image/png"), "client signature missing");
  const result = await fillPacket({ answers, signatures, consents: consentsFromAnswers(answers) });
  assert(result.filled > 200, `expected >200 filled fields, got ${result.filled}`);
  const texts = await extractPageTexts(result.pdfBytes);
  assert.strictEqual(texts.length, 43, `expected 43 pages, got ${texts.length}`);
  ok(`completed PDF has all 43 pages (${result.filled} fields filled)`);

  const missingHeaderPages = texts
    .map((t, i) => (t.includes("Angela Demo") ? null : i + 1))
    .filter((p): p is number => p !== null);
  assert.deepStrictEqual(missingHeaderPages, [], `client name missing from pages: ${missingHeaderPages}`);
  ok("repeated header (client name) present on every one of the 43 pages");

  assert(texts[3].includes("anxiety and depression"), "presenting problem not on page 4");
  assert(texts[4].includes("anxiety and depression"), "presenting problem not auto-filled on page 5");
  assert(texts[1].includes("Maplewood"), "address not on face sheet");
  assert(texts[16].includes("Angela Demo"), "on-call acknowledgment name missing (p17)");
  assert(texts[37].includes("Angela Demo"), "welcome letter name missing (p38)");
  ok("smart auto-fill places one answer in multiple pages (4, 5, 17, 38)");

  const sigKeys = ["sig_provider_choice", "sig_rights", "sig_hipaa", "sig_ecare", "cca_client_sig"];
  for (const k of sigKeys) {
    assert(!result.skipped.includes(k), `consented signature ${k} was skipped`);
  }
  assert(result.skipped.includes("cca_clinician_sig"), "staff clinician slot should stay blank");
  ok("signatures placed on consented forms; staff signature slots left blank");

  // consent NOT given -> signature withheld
  const noConsent = await fillPacket({
    answers, signatures,
    consents: { ...consentsFromAnswers(answers), consent_transport: false },
  });
  assert(noConsent.skipped.includes("sig_transport_client"), "transport signature should be withheld without consent");
  ok("signature only placed on forms the client agreed to sign");

  // 7. validation
  const missing = missingRequired({ client_full_name: "X" }, false);
  assert(missing.some((m) => m.key === "dob") && missing.some((m) => m.key === "signature"),
    "missingRequired failed to flag items");
  assert.strictEqual(missingRequired(answers, true).length, 0, "Angela should have no missing required");
  assert(percentComplete(answers) > 60, "percent complete unexpectedly low");
  ok("required-field validation + missing checklist");

  // 8. sample PDFs
  for (const f of ["sample-completed-angela-demo.pdf", "sample-completed-jayden-sample.pdf"]) {
    const p = path.join(process.cwd(), "output", f);
    assert(fs.existsSync(p) && fs.statSync(p).size > 300000, `${f} missing - run npm run generate:samples`);
  }
  ok("two sample completed PDFs exist in output/");

  // guardian signing for a minor
  const jayden = await prisma.client.findFirst({ where: { fullName: "Jayden Sample" }, include: { intakes: true } });
  const jAnswers = await loadAnswers(jayden!.intakes[0].id);
  const jSigs = await loadSignatures(jayden!.intakes[0].id);
  const jResult = await fillPacket({ answers: jAnswers, signatures: jSigs, consents: consentsFromAnswers(jAnswers) });
  assert(!jResult.skipped.includes("sig_provider_choice"), "guardian signature should satisfy client slots for a minor");
  assert(!jResult.skipped.includes("cca_guardian_sig"), "guardian CCA signature missing");
  ok("guardian signature flows to required slots for a youth client");

  console.log(`\nAll ${passed} checks passed ✓`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error("✗ TEST FAILED:", e.message); prisma.$disconnect(); process.exit(1); });
