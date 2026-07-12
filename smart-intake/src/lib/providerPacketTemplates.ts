import fs from "fs";
import path from "path";
import { PACKET_MAP, TEMPLATE_FILE, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { loadTemplateBytes, mergedMap } from "./fillPdf";
import { prisma } from "./prisma";
import { readFile } from "./storage";

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

  const pocRoiFields = (page: number, yDelta: number): FieldMapping[] => {
    const base = providerFields
      .filter((field) => field.page === 19 && ["roi1_client", "roi1_recipient", "roi1_item_other"].includes(field.fieldKey))
      .map((field) => ({ ...withPage(field, page, yDelta), fieldKey: `poc_${page}_${field.fieldKey}` }));
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
  const roiPages = [...pocRoiFields(17, -22.7), ...pocRoiFields(18, 0), ...pocRoiFields(19, 0)];
  return [...customPageFields, ...pocExtra, ...roiPages].filter((field) => {
    if (field.page > pageCount) return false;
    if (field.page === 27) {
      if (field.fieldKey === "hdr_location_p27") return false;
      return field.fieldKey.startsWith("hdr_") || ["c_to", "c_phone", "c_address", "c_practice"].includes(field.fieldKey);
    }
    return true;
  });
}

async function defaultTemplate(): Promise<TemplateRow | null> {
  return prisma.pdfTemplate.findUnique({
    where: { name: DEFAULT_PACKET_TEMPLATE_NAME },
    include: { fieldMappings: true },
  });
}

export async function packetTemplateForProvider(providerId?: string | null): Promise<PacketTemplateSelection> {
  const providerTemplate = providerId
    ? await prisma.pdfTemplate.findFirst({
      where: { providerId, isActive: true },
      include: { fieldMappings: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
    : null;

  const template = providerTemplate ?? await defaultTemplate();
  const overrides = template ? parseMappings(template.fieldMappings) : [];

  const pageCount = template?.pageCount ?? PACKET_MAP.pageCount;
  const fields = repairKnownPacketPlacements(mergedMap(overrides), pageCount);
  return {
    templateId: template?.id ?? null,
    name: template?.name ?? DEFAULT_PACKET_TEMPLATE_NAME,
    filePath: template?.filePath ?? null,
    originalFileName: template?.originalFileName ?? TEMPLATE_FILE,
    pageCount,
    pageWidth: template?.pageWidth ?? PACKET_MAP.pageWidth,
    pageHeight: template?.pageHeight ?? PACKET_MAP.pageHeight,
    providerSpecific: !!providerTemplate,
    bytes: template ? loadTemplateFile(template.filePath) : loadTemplateBytes(),
    // Provider packets inherit the base packet map unless a provider-specific
    // override replaces or deletes individual placements.
    fields,
    overrides,
  };
}
