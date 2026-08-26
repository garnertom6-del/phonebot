import { EASY } from "@/config/easyLanguage";
import {
  REQUIRED_FOR_SUBMIT,
  SECTIONS,
  STAFF_FIELDS,
  type QType,
  type Question,
} from "@/config/mooreDivineQuestions";
import type { FieldMapping, FieldType } from "@/config/mooreDivinePacketMap";

export const HEADER_SOURCES = [
  "client_full_name",
  "dob",
  "location",
  "mid_number",
  "record_number",
  "intake_date",
] as const;

export const SIGNATURE_SOURCES = [
  "signature",
  "guardian_signature",
  "staff_signature",
  "clinician_signature",
  "medical_director_signature",
] as const;

export const DATE_SOURCES = [
  "sign_date",
  "staff_sign_date",
  "clinician_sign_date",
  "medical_director_sign_date",
  "witness_sign_date",
  "screening_date",
] as const;

export type MapperFieldType = FieldType | "date";

export type CatalogEntry = {
  key: string;
  label: string;
  easyLabel: string;
  sectionKey: string;
  sectionTitle: string;
  questionType: QType | "signature" | "special";
  mapperType: MapperFieldType;
  required: boolean;
  staffOnly: boolean;
  options?: string[];
};

export type CatalogSection = {
  key: string;
  title: string;
  entries: CatalogEntry[];
};

const REQUIRED_KEYS = new Set(REQUIRED_FOR_SUBMIT.map((item) => item.key));

function easyLabelFor(key: string, fallback: string): string {
  return EASY[key]?.q || fallback;
}

function mapperTypeFor(question: Question): MapperFieldType {
  if (question.key === "mid_number") return "text";
  if (question.key === "record_number") return "text";
  if (question.type === "date") return "date";
  if (question.type === "yesno" || question.type === "radio" || question.type === "consent") return "checkbox";
  return "text";
}

function defaultSize(type: MapperFieldType): { width: number; height: number } {
  if (type === "checkbox") return { width: 14, height: 14 };
  if (type === "signature" || type === "signature_small") return { width: 180, height: 18 };
  if (type === "initials") return { width: 28, height: 12 };
  if (type === "date") return { width: 72, height: 12 };
  return { width: 140, height: 12 };
}

export function defaultFieldSize(type: MapperFieldType, source = ""): { width: number; height: number } {
  if (source === "mid_number") return { width: 90, height: 12 };
  if (source === "record_number") return { width: 96, height: 12 };
  if (source === "dob" || source.endsWith("_date") || source === "intake_date") return { width: 72, height: 12 };
  return defaultSize(type);
}

export function sourceBase(source: string): string {
  return source.split(/[=~]/)[0].trim();
}

