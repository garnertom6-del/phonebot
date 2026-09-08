/**
 * Acrobat Pro first-slice + Adobe PDF Services stub.
 * Does not require a seeded database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACROBAT_PACKET_DOWNLOAD_HELP,
  ACROBAT_SCAN_OCR_TIP,
  ACROBAT_TEMPLATE_PREP_TIP,
  DOWNLOAD_FOR_ACROBAT_DRAFT,
  DOWNLOAD_FOR_ACROBAT_FINAL,
  acrobatDownloadLabel,
  packetAcrobatDownloadHref,
  packetPdfContentDisposition,
} from "../src/lib/adobeAcrobatPrep";
import {
  PDF_SERVICES_CLIENT_ID_ENV,
  PDF_SERVICES_CLIENT_SECRET_ENV,
  adobePdfServicesConfigured,
  adobePdfServicesStatus,
  maybeOcrUploadedPdf,
  maybeOptimizeGeneratedPacket,
} from "../src/lib/adobePdfServices";
import { packetDownloadFileName } from "../src/lib/draftPdf";

function src(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function main() {
  const previousId = process.env[PDF_SERVICES_CLIENT_ID_ENV];
  const previousSecret = process.env[PDF_SERVICES_CLIENT_SECRET_ENV];
  delete process.env[PDF_SERVICES_CLIENT_ID_ENV];
  delete process.env[PDF_SERVICES_CLIENT_SECRET_ENV];

  try {
    assert.equal(adobePdfServicesConfigured(), false);
    const missing = adobePdfServicesStatus();
    assert.equal(missing.configured, false);
    assert.equal(missing.ocrEnabled, false);
    assert.equal(missing.optimizeEnabled, false);
    assert.equal(missing.signEnabled, false, "Acrobat Sign must stay off; DocuSign is the live e-sign path");

    const original = Buffer.from("%PDF-1.7 synthetic acrobat stub");
    const ocr = await maybeOcrUploadedPdf(original, "application/pdf");
    const optimized = await maybeOptimizeGeneratedPacket(original);
    assert.equal(ocr.equals(original), true, "OCR stub must return original bytes when env is missing");
    assert.equal(optimized.equals(original), true, "optimize stub must return original bytes when env is missing");

    process.env[PDF_SERVICES_CLIENT_ID_ENV] = "synthetic-client-id";
    process.env[PDF_SERVICES_CLIENT_SECRET_ENV] = "synthetic-client-secret";
    assert.equal(adobePdfServicesConfigured(), true);
    const configured = adobePdfServicesStatus();
    assert.equal(configured.configured, true);
    assert.equal(configured.ocrEnabled, false, "OCR stays disabled until Codex implements PDF Services");
    assert.equal(configured.optimizeEnabled, false);
    assert.equal(configured.signEnabled, false);
    const ocrConfigured = await maybeOcrUploadedPdf(original, "application/pdf");
    const optimizedConfigured = await maybeOptimizeGeneratedPacket(original);
    assert.equal(ocrConfigured.equals(original), true, "configured-but-unimplemented OCR must not throw or rewrite bytes");
    assert.equal(optimizedConfigured.equals(original), true);
  } finally {
    if (previousId === undefined) delete process.env[PDF_SERVICES_CLIENT_ID_ENV];
    else process.env[PDF_SERVICES_CLIENT_ID_ENV] = previousId;
    if (previousSecret === undefined) delete process.env[PDF_SERVICES_CLIENT_SECRET_ENV];
    else process.env[PDF_SERVICES_CLIENT_SECRET_ENV] = previousSecret;
  }

  assert.equal(acrobatDownloadLabel("CURRENT_FINAL"), DOWNLOAD_FOR_ACROBAT_FINAL);
  assert.equal(acrobatDownloadLabel("DRAFT_PREVIEW"), DOWNLOAD_FOR_ACROBAT_DRAFT);
  assert.equal(packetAcrobatDownloadHref("intake-1", "CURRENT_FINAL"), "/api/intakes/intake-1/pdf?download=1");
  assert.equal(packetAcrobatDownloadHref("intake-1", "DRAFT_PREVIEW"), "/api/intakes/intake-1/pdf?preview=1&download=1");
  assert.equal(
    packetPdfContentDisposition("Moore-Divine-Care-Intake-Angela-Demo-DRAFT.pdf", "attachment"),
    'attachment; filename="Moore-Divine-Care-Intake-Angela-Demo-DRAFT.pdf"',
  );
  assert.equal(
    packetDownloadFileName({ providerName: "Moore Divine Care", clientName: "Angela Demo", documentState: "DRAFT_PREVIEW" }),
    "Moore-Divine-Care-Intake-Angela-Demo-DRAFT.pdf",
    "draft -DRAFT.pdf naming must stay in place",
  );

  const casePage = src("src/app/intakes/[id]/page.tsx");
  const previewPage = src("src/app/intakes/[id]/pdf-preview/page.tsx");
  const createPage = src("src/app/intakes/new/page.tsx");
  const masterPage = src("src/app/master/dashboard/page.tsx");
  const mappingPage = src("src/app/admin/pdf-mapping/page.tsx");
  const dashboardPage = src("src/app/dashboard/page.tsx");
  const pdfRoute = src("src/app/api/intakes/[id]/pdf/route.ts");
  const ccaRoute = src("src/app/api/intakes/[id]/cca/route.ts");
  const ncTracksRoute = src("src/app/api/intakes/[id]/nctracks-upload/route.ts");
  const tipComponent = src("src/components/AcrobatPrepTip.tsx");
  const prepCopy = src("src/lib/adobeAcrobatPrep.ts");
  const stub = src("src/lib/adobePdfServices.ts");
  const envExample = src(".env.example");
  const generatePacket = src("src/lib/generatePacket.ts");
  const docusign = src("src/lib/docusign.ts");
  const sendDocuSign = src("src/lib/sendDocuSign.ts");

  assert(casePage.includes('data-testid="download-for-acrobat"'));
  assert(casePage.includes("packetAcrobatDownloadHref"));
  assert(casePage.includes('variant="download"'));
  assert(casePage.includes('variant="scan"'));
  assert(previewPage.includes('data-testid="download-for-acrobat"'));
  assert(previewPage.includes("packetAcrobatDownloadHref"));
  assert(previewPage.includes('variant="download"'));
  assert(createPage.includes('variant="scan"'));
  assert(createPage.includes("AcrobatPrepTip"));
  assert(masterPage.includes('variant="template"'));
  assert(mappingPage.includes('variant="template"'));
  assert(dashboardPage.includes('data-testid="download-for-acrobat"'));
  assert(dashboardPage.includes('variant="scan"'));
  assert(tipComponent.includes("ACROBAT_PACKET_DOWNLOAD_HELP"));
  assert(tipComponent.includes("ACROBAT_TEMPLATE_PREP_TIP"));
  assert(tipComponent.includes("ACROBAT_SCAN_OCR_TIP"));
  assert(prepCopy.includes(ACROBAT_PACKET_DOWNLOAD_HELP));
  assert(prepCopy.includes(ACROBAT_TEMPLATE_PREP_TIP));
  assert(prepCopy.includes(ACROBAT_SCAN_OCR_TIP));
  assert(ACROBAT_TEMPLATE_PREP_TIP.includes("AcroForm"));
  assert(ACROBAT_SCAN_OCR_TIP.includes("MID"));
  assert(ACROBAT_SCAN_OCR_TIP.includes("PCP"));
  assert(pdfRoute.includes("packetPdfContentDisposition"));
  assert(pdfRoute.includes('explicitDownload ? "attachment" : "inline"'));
  assert(ccaRoute.includes("maybeOcrUploadedPdf"));
  assert(ncTracksRoute.includes("maybeOcrUploadedPdf"));
  assert(stub.includes(PDF_SERVICES_CLIENT_ID_ENV));
  assert(stub.includes(PDF_SERVICES_CLIENT_SECRET_ENV));
  assert(stub.includes("DocuSign remains the live e-sign"));
  assert(envExample.includes("PDF_SERVICES_CLIENT_ID="));
  assert(envExample.includes("PDF_SERVICES_CLIENT_SECRET="));
  assert(generatePacket.includes("maybeOptimizeGeneratedPacket"));
  assert(docusign.includes("export async function createDocuSignEnvelope"));
  assert(sendDocuSign.includes("sendIntakeToDocuSign"));
  assert(casePage.includes("DocuSign"));
  assert(dashboardPage.includes("sendDocuSign"));
  assert(createPage.includes("Create and show QR"));
  assert(!casePage.includes("Download final PDF"), "case page uses Download for Acrobat instead of the old final-only control");

  console.log("ok acrobat prep tips, download affordances, and PDF Services stub");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
