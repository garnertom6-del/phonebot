import { EASY } from "@/config/easyLanguage";
import {
  REQUIRED_FOR_SUBMIT,
  SECTIONS,
  STAFF_FIELDS,
  questionCatalogId,
  questionVisibleInCatalog,
  type QType,
  type Question,
  type QuestionCatalogId,
} from "@/config/mooreDivineQuestions";
import type { FieldMapping, FieldType } from "@/config/mooreDivinePacketMap";
import { resolveValue, type Answers } from "./resolveMappingValue";

export type MappingProviderContext = {
  name?: string | null;
  slug?: string | null;
  originalFileName?: string | null;
};

const MAPPING_HINTS: Record<string, string> = {
  gender: "Demographics page: place one checkbox per printed Female/Male/Transgender/Other option using source gender=Value.",
  has_medicaid: "Yes/No checkbox near the Medicaid effective date. Use checkbox sources has_medicaid=Yes and has_medicaid=No; the date field does not cover this key.",
  is_minor_or_incompetent: "Yes/No checkbox or minor/incompetent branch next to already-mapped guardian fields.",
  ec1_cell_phone: "Emergency contact 1 cell/mobile phone column, often on the same row as home and work phone.",
  welcome_letter_ack: "Checkbox or initial that the welcome letter was received.",
};

function consentHint(label: string): string {
  return `Map the printed yes/no checkbox, initial line, or attestation mark for “${label}”. Nearby signature name/date boxes use source signature or sign_date and do not satisfy this consent key.`;
}

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
  hint?: string;
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

function mappingHintFor(question: Question): string | undefined {
  if (MAPPING_HINTS[question.key]) return MAPPING_HINTS[question.key];
  if (question.type === "consent") return consentHint(question.label);
  return undefined;
}

function entryFromQuestion(question: Question, sectionKey: string, sectionTitle: string, required: boolean, staffOnly: boolean): CatalogEntry {
  return {
    key: question.key,
    label: question.label,
    easyLabel: easyLabelFor(question.key, question.label),
    sectionKey,
    sectionTitle,
    questionType: question.type,
    mapperType: mapperTypeFor(question),
    required,
    staffOnly,
    options: question.options,
    hint: mappingHintFor(question),
  };
}

export function mappingContextFrom(input: {
  originalFileName?: string | null;
  providerName?: string | null;
  providerSlug?: string | null;
  provider?: { name?: string | null; slug?: string | null } | null;
} = {}): MappingProviderContext {
  return {
    name: input.providerName || input.provider?.name || null,
    slug: input.providerSlug || input.provider?.slug || null,
    originalFileName: input.originalFileName || null,
  };
}

