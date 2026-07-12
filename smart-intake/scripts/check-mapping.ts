/**
 * Validates the PDF field mapping: page bounds, coordinate sanity, header
 * coverage on all 43 pages, and that every client/staff source key exists in
 * the question config. Run: npm run check:mapping
 */
import { PACKET_MAP } from "../src/config/mooreDivinePacketMap";
import { repairKnownPacketPlacements } from "../src/lib/providerPacketTemplates";
import { SECTIONS, STAFF_FIELDS, questionByKey } from "../src/config/mooreDivineQuestions";

const SPECIAL_SOURCES = new Set([
  "signature", "guardian_signature", "staff_signature", "clinician_signature",
  "medical_director_signature", "sign_date", "clinician_sign_date", "medical_director_sign_date",
  "initials", "signer_name", "screening_date", "hospitalizations_more",
]);

let errors = 0;
const warn: string[] = [];
const pagesWithHeader = new Set<number>();
const questionKeys = new Set<string>();
for (const s of SECTIONS) for (const q of s.questions) questionKeys.add(q.key);
for (const g of STAFF_FIELDS) for (const q of g.fields) questionKeys.add(q.key);

for (const f of PACKET_MAP.fields) {
  if (f.page < 1 || f.page > PACKET_MAP.pageCount) { console.error(`✗ ${f.fieldKey}: bad page ${f.page}`); errors++; }
  if (f.x < 0 || f.x > PACKET_MAP.pageWidth || f.y < 0 || f.y > PACKET_MAP.pageHeight) {
    console.error(`✗ ${f.fieldKey} (p${f.page}): out of bounds x=${f.x} y=${f.y}`); errors++;
  }
  if (f.width <= 0 || f.height <= 0) { console.error(`✗ ${f.fieldKey}: non-positive size`); errors++; }
  if (f.fieldKey.startsWith("hdr_")) pagesWithHeader.add(f.page);
  const baseKey = f.source.split(/[=~]/)[0];
  if (baseKey && !SPECIAL_SOURCES.has(baseKey) && !questionKeys.has(baseKey) && !questionKeys.has(f.source)) {
    warn.push(`? ${f.fieldKey} (p${f.page}): source '${baseKey}' has no question definition`);
  }
}

for (let p = 1; p <= PACKET_MAP.pageCount; p++) {
  if (!pagesWithHeader.has(p)) { console.error(`✗ page ${p} missing repeated header fields`); errors++; }
}

const repaired = repairKnownPacketPlacements(PACKET_MAP.fields, PACKET_MAP.pageCount);
const repairedByKey = new Map(repaired.map((field) => [field.fieldKey, field]));
const page3Date = repairedByKey.get("screen_date");
const page3Qp = repairedByKey.get("qp_referred_to");
if (page3Date?.x !== 325 || page3Qp?.x !== 448) {
  console.error("✗ page 3 staff/date/QP placements are not separated");
  errors++;
}
for (const [fieldKey, x] of [["a_gender_female", 74], ["a_gender_male", 123.5], ["a_gender_transgender", 163.7]] as const) {
  if (repairedByKey.get(fieldKey)?.x !== x) {
    console.error(`✗ ${fieldKey} is not centered on its printed answer line`);
    errors++;
  }
}
const courtDescription = repairedByKey.get("court_desc");
const emergencyStreet = repairedByKey.get("e_street");
const emergencyContactStreet = repairedByKey.get("ec1_street");
if (courtDescription?.y !== 299 || emergencyStreet?.width !== 270 || emergencyContactStreet?.width !== 270) {
  console.error("✗ page 7/page 10 text fields can overlap adjacent sections");
  errors++;
}

const pocFields = repairKnownPacketPlacements(PACKET_MAP.fields, 39);
const pocByKey = new Map(pocFields.map((field) => [field.fieldKey, field]));
if (pocByKey.get("c_to")?.page !== 27 || pocByKey.get("c_phone")?.page !== 27 ||
    pocByKey.get("c_address")?.page !== 27 || !pocByKey.has("c_practice")) {
  console.error("✗ 39-page Prayers of Care PCP fields are not mapped to page 27");
  errors++;
}

const byType: Record<string, number> = {};
for (const f of PACKET_MAP.fields) byType[f.type] = (byType[f.type] || 0) + 1;

console.log(`Mapping: ${PACKET_MAP.fields.length} placements across ${PACKET_MAP.pageCount} pages`);
console.log("By type:", byType);
console.log(`Header repeated on all ${pagesWithHeader.size}/${PACKET_MAP.pageCount} pages`);
if (warn.length) { console.log(`\n${warn.length} unmapped-source warnings:`); warn.forEach((w) => console.log(" ", w)); }
if (errors) { console.error(`\n${errors} ERRORS`); process.exit(1); }
console.log("\n✓ mapping check passed");