export function buildMappingCatalog(): CatalogSection[] {
  const sections: CatalogSection[] = SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    entries: section.questions
      .filter((question) => question.type !== "info" && question.type !== "heading")
      .map((question) => ({
        key: question.key,
        label: question.label,
        easyLabel: easyLabelFor(question.key, question.label),
        sectionKey: section.key,
        sectionTitle: section.title,
        questionType: question.type,
        mapperType: mapperTypeFor(question),
        required: !!question.required || REQUIRED_KEYS.has(question.key),
        staffOnly: !!question.staffOnly,
        options: question.options,
      })),
  }));

  for (const group of STAFF_FIELDS) {
    sections.push({
      key: `staff_${group.group.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      title: group.group,
      entries: group.fields.map((question) => ({
        key: question.key,
        label: question.label,
        easyLabel: easyLabelFor(question.key, question.label),
        sectionKey: "staff",
        sectionTitle: group.group,
        questionType: question.type,
        mapperType: mapperTypeFor(question),
        required: HEADER_SOURCES.includes(question.key as (typeof HEADER_SOURCES)[number])
          || REQUIRED_KEYS.has(question.key),
        staffOnly: true,
        options: question.options,
      })),
    });
  }

  sections.push({
    key: "signatures",
    title: "Signatures & dates",
    entries: [
      ...SIGNATURE_SOURCES.map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        easyLabel: key.replace(/_/g, " "),
        sectionKey: "signatures",
        sectionTitle: "Signatures & dates",
        questionType: "signature" as const,
        mapperType: "signature" as const,
        required: key === "signature" || key === "guardian_signature",
        staffOnly: key !== "signature" && key !== "guardian_signature",
      })),
      ...DATE_SOURCES.map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        easyLabel: key.replace(/_/g, " "),
        sectionKey: "signatures",
        sectionTitle: "Signatures & dates",
        questionType: "special" as const,
        mapperType: "date" as const,
        required: key === "sign_date",
        staffOnly: key !== "sign_date",
      })),
      {
        key: "initials",
        label: "Initials",
        easyLabel: "Initials",
        sectionKey: "signatures",
        sectionTitle: "Signatures & dates",
        questionType: "special",
        mapperType: "initials",
        required: false,
        staffOnly: false,
      },
    ],
  });

  return sections;
}

let catalogCache: CatalogSection[] | null = null;

export function mappingCatalog(): CatalogSection[] {
  catalogCache ??= buildMappingCatalog();
  return catalogCache;
}

export function catalogEntryByKey(key: string): CatalogEntry | undefined {
  const base = sourceBase(key);
  for (const section of mappingCatalog()) {
    const match = section.entries.find((entry) => entry.key === base);
    if (match) return match;
  }
  return undefined;
}

export function mappedSourceKeys(fields: Array<{ source: string }>): Set<string> {
  return new Set(fields.map((field) => sourceBase(field.source)).filter(Boolean));
}

export function lastPageForSource(fields: Array<{ source: string; page: number }>, source: string): number | null {
  const base = sourceBase(source);
  const pages = fields.filter((field) => sourceBase(field.source) === base).map((field) => field.page);
  return pages.length ? Math.max(...pages) : null;
}

export function bestPageForSource(fields: Array<{ source: string; page: number }>, source: string): number {
  return lastPageForSource(fields, source) || 1;
}

export const DEMO_CLIENT_ANSWERS: Record<string, string> = {
  client_full_name: "Alexandria Montgomery-Whitfield",
  dob: "04/12/1987",
  location: "Greensboro Clinic",
  mid_number: "987654321A",
  record_number: "MDC-1001-OVERFLOW",
  intake_date: "08/26/2026",
  client_phone_cell: "(336) 555-0142",
  client_email: "alexandria.montgomery-whitfield@example.test",
  address_street: "1847 West Market Street, Suite 200",
  presenting_problem: "I need help managing anxiety, depression, and a long-standing substance use history that is affecting work and family.",
  signature: "[client signature]",
  sign_date: "08/26/2026",
};

export function demoValueForSource(source: string): string {
  const base = sourceBase(source);
  if (source.includes("=") || source.includes("~")) return "X";
  return DEMO_CLIENT_ANSWERS[base] || base.replace(/_/g, " ");
}

export function newCatalogField(
  entry: CatalogEntry,
  page: number,
  x: number,
  y: number,
  optionValue?: string,
): FieldMapping {
  const type = optionValue ? "checkbox" : entry.mapperType === "date" ? "date" : entry.mapperType;
  const source = optionValue ? `${entry.key}=${optionValue}` : entry.key;
  const size = defaultFieldSize(optionValue ? "checkbox" : entry.mapperType, entry.key);
  const role = entry.key.includes("guardian")
    ? "guardian"
    : entry.key.includes("clinician")
      ? "clinician"
      : entry.key.includes("staff") || entry.key.includes("medical_director")
        ? "staff"
        : entry.key.includes("witness")
          ? "witness"
          : "client";
  const stamp = Date.now().toString(36);
  const fieldKey = `map_${entry.key}${optionValue ? `_${optionValue.replace(/\W+/g, "_")}` : ""}_p${page}_${stamp}`.slice(0, 120);
  return {
    page,
    fieldKey,
    source,
    type: type as FieldMapping["type"],
    x,
    y,
    width: size.width,
    height: size.height,
    fontSize: 9,
    lines: 1,
    lineHeight: 11.6,
    required: entry.required,
    role,
    consentKey: entry.questionType === "consent" ? entry.key : null,
    notes: optionValue ? `${entry.label} = ${optionValue}` : entry.easyLabel,
  };
}
