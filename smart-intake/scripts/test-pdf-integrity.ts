import assert from "assert";
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fillPacket } from "../src/lib/fillPdf";
import {
  isEssentialWellnessPacket,
  packetFillFieldsForTemplate,
} from "../src/lib/providerPacketTemplates";
import type { FieldMapping } from "../src/config/mooreDivinePacketMap";

const PAGE_COUNT = 39;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

async function createSyntheticEssentialWellnessTemplate(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < PAGE_COUNT; index++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText("Name", { x: 48, y: 728, size: 7, font });
    page.drawText("DOB", { x: 190, y: 728, size: 7, font });
    page.drawText("MID", { x: 266, y: 728, size: 7, font });
    page.drawText("Record", { x: 356, y: 728, size: 7, font });
    page.drawText("Intake Date", { x: 442, y: 728, size: 7, font });
    page.drawText(`Synthetic form body page ${index + 1}`, { x: 50, y: 650, size: 10, font });
    page.drawText(`Page ${index + 1} of 38`, { x: 274, y: 15, size: 8, font, color: rgb(0, 0, 0) });
  }
  return doc.save({ useObjectStreams: false });
}

function headerField(
  fieldKey: string,
  source: string,
  x: number,
  width: number,
): FieldMapping {
  return {
    page: 1,
    fieldKey,
    source,
    type: source === "dob" || source === "intake_date" ? "date" : "text",
    x,
    y: 710,
    width,
    height: 13,
    fontSize: 9,
    lines: 1,
    lineHeight: 11,
    required: false,
    role: "auto",
    consentKey: null,
    notes: "Reviewed Essential Wellness page-one identity header",
  };
}

async function extractPageTexts(pdfBytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: pdfBytes, useSystemFonts: true }).promise;
  const texts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return texts;
}

async function main() {
  const identity = {
    name: "Provider Intake Packet sample",
    originalFileName: "E.W.C.-INTAKE-FORM.pdf",
    pageCount: PAGE_COUNT,
    providerSpecific: true,
  };
  assert.equal(isEssentialWellnessPacket(identity), true);
  assert.equal(isEssentialWellnessPacket({ ...identity, originalFileName: "other.pdf" }), false);

  const reviewedMap: FieldMapping[] = [
    headerField("map_name_p1", "client_full_name", 75, 125),
    headerField("map_dob_p1", "dob", 207, 68),
    headerField("map_mid_p1", "mid_number", 279, 78),
    headerField("map_record_p1", "record_number", 359, 88),
    headerField("map_intake_date_p1", "intake_date", 452, 88),
    {
      ...headerField("map_presenting_p4", "presenting_problem", 60, 420),
      page: 4,
      y: 500,
      notes: "Reviewed non-header placement that must remain unchanged",
    },
  ];
  const fields = packetFillFieldsForTemplate(identity, reviewedMap);
  assert(fields.some((field) => field.fieldKey === "map_presenting_p4"));
  assert(!fields.some((field) => field.fieldKey === "home_street"), "must not inherit another provider's map");
  const unrelatedFields = packetFillFieldsForTemplate({ ...identity, originalFileName: "other.pdf" }, reviewedMap);
  assert.deepEqual(unrelatedFields, reviewedMap, "unrelated provider packets must remain unchanged");

  const headerSources = ["client_full_name", "dob", "mid_number", "record_number", "intake_date"];
  for (let page = 1; page <= PAGE_COUNT; page++) {
    for (const source of headerSources) {
      assert(
        fields.some((field) => field.page === page && field.source === source && field.y >= 650),
        `missing ${source} header on page ${page}`,
      );
    }
    assert(fields.some((field) => field.fieldKey === `ewc_pdf_page_number_p${page}`));
  }

  const templateBytes = await createSyntheticEssentialWellnessTemplate();
  const result = await fillPacket({
    templateBytes,
    fields,
    answers: {
      client_full_name: "Sample Client",
      dob: "2000-01-02",
      mid_number: "SAMPLE-MID",
      record_number: "SAMPLE-RECORD",
      intake_date: "2026-08-29",
      presenting_problem: "Synthetic test only",
    },
    signatures: {},
    consents: {},
  });
  // pdfjs transfers/detaches a plain Uint8Array's backing buffer while
  // loading, so persist the visual-QA artifact before text extraction.
  const outputPath = path.join(process.cwd(), "tmp", "pdfs", "ewc-pdf-integrity-smoke.pdf");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(result.pdfBytes));
  const texts = await extractPageTexts(result.pdfBytes);
  assert.equal(texts.length, PAGE_COUNT);
  for (let index = 0; index < texts.length; index++) {
    assert(texts[index].includes("Sample Client"), `client identity missing on PDF page ${index + 1}`);
    assert(texts[index].includes(`Page ${index + 1} of ${PAGE_COUNT}`), `correct page total missing on PDF page ${index + 1}`);
  }

  console.log(`PDF integrity regression passed: ${texts.length} pages, repeated identity on every page.`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
