import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { PACKET_MAP, TEMPLATE_FILE, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { welliancePacketFields } from "@/config/welliancePacketMap";
import { mergedMap } from "./fillPdf";
import { prisma } from "./prisma";
import { isValidProviderPacketMappingScore } from "./packetMappingScore";
import { fileExists, readFile } from "./storage";
import {
  mappedSignatureSlotsFromFields,
  requiredSignatureSlotsFromFields,
  type SignatureSlotKey,
} from "@/lib/signatureStatus";

export const DEFAULT_PACKET_TEMPLATE_NAME = "Moore Divine Care Client Intake Package";

type MappingRow = {
  fieldKey: string;
  page: number;
  data: string;
};

type TemplateRow = {
  id: string;
  name: string;
  filePath: string;
  pageCount: number;
  pageWidth: number | null;
  pageHeight: number | null;
  providerId: string | null;
  originalFileName: string | null;
  isActive: boolean;
  mappingStatus: string;
  mappingScore: number | null;
  approvedAt: Date | null;
  updatedAt: Date;
  fieldMappings: MappingRow[];
};

export type PacketTemplateSelection = {
  templateId: string | null;
  name: string;
  filePath: string | null;
  originalFileName: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  providerSpecific: boolean;
  bytes: Buffer;
  fields: FieldMapping[];
  overrides: FieldMapping[];
};

export type PacketTemplateIdentity = {
  name?: string | null;
  originalFileName?: string | null;
  pageCount: number;
  providerSpecific: boolean;
  sha256?: string | null;
};

export type ProviderPacketReadinessState =
  | "READY"
  | "MISSING"
  | "NEEDS_REVIEW"
  | "APPROVED_INACTIVE"
  | "LEGACY_UNVERIFIED";

export type ProviderPacketReadinessTemplate = {
  id: string;
  providerId: string | null;
  name: string;
  originalFileName: string | null;
  pageCount: number;
  isActive: boolean;
  mappingStatus: string;
  mappingScore: number | null;
  approvedAt: Date | string | null;
  updatedAt: Date | string;
  fileAvailable?: boolean;
};

export type ProviderPacketReadiness = {
  ready: boolean;
  state: ProviderPacketReadinessState;
  templateId: string | null;
  templateName: string | null;
  pageCount: number | null;
  templateUpdatedAt: Date | string | null;
  message: string;
};

export const PROVIDER_PACKET_SETUP_INSTRUCTIONS =
  "A master administrator must open Master Intake Setup, select this provider, then upload, map, review, approve, and activate the provider packet.";

export const PROVIDER_PACKET_NOT_READY_MESSAGE =
  `Completed packet unavailable: this provider does not have an approved active intake packet. ${PROVIDER_PACKET_SETUP_INSTRUCTIONS} Client intake creation and answer collection can continue.`;

export class ProviderPacketNotReadyError extends Error {
  code = "PROVIDER_PACKET_NOT_READY" as const;
  readiness: ProviderPacketReadiness;

  constructor(readiness: ProviderPacketReadiness, cause?: unknown) {
    super(readiness.message);
    this.name = "ProviderPacketNotReadyError";
    this.readiness = readiness;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export const WELLIANCE_PACKET_SHA256 =
  "c8034d405c28865d3018e7a85785ab57143cffd8465d45a06409b3c64f7242ec";

export const MOORE_DIVINE_PACKET_SHA256 =
  "fa7f082ae3b251f605417b77202ff384fd68e67f9ebee1b1778b8fd640cfff12";

export function packetTemplateSha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertRelativePath(filePath: string) {
  if (path.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes("..")) {
    throw new Error("Unsafe template path");
  }
}

export function loadTemplateFile(filePath: string): Buffer {
  const normalized = filePath.replace(/\\/g, "/");
  assertRelativePath(normalized);

  if (normalized.startsWith("public/") || normalized === TEMPLATE_FILE) {
    const candidates = [
      path.join(process.cwd(), normalized),
      path.join(process.cwd(), "public", "templates", path.basename(normalized)),
      path.join(process.cwd(), path.basename(normalized)),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    }
    throw new Error(`Template PDF not found: ${filePath}`);
  }

  return readFile(normalized);
}

function parseMappings(rows: MappingRow[]): FieldMapping[] {
  return rows.map((m) => ({
    fieldKey: m.fieldKey,
    page: m.page,
    ...JSON.parse(m.data),
  }));
}

function normalizedTemplateLabel(identity: Pick<PacketTemplateIdentity, "name" | "originalFileName">): string {
  return `${identity.name || ""} ${identity.originalFileName || ""}`.toLowerCase();
}

export function isWelliancePacket(identity: PacketTemplateIdentity): boolean {
  return identity.pageCount === 36 &&
    normalizedTemplateLabel(identity).includes("welliance") &&
    identity.sha256?.toLowerCase() === WELLIANCE_PACKET_SHA256;
}

function isPrayersOfCarePacket(identity: PacketTemplateIdentity): boolean {
  const label = normalizedTemplateLabel(identity);
  return identity.pageCount === 39 && (label.includes("prayer") || label.includes("poc"));
}

const ESSENTIAL_WELLNESS_PACKET_FILE = "ewcintakeformpdf";
const ESSENTIAL_WELLNESS_HEADER_SOURCES = [
  "client_full_name", "dob", "mid_number", "record_number", "intake_date", "location",
] as const;
const ESSENTIAL_WELLNESS_HEADER_SOURCE_SET = new Set<string>(ESSENTIAL_WELLNESS_HEADER_SOURCES);

function compactPacketLabel(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Match the reviewed 43-page source exactly before applying its coordinates. */
export function isMooreDivinePacket(identity: PacketTemplateIdentity): boolean {
  return identity.pageCount === PACKET_MAP.pageCount
    && compactPacketLabel(identity.originalFileName) === compactPacketLabel(TEMPLATE_FILE)
    && identity.sha256?.toLowerCase() === MOORE_DIVINE_PACKET_SHA256;
}

/**
 * This is intentionally an exact packet-family check. It must not make an
 * arbitrary 39-page provider upload inherit another provider's coordinates.
 */
export function isEssentialWellnessPacket(identity: PacketTemplateIdentity): boolean {
  return identity.pageCount === 39
    && compactPacketLabel(identity.originalFileName) === ESSENTIAL_WELLNESS_PACKET_FILE;
}

function mappingSourceKey(source: string): string {
  return source.split(/[=~]/, 1)[0];
}

function isEssentialWellnessHeaderField(field: FieldMapping): boolean {
  return ESSENTIAL_WELLNESS_HEADER_SOURCE_SET.has(mappingSourceKey(field.source))
    && field.y >= 650
    && (field.type === "text" || field.type === "date");
}

/**
 * The reviewed Essential Wellness map predates complete repeated-header
 * coverage. Use the most complete saved header row as the coordinate
 * prototype, preserve every reviewed per-page placement, and fill only a
 * missing header cell. No unrelated Moore Divine mappings are inherited.
 */
export function completeEssentialWellnessPdfMap(
  fields: FieldMapping[],
  pageCount: number,
): FieldMapping[] {
  const result = fields
    .filter((field) => field.page >= 1 && field.page <= pageCount)
    .map((field) => ({ ...field }));
  const candidates = result.filter(isEssentialWellnessHeaderField);
  const candidatesByPage = new Map<number, Map<string, FieldMapping>>();
  for (const field of candidates) {
    const pageFields = candidatesByPage.get(field.page) || new Map<string, FieldMapping>();
    const source = mappingSourceKey(field.source);
    if (!pageFields.has(source)) pageFields.set(source, field);
    candidatesByPage.set(field.page, pageFields);
  }

  const prototype = [...candidatesByPage.entries()]
    .sort(([pageA, fieldsA], [pageB, fieldsB]) => fieldsB.size - fieldsA.size || pageA - pageB)[0]?.[1];
  if (prototype && prototype.size >= 2 && prototype.has("client_full_name")) {
    const occupied = new Set(candidates.map((field) => `${field.page}:${mappingSourceKey(field.source)}`));
    for (let page = 1; page <= pageCount; page++) {
      for (const [source, field] of prototype) {
        const slot = `${page}:${source}`;
        if (occupied.has(slot)) continue;
        result.push({
          ...field,
          page,
          fieldKey: `ewc_header_${source}_p${page}`,
          required: false,
          role: "auto",
          consentKey: null,
          notes: `Essential Wellness repeated identity header copied from page ${field.page}`,
        });
        occupied.add(slot);
      }
    }
  }

  // The source Word export visibly reports a 38-page total even though this
  // exact packet contains 39 PDF pages. Cover only that centered footer cell
  // and render the authoritative PDF page count from the loaded document.
  for (let page = 1; page <= pageCount; page++) {
    if (result.some((field) => field.page === page && field.source === "@pdf_page_label")) continue;
    result.push({
      page,
      fieldKey: `ewc_pdf_page_number_p${page}`,
      source: "@pdf_page_label",
      type: "whiteout_text",
      x: 246,
      y: 10,
      width: 120,
      height: 14,
      fontSize: 8,
      lines: 1,
      lineHeight: 10,
      required: false,
      role: "auto",
      consentKey: null,
      notes: "Authoritative PDF page count for the 39-page Essential Wellness packet",
      align: "center",
    });
  }
  return result;
}

function mergeKnownPacketMap(base: FieldMapping[], overrides: FieldMapping[]): FieldMapping[] {
  const byKey = new Map(base.map((candidate) => [candidate.fieldKey, candidate]));
  for (const override of overrides) {
    if ((override as FieldMapping & { deleted?: boolean }).deleted) {
      byKey.delete(override.fieldKey);
    } else if (byKey.has(override.fieldKey)) {
      byKey.set(override.fieldKey, { ...byKey.get(override.fieldKey), ...override });
    }
  }
  return [...byKey.values()];
}

/**
 * Resolve the coordinate family for one exact packet. Provider uploads no
 * longer inherit Moore Divine coordinates merely because they are PDFs.
 */
export function packetFieldsForTemplate(
  identity: PacketTemplateIdentity,
  overrides: FieldMapping[] = [],
): FieldMapping[] {
  if (isWelliancePacket(identity)) {
    // Older Welliance uploads were saved with inherited Moore coordinates.
    // Accept only overrides that originated from the verified Welliance map.
    const verifiedOverrides = overrides.filter((candidate) =>
      candidate.fieldKey.startsWith("well_") ||
      candidate.notes?.includes("Verified Welliance Care packet placement"),
    );
    return mergeKnownPacketMap(welliancePacketFields(), verifiedOverrides)
      .filter((candidate) => candidate.page <= identity.pageCount);
  }

  if (isPrayersOfCarePacket(identity)) {
    return repairKnownPacketPlacements(mergedMap(overrides), identity.pageCount);
  }

  if (isMooreDivinePacket(identity)) {
    return repairKnownPacketPlacements(mergedMap(overrides), identity.pageCount);
  }

  if (identity.providerSpecific) {
    // Unknown provider forms require their own reviewed map. Drawing the
    // shared 43-page coordinates onto an unrelated legal form is unsafe.
    return overrides.filter((candidate) =>
      candidate.page >= 1 && candidate.page <= identity.pageCount,
    );
  }

  return repairKnownPacketPlacements(mergedMap(overrides), identity.pageCount);
}

/** Fields used to render a packet. Runtime-only repairs stay out of the saved
 * provider map so opening the mapper cannot silently persist generated rows. */
export function packetFillFieldsForTemplate(
  identity: PacketTemplateIdentity,
  overrides: FieldMapping[] = [],
): FieldMapping[] {
  const fields = packetFieldsForTemplate(identity, overrides);
  return isEssentialWellnessPacket(identity)
    ? completeEssentialWellnessPdfMap(fields, identity.pageCount)
    : fields;
}

/**
 * Keep known placement repairs effective for provider maps saved before the
 * mapping review. These fields share stable labels in the Prayers of Care
 * packet, and old overrides placed all three page-3 values on one line.
 */
export function repairKnownPacketPlacements(fields: FieldMapping[], pageCount = PACKET_MAP.pageCount): FieldMapping[] {
  const repaired = fields.map((field) => {
    if (field.page === 3 && field.fieldKey === "screen_date") {
      return { ...field, x: 325 };
    }
    if (field.page === 3 && field.fieldKey === "qp_referred_to") {
      return { ...field, x: 448 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_female") {
      return { ...field, x: 74 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_male") {
      return { ...field, x: 123.5 };
    }
    if (field.page === 5 && field.fieldKey === "a_gender_transgender") {
      return { ...field, x: 163.7 };
    }
    if (field.page === 7 && field.fieldKey === "court_desc") {
      return { ...field, y: 299 };
    }
    if (field.page === 10 && field.fieldKey === "e_street") {
      return { ...field, width: 270 };
    }
    if (field.page === 10 && field.fieldKey === "ec1_street") {
      return { ...field, width: 270 };
    }
    return field;
  });
  if (pageCount !== 39) return repaired.filter((field) => field.page <= pageCount);

  // The 39-page Prayers of Care packet places this PCP collaboration form on
  // page 27, not page 29 in the 43-page base packet.
  const providerFields = repaired.map((field) => {
    if (/^hdr_client_name_p\d+$/.test(field.fieldKey)) return { ...field, x: 75, width: 125 };
    if (/^hdr_dob_p\d+$/.test(field.fieldKey)) return { ...field, x: 207, width: 68 };
    if (/^hdr_mid_p\d+$/.test(field.fieldKey)) return { ...field, x: 279, width: 78 };
    if (/^hdr_record_p\d+$/.test(field.fieldKey)) return { ...field, x: 359, width: 88 };
    if (/^hdr_intake_date_p\d+$/.test(field.fieldKey)) return { ...field, x: 452, width: 88 };
    if (field.fieldKey === "c_to") return { ...field, page: 27, x: 59, y: 604, width: 285 };
    if (field.fieldKey === "c_phone") return { ...field, page: 27, x: 398, y: 604, width: 130 };
    if (field.fieldKey === "c_address") return { ...field, page: 27, x: 82, y: 558, width: 250 };
    return field;
  });
  const toField = providerFields.find((field) => field.fieldKey === "c_to");
  if (toField) {
    providerFields.push({
      ...toField,
      fieldKey: "c_practice",
      x: 80,
      y: 581,
      width: 245,
      notes: "Prayers of Care PCP collaboration practice name",
    });
  }

  const pocField = (
    fieldKey: string,
    source: string,
    type: FieldMapping["type"],
    placement: Pick<FieldMapping, "x" | "y" | "width" | "height">,
    role: FieldMapping["role"],
    consentKey: string | null = null,
    notes = "Prayers of Care packet mapping",
  ): FieldMapping => ({
    page: 1, fieldKey, source, type, ...placement,
    fontSize: 9, lines: 1, lineHeight: 11.6, required: false, role, consentKey, notes,
  });

  const withPage = (field: FieldMapping, page: number, yDelta = 0): FieldMapping => ({
    ...field, page, y: field.y + yDelta,
  });

  const pocRoiFields = (page: number, yDelta: number, clientNameDelta: number): FieldMapping[] => {
    const base = providerFields
      .filter((field) => field.page === 19 && ["roi1_client", "roi1_item_other"].includes(field.fieldKey))
      .map((field) => ({
        ...withPage(field, page, field.fieldKey === "roi1_client" ? clientNameDelta : yDelta),
        fieldKey: field.fieldKey === "roi1_client"
          ? `poc_${page}_client_printed_name`
          : `poc_${page}_${field.fieldKey}`,
        notes: field.fieldKey === "roi1_client"
          ? "Print the client or legal representative name in the I-give consent line"
          : field.notes,
      }));
    const itemRows: Array<[string, number, number]> = [
      ["adm", 42, 532.3], ["hiv", 230.4, 532.3], ["notes", 397.1, 532.3], ["vo", 504.2, 532.3],
      ["meds", 42, 509.7], ["testing", 231.7, 509.7], ["plan", 399.1, 509.7], ["lme", 504.2, 509.7],
      ["discharge", 42, 487.2], ["sa", 232.7, 487.2], ["psycheval", 401.4, 487.2],
      ["recip", 42, 464.5], ["acct", 236.4, 464.5], ["nctopps", 42, 442],
    ];
    const initials = itemRows.map(([key, x, y]) => pocField(
      `poc_${page}_roi1_item_${key}`, "initials", "initials",
      { x, y: y + yDelta, width: 15, height: 10 }, "client", "roi1_agreed",
      "Initial the information item box; purpose-of-disclosure boxes remain blank",
    ));
    const understand = [["one", 363.7], ["two", 270.2], ["three", 201.2]].map(([key, y]) => pocField(
      `poc_${page}_roi1_understand_${key}`, "initials", "initials",
      { x: 36, y: Number(y) + yDelta, width: 18, height: 10 }, "client", "roi1_agreed",
      "Initial each I-understand line",
    ));
    return [
      ...base, ...initials, ...understand,
      pocField(`poc_${page}_roi1_sig`, "signature", "signature", { x: 173, y: 132.1 + yDelta, width: 195, height: 18 }, "client", "roi1_agreed", "Client or guardian signature"),
      pocField(`poc_${page}_roi1_date`, "sign_date", "text", { x: 398, y: 132.1 + yDelta, width: 65, height: 11 }, "client", "roi1_agreed", "Client or guardian signature date"),
      pocField(`poc_${page}_roi1_thru`, "roi1_thru_date", "text", { x: 500, y: 132.1 + yDelta, width: 70, height: 11 }, "client", "roi1_agreed", "One year from intake/signature date"),
      pocField(`poc_${page}_roi1_witness_sig`, "signature", "signature", { x: 71, y: 114.9 + yDelta, width: 300, height: 18 }, "witness", "roi1_agreed", "QP/witness signature"),
      pocField(`poc_${page}_roi1_witness_date`, "witness_sign_date", "text", { x: 393, y: 114.9 + yDelta, width: 75, height: 11 }, "witness", "roi1_agreed", "QP/witness date"),
    ].map((field) => ({ ...field, page }));
  };

  const pocExtraRows: Array<[number, FieldMapping]> = [
    [3, pocField("poc_staff_receiving", "staff_receiving_intake", "text", { x: 37, y: 219, width: 270, height: 11 }, "staff")],
    [3, pocField("poc_screening_date", "screening_date", "text", { x: 325, y: 219, width: 100, height: 11 }, "staff")],
    [3, pocField("poc_qp_referred_to", "qp_referred_to", "text", { x: 430, y: 219, width: 135, height: 11 }, "staff", null, "QP name on the staff signature line")],

    // The 39-page Prayers of Care form includes a three-row Axis table on
    // page 4 that is not present in the 43-page base map. Keep the printed
    // table and place the existing diagnosis code/description answers inside
    // its rows instead of drawing over the borders.
    [4, pocField("poc_axis1_axis_p4", "c_axis1_axis", "text", { x: 50, y: 418, width: 160, height: 11 }, "staff")],
    [4, pocField("poc_axis1_code_p4", "c_axis1_code_number", "text", { x: 225, y: 418, width: 165, height: 11 }, "staff")],
    [4, pocField("poc_axis1_description_p4", "c_axis1_description", "text", { x: 407, y: 418, width: 165, height: 11 }, "staff")],
    [4, pocField("poc_axis2_axis_p4", "c_axis2_axis", "text", { x: 50, y: 381, width: 160, height: 11 }, "staff")],
    [4, pocField("poc_axis2_code_p4", "c_axis2_code_number", "text", { x: 225, y: 381, width: 165, height: 11 }, "staff")],
    [4, pocField("poc_axis2_description_p4", "c_axis2_description", "text", { x: 407, y: 381, width: 165, height: 11 }, "staff")],
    [4, pocField("poc_axis3_axis_p4", "c_axis3_axis", "text", { x: 50, y: 337, width: 160, height: 11 }, "staff")],
    [4, pocField("poc_axis3_code_p4", "c_axis3_code_number", "text", { x: 225, y: 337, width: 165, height: 11 }, "staff")],
    [4, pocField("poc_axis3_description_p4", "c_axis3_description", "text", { x: 407, y: 337, width: 165, height: 11 }, "staff")],

    [6, pocField("poc_current_diag_known", "current_diagnosis_known", "text", { x: 161, y: 681, width: 340, height: 11 }, "client")],
    [6, pocField("poc_severity_emergent", "severity_of_need=Emergent", "checkbox", { x: 38.5, y: 660, width: 18.8, height: 11.2 }, "staff")],
    [6, pocField("poc_severity_urgent", "severity_of_need=Urgent", "checkbox", { x: 38.5, y: 581.7, width: 18.8, height: 11.2 }, "staff")],
    [6, pocField("poc_severity_routine", "severity_of_need=Routine", "checkbox", { x: 38.5, y: 536.7, width: 18.8, height: 11.2 }, "staff", null, "Routine; service initiation target is within 14 calendar days")],
    [6, pocField("poc_severity_nonthreshold", "severity_of_need=Non-Threshold", "checkbox", { x: 38.5, y: 489.7, width: 18.8, height: 11.2 }, "staff")],

    [8, pocField("poc_sa_primary", "sa_primary_diagnosis", "text", { x: 122, y: 215, width: 250, height: 11 }, "client")],
    [8, pocField("poc_sa_secondary", "sa_secondary_diagnosis", "text", { x: 131, y: 192, width: 250, height: 11 }, "client")],
    [8, pocField("poc_sig_clinician_p8", "clinician_signature", "signature", { x: 40, y: 162, width: 180, height: 18 }, "clinician")],
    [8, pocField("poc_sig_clinician_p8_date", "clinician_sign_date", "text", { x: 300, y: 162, width: 90, height: 11 }, "clinician")],

    [22, pocField("poc_int_targets", "intervention_target_behaviors", "text", { x: 286, y: 493.5, width: 270, height: 11 }, "staff")],
    [22, pocField("poc_int_until", "intervention_valid_until", "text", { x: 166, y: 402.5, width: 60, height: 11 }, "staff")],
    [22, pocField("poc_int_guardian_sig", "guardian_signature", "signature", { x: 162, y: 323, width: 260, height: 18 }, "guardian", "consent_emergency_interventions")],
    [22, pocField("poc_int_guardian_date", "sign_date", "text", { x: 466, y: 323, width: 70, height: 11 }, "guardian", "consent_emergency_interventions")],
    [22, pocField("poc_int_client_sig", "signature", "signature", { x: 107, y: 277.5, width: 315, height: 18 }, "client", "consent_emergency_interventions")],
    [22, pocField("poc_int_client_date", "sign_date", "text", { x: 466, y: 277.5, width: 70, height: 11 }, "client", "consent_emergency_interventions")],
    [22, pocField("poc_int_staff_sig", "signature", "signature", { x: 103, y: 222, width: 315, height: 18 }, "clinician", "consent_emergency_interventions")],
    [22, pocField("poc_int_staff_date", "clinician_sign_date", "text", { x: 463, y: 222, width: 80, height: 11 }, "clinician", "consent_emergency_interventions")],

    // The POC packet's CCA signature page is page 37. The client row must
    // carry the printed client name, signature, and assessment date.
    [37, pocField("poc_cca_client_printed", "client_full_name", "text", { x: 66, y: 473, width: 170, height: 11 }, "client", null, "Printed client name on the CCA signature page")],
    [37, pocField("poc_cca_client_sig", "signature", "signature", { x: 300, y: 472, width: 140, height: 18 }, "client", null, "Client CCA signature")],
    [37, pocField("poc_cca_client_date", "sign_date", "text", { x: 452, y: 472, width: 90, height: 11 }, "client", null, "Client CCA assessment date")],
    [37, pocField("poc_cca_clinician_printed", "clinician_name", "text", { x: 66, y: 377, width: 230, height: 11 }, "clinician", null, "Printed name only; do not sign this line")],
    [37, pocField("poc_cca_medical_director_printed", "clinician_name", "text", { x: 66, y: 346, width: 230, height: 11 }, "clinician", null, "Printed clinician name requested on the second line; do not sign")],

    [38, pocField("poc_treatment_plan_staff_sig", "signature", "signature", { x: 153, y: 494, width: 95, height: 18 }, "clinician", "consent_receipt_treatment_plan")],
    [38, pocField("poc_treatment_plan_client_sig", "signature", "signature", { x: 467, y: 506, width: 115, height: 18 }, "client", "consent_treatment_plan_participation")],

    [39, pocField("poc_final_client_sig", "signature", "signature", { x: 158, y: 503.6, width: 133, height: 18 }, "client")],
    [39, pocField("poc_final_client_date", "sign_date", "text", { x: 330, y: 503.6, width: 90, height: 11 }, "client")],
    [39, pocField("poc_final_witness_sig", "signature", "signature", { x: 160, y: 444.1, width: 133, height: 18 }, "clinician")],
    [39, pocField("poc_final_witness_date", "clinician_sign_date", "text", { x: 333, y: 444.1, width: 90, height: 11 }, "clinician")],
  ];
  const pocExtra = pocExtraRows.map(([page, field]): FieldMapping => ({ ...field, page }));

  const customPageFields = providerFields.filter((field) => {
    if (field.page === 3 && ["staff_receiving", "screen_date", "qp_referred_to"].includes(field.fieldKey)) return false;
    if (field.page === 6 && ["mh_history_cont", "current_diag_known", "sev_emergent", "sev_urgent", "sev_routine", "sev_nonthreshold"].includes(field.fieldKey)) return false;
    if (field.page === 8 && ["sa_primary", "sa_secondary", "sig_clinician_p8", "sig_clinician_p8_date"].includes(field.fieldKey)) return false;
    if (field.page === 22 && ["transport_dest", "sig_transport_guardian", "sig_transport_guardian_date", "sig_transport_client", "sig_transport_client_date"].includes(field.fieldKey)) return false;
    if (field.page <= 39 && field.fieldKey.startsWith("hdr_location_p")) return false;
    if ([17, 18, 19, 37, 38, 39].includes(field.page) && !field.fieldKey.startsWith("hdr_")) return false;
    return true;
  });
  const roiPages = [
    // Page 17 has the same consent form printed lower on the sheet. Keep the
    // client name in its first blank line, but shift initials/signatures down.
    ...pocRoiFields(17, -22.7, 0),
    // Pages 18 and 19 have the first consent line printed higher than the
    // repeated item/signature layout used by the base map.
    ...pocRoiFields(18, 0, 22.7),
    ...pocRoiFields(19, 0, 22.7),
  ];
  return [...customPageFields, ...pocExtra, ...roiPages].filter((field) => {
    if (field.page > pageCount) return false;
    if (field.page === 27) {
      if (field.fieldKey === "hdr_location_p27") return false;
      return field.fieldKey.startsWith("hdr_") || ["c_to", "c_phone", "c_address", "c_practice"].includes(field.fieldKey);
    }
    return true;
  });
}

function isExplicitlyApprovedProviderPacket(
  providerId: string,
  template: ProviderPacketReadinessTemplate,
): boolean {
  return template.providerId === providerId
    && template.isActive
    && template.mappingStatus === "APPROVED"
    && isValidProviderPacketMappingScore(template.mappingScore)
    && template.approvedAt !== null
    && template.fileAvailable !== false;
}

export { isValidProviderPacketMappingScore } from "./packetMappingScore";

export function providerPacketFileAvailable(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  try {
    assertRelativePath(normalized);
  } catch {
    return false;
  }
  if (normalized.startsWith("public/") || normalized === TEMPLATE_FILE) {
    return [
      path.join(process.cwd(), normalized),
      path.join(process.cwd(), "public", "templates", path.basename(normalized)),
      path.join(process.cwd(), path.basename(normalized)),
    ].some((candidate) => fs.existsSync(candidate));
  }
  return fileExists(normalized);
}

export function providerPacketReadinessFromTemplates(
  providerId: string,
  templates: ProviderPacketReadinessTemplate[],
): ProviderPacketReadiness {
  const owned = templates.filter((template) => template.providerId === providerId);
  const ready = owned.find((template) => isExplicitlyApprovedProviderPacket(providerId, template));
  if (ready) {
    return {
      ready: true,
      state: "READY",
      templateId: ready.id,
      templateName: ready.originalFileName || ready.name,
      pageCount: ready.pageCount,
      templateUpdatedAt: ready.approvedAt,
      message: `Approved provider packet ready: ${ready.originalFileName || ready.name}.`,
    };
  }

  const active = owned.find((template) => template.isActive);
  const explicitlyApprovedInactive = owned.find((template) =>
    !template.isActive
    && template.mappingStatus === "APPROVED"
    && isValidProviderPacketMappingScore(template.mappingScore)
    && template.approvedAt !== null
    && template.fileAvailable !== false,
  );
  if (explicitlyApprovedInactive) {
    return {
      ready: false,
      state: "APPROVED_INACTIVE",
      templateId: explicitlyApprovedInactive.id,
      templateName: explicitlyApprovedInactive.originalFileName || explicitlyApprovedInactive.name,
      pageCount: explicitlyApprovedInactive.pageCount,
      templateUpdatedAt: explicitlyApprovedInactive.updatedAt,
      message: `${PROVIDER_PACKET_NOT_READY_MESSAGE} An approved packet exists but is not active.`,
    };
  }
  if (active?.mappingStatus === "APPROVED") {
    return {
      ready: false,
      state: "LEGACY_UNVERIFIED",
      templateId: active.id,
      templateName: active.originalFileName || active.name,
      pageCount: active.pageCount,
      templateUpdatedAt: active.updatedAt,
      message: active.fileAvailable === false
        ? `${PROVIDER_PACKET_NOT_READY_MESSAGE} The approved packet file is missing or unreadable; re-upload and approve it.`
        : `${PROVIDER_PACKET_NOT_READY_MESSAGE} The active packet has not passed the current approval checks.`,
    };
  }
  if (owned.length) {
    const candidate = active || owned[0];
    return {
      ready: false,
      state: "NEEDS_REVIEW",
      templateId: candidate.id,
      templateName: candidate.originalFileName || candidate.name,
      pageCount: candidate.pageCount,
      templateUpdatedAt: candidate.updatedAt,
      message: `${PROVIDER_PACKET_NOT_READY_MESSAGE} The uploaded packet is still awaiting mapping or approval.`,
    };
  }
  return {
    ready: false,
    state: "MISSING",
    templateId: null,
    templateName: null,
    pageCount: null,
    templateUpdatedAt: null,
    message: PROVIDER_PACKET_NOT_READY_MESSAGE,
  };
}

export async function providerPacketReadiness(providerId: string): Promise<ProviderPacketReadiness> {
  const templates = await prisma.pdfTemplate.findMany({
    where: { providerId },
    select: {
      id: true,
      providerId: true,
      name: true,
      originalFileName: true,
      pageCount: true,
      isActive: true,
      mappingStatus: true,
      mappingScore: true,
      approvedAt: true,
      updatedAt: true,
      filePath: true,
    },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return providerPacketReadinessFromTemplates(
    providerId,
    templates.map((template) => ({
      ...template,
      fileAvailable: providerPacketFileAvailable(template.filePath),
    })),
  );
}

function packetSelectionFromTemplate(template: TemplateRow): PacketTemplateSelection {
  const overrides = parseMappings(template.fieldMappings);
  const bytes = loadTemplateFile(template.filePath);
  const fields = packetFillFieldsForTemplate({
    name: template.name,
    originalFileName: template.originalFileName,
    pageCount: template.pageCount,
    providerSpecific: true,
    sha256: packetTemplateSha256(bytes),
  }, overrides);
  return {
    templateId: template.id,
    name: template.name,
    filePath: template.filePath,
    originalFileName: template.originalFileName || template.name,
    pageCount: template.pageCount,
    pageWidth: template.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: template.pageHeight ?? PACKET_MAP.pageHeight,
    providerSpecific: true,
    bytes,
    fields,
    overrides,
  };
}

export async function requireProviderPacketForCompletion(providerId: string): Promise<PacketTemplateSelection> {
  const readiness = await providerPacketReadiness(providerId);
  if (!readiness.ready || !readiness.templateId) {
    throw new ProviderPacketNotReadyError(readiness);
  }
  const template = await prisma.pdfTemplate.findFirst({
    where: {
      id: readiness.templateId,
      providerId,
      isActive: true,
      mappingStatus: "APPROVED",
      approvedAt: { not: null },
    },
    include: { fieldMappings: true },
  });
  if (
    !template
    || !isValidProviderPacketMappingScore(template.mappingScore)
    || !providerPacketFileAvailable(template.filePath)
  ) {
    throw new ProviderPacketNotReadyError(await providerPacketReadiness(providerId));
  }
  try {
    return packetSelectionFromTemplate(template);
  } catch (cause) {
    throw new ProviderPacketNotReadyError({
      ...readiness,
      ready: false,
      state: "LEGACY_UNVERIFIED",
      message: `${PROVIDER_PACKET_NOT_READY_MESSAGE} The approved packet file is missing or unreadable; re-upload and approve it before creating completed documents.`,
    }, cause);
  }
}

/**
 * Signature roles this provider's packet actually maps, without loading the PDF.
 * Unknown packets use stored mappings only so another provider's form is not inferred.
 */
export async function signatureSlotProfileForProvider(
  providerId: string,
  templateId?: string | null,
): Promise<{ mappedSlots?: SignatureSlotKey[]; requiredSlots: SignatureSlotKey[] }> {
  const resolvedTemplateId = templateId ?? (await providerPacketReadiness(providerId)).templateId;
  if (!resolvedTemplateId) return { mappedSlots: undefined, requiredSlots: [] };
  const template = await prisma.pdfTemplate.findFirst({
    where: { id: resolvedTemplateId, providerId },
    select: {
      name: true,
      originalFileName: true,
      pageCount: true,
      filePath: true,
      fieldMappings: { select: { fieldKey: true, page: true, data: true } },
    },
  });
  if (!template) return { mappedSlots: undefined, requiredSlots: [] };
  const overrides = parseMappings(template.fieldMappings);
  const identity = {
    name: template.name,
    originalFileName: template.originalFileName,
    pageCount: template.pageCount,
    providerSpecific: true as const,
    sha256: packetTemplateSha256(loadTemplateFile(template.filePath)),
  };
  const label = `${template.name} ${template.originalFileName || ""}`.toLowerCase();
  let fields = overrides;
  try {
    if (template.pageCount === 36 && label.includes("welliance")) {
      fields = welliancePacketFields();
    } else if (isPrayersOfCarePacket(identity)) {
      fields = packetFieldsForTemplate(identity, overrides);
    } else if (isEssentialWellnessPacket(identity)) {
      fields = completeEssentialWellnessPdfMap(overrides, template.pageCount);
    } else if (isMooreDivinePacket(identity)) {
      fields = packetFieldsForTemplate(identity, overrides);
    }
  } catch {
    fields = overrides;
  }
  const slots = mappedSignatureSlotsFromFields(fields);
  return {
    mappedSlots: slots.length ? slots : undefined,
    requiredSlots: requiredSignatureSlotsFromFields(fields),
  };
}

export async function mappedSignatureSlotsForProvider(
  providerId: string,
  templateId?: string | null,
): Promise<SignatureSlotKey[] | undefined> {
  return (await signatureSlotProfileForProvider(providerId, templateId)).mappedSlots;
}
