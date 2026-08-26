import { REQUIRED_FOR_SUBMIT, SECTIONS, STAFF_FIELDS } from "@/config/mooreDivineQuestions";
import type { FieldMapping } from "@/config/mooreDivinePacketMap";
import { HEADER_SOURCES, catalogEntryByKey, sourceBase } from "./mappingCatalog";

const SPECIAL_SOURCES = new Set([
  "signature", "guardian_signature", "staff_signature", "clinician_signature",
  "medical_director_signature", "sign_date", "staff_sign_date", "clinician_sign_date",
  "medical_director_sign_date", "initials", "signer_name", "screening_date",
  "hospitalizations_more",
]);

const CORE_SOURCES = ["client_full_name", "dob", "record_number", "intake_date"];

export type MissingRequiredField = {
  key: string;
  label: string;
  section: string;
  page: number | null;
};

export type MappingHealth = {
  ready: boolean;
  score: number;
  blockingIssues: string[];
  warnings: string[];
  missingRequired: MissingRequiredField[];
  counts: {
    fields: number;
    text: number;
    checkboxes: number;
    signatures: number;
    pagesWithFields: number;
  };
};

function sourceKey(source: string): string {
  return sourceBase(source);
}

function rectanglesOverlap(a: FieldMapping, b: FieldMapping): boolean {
  if (a.page !== b.page) return false;
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y, b.y);
  const top = Math.min(a.y + a.height, b.y + b.height);
  return right > left && top > bottom;
}

function sourceCatalog(): Set<string> {
  const keys = new Set<string>(SPECIAL_SOURCES);
  for (const section of SECTIONS) for (const question of section.questions) keys.add(question.key);
  for (const group of STAFF_FIELDS) for (const question of group.fields) keys.add(question.key);
  return keys;
}

/**
 * Runs conservative checks before a provider packet can replace its approved
 * packet. This is intentionally a gate, not an AI auto-approval decision.
 */
export function assessMapping(
  fields: FieldMapping[],
  pageCount: number,
  pageWidth: number,
  pageHeight: number,
  savedMappingCount = fields.length,
): MappingHealth {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const missingRequired: MissingRequiredField[] = [];
  const catalog = sourceCatalog();
  const seenKeys = new Set<string>();
  const pages = new Set<number>();
  let text = 0;
  let checkboxes = 0;
  let signatures = 0;

  for (const field of fields) {
    pages.add(field.page);
    if (field.type === "text") text++;
    if (field.type === "checkbox") checkboxes++;
    if (field.type === "signature" || field.type === "signature_small") signatures++;
    if (seenKeys.has(field.fieldKey)) blockingIssues.push(`Duplicate field key: ${field.fieldKey}`);
    seenKeys.add(field.fieldKey);

    if (!Number.isInteger(field.page) || field.page < 1 || field.page > pageCount) {
      blockingIssues.push(`${field.fieldKey} is outside the packet pages.`);
    }
    if (![field.x, field.y, field.width, field.height].every(Number.isFinite) || field.width <= 0 || field.height <= 0) {
      blockingIssues.push(`${field.fieldKey} has invalid coordinates or size.`);
    } else if (
      field.x < 0 || field.y < 0 || field.x + field.width > pageWidth || field.y + field.height > pageHeight
    ) {
      blockingIssues.push(`${field.fieldKey} extends outside the PDF page.`);
    }

    const key = sourceKey(field.source);
    if (!key && field.type !== "whiteout_text") warnings.push(`${field.fieldKey} has no source question.`);
    if (key && !catalog.has(key) && !key.startsWith("c_") && !key.startsWith("poc_")) {
      warnings.push(`${field.fieldKey} uses an unrecognized source: ${key}.`);
    }
  }

  const mappedSources = new Set(fields.map((field) => sourceKey(field.source)).filter(Boolean));
  const requiredKeys = [
    ...CORE_SOURCES,
    ...HEADER_SOURCES,
    ...REQUIRED_FOR_SUBMIT.map((item) => item.key),
  ];
  const seenRequired = new Set<string>();
  for (const required of requiredKeys) {
    if (seenRequired.has(required) || mappedSources.has(required)) continue;
    seenRequired.add(required);
    const entry = catalogEntryByKey(required);
    const submit = REQUIRED_FOR_SUBMIT.find((item) => item.key === required);
    missingRequired.push({
      key: required,
      label: entry?.easyLabel || submit?.label || entry?.label || required,
      section: entry?.sectionTitle || "Required intake fields",
      page: null,
    });
    blockingIssues.push(`Missing required mapping: ${required}.`);
  }
  if (!fields.some((field) => ["signature", "signature_small"].includes(field.type) && ["client", "guardian"].includes(field.role))) {
    missingRequired.push({
      key: "signature",
      label: "Client or guardian signature",
      section: "Signatures & dates",
      page: null,
    });
    blockingIssues.push("No client or guardian signature field is mapped.");
  }
  if (!fields.some((field) => ["signature", "signature_small"].includes(field.type) && ["staff", "clinician", "witness"].includes(field.role))) {
    warnings.push("No staff, clinician, or witness signature field is mapped.");
  }
  if (!savedMappingCount) {
    blockingIssues.push("No provider-specific mapping has been saved. Load the starter map, review it, and save it before approval.");
  }

  const candidateFields = fields.filter((field) => field.type !== "checkbox" && field.type !== "whiteout_text");
  for (let i = 0; i < candidateFields.length; i++) {
    for (let j = i + 1; j < candidateFields.length; j++) {
      const a = candidateFields[i];
      const b = candidateFields[j];
      if (rectanglesOverlap(a, b)) warnings.push(`Possible overlap: ${a.fieldKey} and ${b.fieldKey} on page ${a.page}.`);
    }
  }

  for (let page = 1; page <= pageCount; page++) {
    if (!pages.has(page)) warnings.push(`Page ${page} has no mapped fields; confirm it is intentionally blank or informational.`);
  }

  const headerKeys = new Set<string>(HEADER_SOURCES);
  const headerPages = new Set(
    fields.filter((field) => headerKeys.has(sourceKey(field.source))).map((field) => field.page),
  );
  for (let page = 1; page <= pageCount; page++) {
    if (headerPages.size > 2 && !headerPages.has(page) && pages.has(page)) {
      warnings.push(`Page ${page} has mappings but no repeating header row (name/DOB/MID/record/date).`);
    }
  }

  const score = Math.max(0, Math.min(100, 100 - blockingIssues.length * 25 - warnings.length * 2));
  return {
    ready: blockingIssues.length === 0,
    score,
    blockingIssues,
    warnings,
    missingRequired,
    counts: { fields: fields.length, text, checkboxes, signatures, pagesWithFields: pages.size },
  };
}