export function mappingCatalogId(ctx?: MappingProviderContext): QuestionCatalogId {
  return questionCatalogId(ctx);
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

export function buildMappingCatalog(ctx?: MappingProviderContext): CatalogSection[] {
  const catalogId = mappingCatalogId(ctx);
  const sections: CatalogSection[] = SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    entries: section.questions
      .filter((question) =>
        question.type !== "info"
        && question.type !== "heading"
        && !question.appOnly
        && questionVisibleInCatalog(question, catalogId))
      .map((question) => entryFromQuestion(
        question,
        section.key,
        section.title,
        !!question.required || REQUIRED_KEYS.has(question.key),
        !!question.staffOnly,
      )),
  })).filter((section) => section.entries.length);

  for (const group of STAFF_FIELDS) {
    const entries = group.fields
      .filter((question) => !question.appOnly && questionVisibleInCatalog(question, catalogId))
      .map((question) => entryFromQuestion(
        question,
        "staff",
        group.group,
        HEADER_SOURCES.includes(question.key as (typeof HEADER_SOURCES)[number])
          || REQUIRED_KEYS.has(question.key),
        true,
      ));
    if (!entries.length) continue;
    sections.push({
      key: `staff_${group.group.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      title: group.group,
      entries,
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

const catalogCache = new Map<QuestionCatalogId, CatalogSection[]>();

export function mappingCatalog(ctx?: MappingProviderContext): CatalogSection[] {
  const catalogId = mappingCatalogId(ctx);
  const cached = catalogCache.get(catalogId);
  if (cached) return cached;
  const built = buildMappingCatalog(ctx);
  catalogCache.set(catalogId, built);
  return built;
}

export function catalogEntryByKey(key: string, ctx?: MappingProviderContext): CatalogEntry | undefined {
  const base = sourceBase(key);
  for (const section of mappingCatalog(ctx)) {
    const match = section.entries.find((entry) => entry.key === base);
    if (match) return match;
  }
  return undefined;
}

export function packetRequiredEntries(ctx?: MappingProviderContext): CatalogEntry[] {
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const section of mappingCatalog(ctx)) {
    for (const entry of section.entries) {
      if (!entry.required || seen.has(entry.key)) continue;
      seen.add(entry.key);
      entries.push(entry);
    }
  }
  return entries;
}

export function mappingFieldGuide(ctx?: MappingProviderContext): string {
  const rows: string[] = [];
  for (const section of mappingCatalog(ctx)) {
    for (const entry of section.entries) {
      const req = entry.required ? "REQUIRED" : "optional";
      const optionHint = entry.options?.length
        ? ` Printed options: ${entry.options.join(" / ")}. Use source ${entry.key}=Value for each checkbox.`
        : "";
      const hint = entry.hint ? ` ${entry.hint}` : "";
      rows.push(`${entry.key} [${entry.mapperType}, ${req}]: ${entry.label}.${optionHint}${hint}`);
    }
  }
  return rows.join("\n");
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

export const DEMO_CLIENT_ANSWERS: Answers = {
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
  gender: "Female",
  has_medicaid: "Yes",
  is_minor_or_incompetent: "No",
  consent_hipaa: true,
  consent_orientation: true,
};

export function overlayFillText(
  field: { source?: string; type?: string; fieldKey?: string },
  mode: "labels" | "demo",
  answers: Answers = DEMO_CLIENT_ANSWERS,
): string {
  const source = field.source || field.fieldKey || "";
  const resolved = resolveValue(source, answers);
  const markField = field.type === "checkbox"
    || field.type === "initials"
    || source.includes("=")
    || source.includes("~");
  if (markField) return resolved.checked ? "X" : "";
  if (mode === "labels") return source;
  if (resolved.text) return resolved.text;
  const fallback = answers[sourceBase(source)];
  if (fallback == null || fallback === "") return sourceBase(source).replace(/_/g, " ");
  return String(fallback);
}

export function demoValueForSource(source: string, answers: Answers = DEMO_CLIENT_ANSWERS): string {
  const type = source.includes("=") || source.includes("~") ? "checkbox" : "text";
  return overlayFillText({ source, type }, "demo", answers);
}

export function catalogOptionValues(entry: CatalogEntry): string[] | undefined {
  if (entry.questionType === "consent") return ["true"];
  if (entry.mapperType === "checkbox" && entry.options?.length) return entry.options;
  return undefined;
}

export function newCatalogField(
  entry: CatalogEntry,
  page: number,
  x: number,
  y: number,
  optionValue?: string,
  idSuffix?: string,
): FieldMapping {
  const options = catalogOptionValues(entry);
  const exclusiveValue = optionValue
    || (entry.questionType === "consent" ? "true" : undefined)
    || (options?.length ? options[0] : undefined);
  const exclusiveCheckbox = !!exclusiveValue && (entry.mapperType === "checkbox" || entry.questionType === "consent" || !!optionValue);
  const type = exclusiveCheckbox ? "checkbox" : entry.mapperType === "date" ? "date" : entry.mapperType;
  const source = exclusiveCheckbox && exclusiveValue
    ? `${entry.key}=${exclusiveValue}`
    : entry.key;
  const size = defaultFieldSize(exclusiveCheckbox ? "checkbox" : entry.mapperType, entry.key);
  const role = entry.key.includes("guardian")
    ? "guardian"
    : entry.key.includes("clinician")
      ? "clinician"
      : entry.key.includes("staff") || entry.key.includes("medical_director")
        ? "staff"
        : entry.key.includes("witness")
          ? "witness"
          : "client";
  const stamp = `${Date.now().toString(36)}${idSuffix ? `_${idSuffix}` : ""}`;
  const optionKey = exclusiveCheckbox && exclusiveValue ? `_${exclusiveValue.replace(/\W+/g, "_")}` : "";
  const fieldKey = `map_${entry.key}${optionKey}_p${page}_${stamp}`.slice(0, 120);
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
    notes: exclusiveCheckbox && exclusiveValue && exclusiveValue !== "true"
      ? `${entry.label} = ${exclusiveValue}`
      : entry.easyLabel,
  };
}

/** Place a radio / yes-no catalog field as one checkbox per printed option. */
export function catalogPlacementFields(
  entry: CatalogEntry,
  page: number,
  x: number,
  y: number,
  optionValue?: string,
): FieldMapping[] {
  if (optionValue) return [newCatalogField(entry, page, x, y, optionValue)];
  const options = catalogOptionValues(entry);
  if (!options?.length) return [newCatalogField(entry, page, x, y)];
  return options.map((value, index) =>
    newCatalogField(entry, page, x + index * 18, y, value, String(index)));
}
