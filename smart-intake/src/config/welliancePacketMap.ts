import { PACKET_MAP, type FieldMapping } from "./mooreDivinePacketMap";

type Placement = Pick<FieldMapping, "x" | "y" | "width" | "height">;

const HEADER_Y = 709.6;

function field(
  page: number,
  fieldKey: string,
  source: string,
  type: FieldMapping["type"],
  placement: Placement,
  role: FieldMapping["role"] = "auto",
  consentKey: string | null = null,
  extra: Partial<FieldMapping> = {},
): FieldMapping {
  return {
    page,
    fieldKey,
    source,
    type,
    ...placement,
    fontSize: 8.5,
    lines: 1,
    lineHeight: 10.5,
    required: false,
    role,
    consentKey,
    notes: "Verified Welliance Care packet placement",
    ...extra,
  };
}

function baseField(fieldKey: string): FieldMapping {
  const match = PACKET_MAP.fields.find((candidate) => candidate.fieldKey === fieldKey);
  if (!match) throw new Error(`Base packet field not found: ${fieldKey}`);
  return match;
}

function moved(
  fieldKey: string,
  page: number,
  changes: Partial<FieldMapping> = {},
): FieldMapping {
  return { ...baseField(fieldKey), page, ...changes };
}

function headerFields(page: number): FieldMapping[] {
  const columns: Array<[string, string, number, number]> = [
    ["client_name", "client_full_name", 42.2, 99],
    ["dob", "dob", 149.2, 70.4],
    ["location", "location", 227.6, 81.4],
    ["mid", "mid_number", 317, 86.8],
    ["record", "record_number", 411.8, 68.9],
    ["intake_date", "intake_date", 488.7, 81.1],
  ];
  return columns.map(([name, source, x, width]) => field(
    page,
    `well_hdr_${name}_p${page}`,
    source,
    "text",
    { x, y: HEADER_Y, width, height: 13 },
    "auto",
    null,
    { fontSize: 8.5 },
  ));
}

function pageWithoutHeader(page: number): FieldMapping[] {
  return PACKET_MAP.fields
    .filter((candidate) => candidate.page === page && !candidate.fieldKey.startsWith("hdr_"))
    .map((candidate) => ({ ...candidate }));
}

function transformedPage(
  page: number,
  transformY: (value: number) => number,
  excludedKeys: string[] = [],
): FieldMapping[] {
  const excluded = new Set(excludedKeys);
  return pageWithoutHeader(page)
    .filter((candidate) => !excluded.has(candidate.fieldKey))
    .map((candidate) => ({ ...candidate, y: transformY(candidate.y) }));
}

function signatureFields(
  page: number,
  prefix: string,
  y: number,
  role: FieldMapping["role"],
  consentKey: string | null,
  dateSource: string,
  x = 42,
  width = 300,
  dateX = 432,
  dateWidth = 90,
): FieldMapping[] {
  return [
    field(
      page,
      `${prefix}_signature`,
      role === "guardian" ? "guardian_signature" : "signature",
      "signature",
      { x, y, width, height: 23 },
      role,
      consentKey,
    ),
    field(
      page,
      `${prefix}_date`,
      dateSource,
      "text",
      { x: dateX, y, width: dateWidth, height: 11 },
      role,
      consentKey,
    ),
  ];
}

function roiFields(
  page: number,
  prefix: "roi1" | "roi2" | "roi3",
  positions: {
    clientY: number;
    recipientY: number;
    itemOffset: number;
    ackYs: [number, number, number];
    signatureY: number;
    witnessY: number;
  },
): FieldMapping[] {
  const consentKey = `${prefix}_agreed`;
  const itemRows: Array<[string, number, number]> = [
    ["adm", 42, 532.6],
    ["hiv", 42, 521.3],
    ["notes", 42, 510.1],
    ["vo", 42, 498.8],
    ["meds", 42, 487.5],
    ["nctopps", 42, 453.5],
    ["testing", 229, 532.6],
    ["plan", 229, 521.3],
    ["lme", 229, 510],
    ["discharge", 229, 498.7],
    ["sa", 229, 487.5],
    ["psycheval", 402, 532.6],
    ["recip", 402, 521.3],
    ["acct", 402, 510],
    ["other", 402, 498.7],
  ];
  const items = itemRows.map(([key, x, y]) => field(
    page,
    `well_${prefix}_item_${key}`,
    "initials",
    "initials",
    { x, y: y + positions.itemOffset, width: 15, height: 10 },
    "client",
    consentKey,
    { fontSize: 8 },
  ));
  const acknowledgements = positions.ackYs.map((y, index) => field(
    page,
    `well_${prefix}_ack_${index + 1}`,
    "initials",
    "initials",
    { x: 36, y, width: 18, height: 10 },
    "client",
    consentKey,
    { fontSize: 8 },
  ));
  return [
    field(
      page,
      `well_${prefix}_client`,
      "client_full_name",
      "text",
      { x: 55, y: positions.clientY, width: 285, height: 11 },
      "client",
      consentKey,
    ),
    field(
      page,
      `well_${prefix}_recipient`,
      `${prefix}_recipient`,
      "text",
      { x: 147, y: positions.recipientY, width: 245, height: 11 },
      "client",
      consentKey,
    ),
    ...items,
    ...acknowledgements,
    field(
      page,
      `well_${prefix}_client_signature`,
      "signature",
      "signature",
      { x: 284, y: positions.signatureY, width: 165, height: 20 },
      "client",
      consentKey,
    ),
    field(
      page,
      `well_${prefix}_client_date`,
      "sign_date",
      "text",
      { x: 454, y: positions.signatureY, width: 54, height: 11 },
      "client",
      consentKey,
    ),
    field(
      page,
      `well_${prefix}_thru_date`,
      `${prefix}_thru_date`,
      "text",
      { x: 515, y: positions.signatureY, width: 62, height: 11 },
      "client",
      consentKey,
    ),
    field(
      page,
      `well_${prefix}_witness_signature`,
      "signature",
      "signature",
      { x: 105, y: positions.witnessY, width: 340, height: 20 },
      "witness",
      consentKey,
    ),
    field(
      page,
      `well_${prefix}_witness_date`,
      "witness_sign_date",
      "text",
      { x: 454, y: positions.witnessY, width: 75, height: 11 },
      "witness",
      consentKey,
    ),
  ];
}

function page10Fields(): FieldMapping[] {
  const yByKey: Record<string, number> = {
    e_street: 658.5, e_city: 658.5, e_state: 658.5,
    e_home: 624, e_work: 624, e_cell: 624,
    height: 606.8, weight: 606.8, hair: 606.8, eyes: 606.8,
    med_alerts: 589.5,
    drug_allergies: 555,
    env_allergies: 520.5,
    e_medications: 503.2,
    otc: 468.7,
    marks: 451.5,
    diets: 434.2,
    risk_sa: 417.1, risk_beh: 417.1, risk_suicidal: 417.1, risk_psychotic: 417.1,
    risk_behavioral: 399.9, risk_phys_agg: 399.9, risk_verb_agg: 399.9, risk_sib: 399.9,
    risk_prop: 382.6, risk_other: 382.6,
    lang_english: 348.1, lang_spanish: 348.1, lang_french: 348.1, lang_german: 348.1,
    lang_other: 347.1,
    comm_excellent: 330.8, comm_good: 330.8, comm_fair: 330.8, comm_poor: 330.8,
    e_pcp: 261.8,
    e_pcp_addr: 244.5,
    e_pcp_phone: 227.4,
    e_facility: 210.1,
    no_pcp: 192.8,
  };
  const omitted = new Set([
    "sig_emergency_info", "sig_emergency_info_date",
    "ec1_name", "ec1_street", "ec1_city", "ec1_state", "ec1_home", "ec1_work", "ec1_cell",
  ]);
  const fields = pageWithoutHeader(10)
    .filter((candidate) => !omitted.has(candidate.fieldKey))
    .map((candidate) => {
      const xByKey: Record<string, number> = {
        e_work: 314,
        e_cell: 480,
        e_pcp: 145,
        e_pcp_addr: 190,
        e_pcp_phone: 215,
        e_facility: 185,
      };
      const widthByKey: Record<string, number> = {
        e_work: 105,
        e_cell: 92,
        e_pcp: 410,
        e_pcp_addr: 365,
        e_pcp_phone: 340,
        e_facility: 370,
      };
      return {
        ...candidate,
        x: xByKey[candidate.fieldKey] ?? candidate.x,
        y: yByKey[candidate.fieldKey] ?? candidate.y,
        width: widthByKey[candidate.fieldKey] ?? candidate.width,
      };
    });
  return [
    ...fields,
    ...signatureFields(
      10,
      "well_emergency_info_client",
      157,
      "client",
      "consent_emergency_info",
      "sign_date",
      42,
      300,
      432,
      90,
    ),
  ];
}

function page11Fields(): FieldMapping[] {
  const emergency = [
    moved("ec1_name", 11, { y: 685.5, x: 145.5, width: 300 }),
    moved("ec1_street", 11, { y: 668.3, x: 137.1, width: 285 }),
    moved("ec1_city", 11, { y: 668.3, x: 429, width: 120 }),
    moved("ec1_state", 11, { y: 668.3, x: 557.6, width: 26 }),
    moved("ec1_home", 11, { y: 651, x: 118.2, width: 113.8 }),
    moved("ec1_work", 11, { y: 651, x: 264.5, width: 112 }),
    moved("ec1_cell", 11, { y: 651, x: 435.3, width: 137 }),
  ];
  const providerChoice = pageWithoutHeader(11)
    .filter((candidate) => !candidate.fieldKey.startsWith("sig_provider_choice"))
    .map((candidate) => ({ ...candidate, y: 1.0584 * candidate.y - 103.2 }));
  return [
    ...emergency,
    ...providerChoice,
    ...signatureFields(
      11,
      "well_provider_choice_client",
      306,
      "client",
      "consent_provider_choice",
      "sign_date",
      42,
      300,
      432,
      90,
    ),
  ];
}

function page23Fields(): FieldMapping[] {
  const rows = [599.9, 573.8, 548.5, 523.2, 497.9];
  return [
    field(23, "well_dis_admission_date", "dis_admission_date", "text", { x: 130.7, y: 674.1, width: 130, height: 11 }, "staff"),
    field(23, "well_dis_discharge_date", "dis_discharge_date", "text", { x: 461.1, y: 674.1, width: 110, height: 11 }, "staff"),
    field(23, "well_dis_programs", "dis_programs", "text", { x: 168, y: 649.6, width: 360, height: 11 }, "staff"),
    ...rows.map((y, index) => field(
      23,
      `well_dis_adm_axis${index + 1}`,
      `dis_adm_axis${index + 1}`,
      "text",
      { x: 92, y: index === 0 ? 586 : y, width: 250, height: index === 0 ? 22 : 11 },
      "staff",
      null,
      index === 0
        ? { fontSize: 6.5, lines: 2, lineHeight: 8.5 }
        : { fontSize: 8 },
    )),
    field(23, "well_dis_summary", "dis_summary", "text", { x: 40, y: 420, width: 520, height: 36 }, "staff", null, { fontSize: 8, lines: 3, lineHeight: 12 }),
    field(23, "well_dis_pcp_plan", "dis_pcp_plan", "text", { x: 40, y: 353, width: 520, height: 38 }, "staff", null, { fontSize: 8, lines: 3, lineHeight: 12 }),
    field(23, "well_dis_strengths", "dis_strengths", "text", { x: 62, y: 320.8, width: 510, height: 11 }, "staff", null, { fontSize: 8 }),
    field(23, "well_dis_needs", "dis_needs", "text", { x: 62, y: 308.1, width: 510, height: 11 }, "staff", null, { fontSize: 8 }),
    field(23, "well_dis_abilities", "dis_abilities", "text", { x: 62, y: 295.5, width: 510, height: 11 }, "staff", null, { fontSize: 8 }),
    field(23, "well_dis_preferences", "dis_preferences", "text", { x: 62, y: 282.8, width: 510, height: 11 }, "staff", null, { fontSize: 8 }),
    field(23, "well_dis_reason", "dis_reason", "text", { x: 40, y: 222.5, width: 520, height: 33 }, "staff", null, { fontSize: 8, lines: 2, lineHeight: 12 }),
    field(23, "well_dis_continuing", "dis_continuing_care", "text", { x: 40, y: 174, width: 520, height: 28 }, "staff", null, { fontSize: 8, lines: 2, lineHeight: 12 }),
    field(23, "well_dis_comments", "dis_comments", "text", { x: 40, y: 112, width: 520, height: 45 }, "staff", null, { fontSize: 8, lines: 4, lineHeight: 10 }),
  ];
}

function page24Fields(): FieldMapping[] {
  return [
    field(24, "well_dis_res_private", "dis_residence_type=Private Home", "checkbox", { x: 38, y: 641.4, width: 10, height: 10 }, "staff"),
    field(24, "well_dis_res_alf", "dis_residence_type=ALF/Residential/Group Home/Halfway House", "checkbox", { x: 38, y: 590.7, width: 10, height: 10 }, "staff"),
    field(24, "well_dis_res_inpatient", "dis_residence_type=Inpatient Psych/State Hospital/Medical Hospital", "checkbox", { x: 38, y: 552.8, width: 10, height: 10 }, "staff"),
    field(24, "well_dis_res_foster", "dis_residence_type=Foster Care Placement", "checkbox", { x: 38, y: 514.9, width: 10, height: 10 }, "staff"),
    field(24, "well_dis_res_detail", "dis_residence_detail", "text", { x: 118, y: 606, width: 420, height: 11 }, "staff"),
    field(24, "well_dis_followup_psych", "dis_followup_psych", "text", { x: 95, y: 397.9, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_followup_medical", "dis_followup_medical", "text", { x: 367, y: 397.9, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_followup_therapy", "dis_followup_therapy", "text", { x: 84, y: 386.4, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_followup_labs", "dis_followup_labs", "text", { x: 352, y: 386.4, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_followup_support", "dis_followup_support", "text", { x: 108, y: 375, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_followup_dropin", "dis_followup_dropin", "text", { x: 367, y: 375, width: 170, height: 11 }, "staff"),
    field(24, "well_dis_medications", "dis_medications", "text", { x: 40, y: 340.8, width: 520, height: 24 }, "staff", null, { fontSize: 8, lines: 2, lineHeight: 11 }),
    field(24, "well_dis_pharmacy", "dis_pharmacy", "text", { x: 83, y: 317, width: 440, height: 11 }, "staff"),
    field(24, "well_dis_employment", "dis_employment_where", "text", { x: 247, y: 294.3, width: 180, height: 11 }, "staff"),
    field(24, "well_dis_client_comments", "dis_client_comments", "text", { x: 145, y: 203.4, width: 380, height: 11 }, "staff"),
    field(24, "well_dis_crisis_contact", "dis_crisis_contact", "text", { x: 60, y: 154, width: 285, height: 11 }, "staff"),
    field(24, "well_dis_client_signature", "signature", "signature", { x: 70, y: 147, width: 300, height: 22 }, "client", "consent_discharge"),
    field(24, "well_dis_client_date", "dis_discharge_date", "text", { x: 468, y: 147, width: 90, height: 11 }, "client", "consent_discharge"),
    field(24, "well_dis_guardian_signature", "guardian_signature", "signature", { x: 190, y: 123, width: 230, height: 22 }, "guardian", "consent_discharge"),
    field(24, "well_dis_guardian_date", "dis_discharge_date", "text", { x: 468, y: 123, width: 90, height: 11 }, "guardian", "consent_discharge"),
    field(24, "well_dis_staff_signature", "signature", "signature", { x: 105, y: 99, width: 290, height: 22 }, "staff"),
    field(24, "well_dis_staff_date", "dis_discharge_date", "text", { x: 468, y: 99, width: 90, height: 11 }, "staff"),
    field(24, "well_dis_copy_initials", "initials", "initials", { x: 206, y: 71.4, width: 18, height: 10 }, "client", "consent_discharge"),
  ];
}

function page27Fields(): FieldMapping[] {
  const axes = [137.7, 126.3, 114.8, 103.3, 91.8];
  return [
    field(27, "well_c_to", "pcp_name", "text", { x: 59, y: 659.7, width: 285, height: 11 }, "staff"),
    field(27, "well_c_phone", "pcp_phone", "text", { x: 398, y: 659.7, width: 160, height: 11 }, "staff"),
    field(27, "well_c_practice", "c_practice", "text", { x: 112, y: 636.7, width: 245, height: 11 }, "staff"),
    field(27, "well_c_fax", "c_secure_fax", "text", { x: 430, y: 636.7, width: 130, height: 11 }, "staff"),
    field(27, "well_c_address", "pcp_address", "text", { x: 82, y: 613.6, width: 275, height: 11 }, "staff"),
    field(27, "well_c_email", "c_secure_email", "text", { x: 430, y: 613.6, width: 130, height: 11 }, "staff"),
    field(27, "well_c_client", "client_full_name", "text", { x: 106, y: 450.6, width: 240, height: 11 }, "auto"),
    field(27, "well_c_mid", "mid_number", "text", { x: 107, y: 439, width: 220, height: 11 }, "auto"),
    field(27, "well_c_dob", "dob", "text", { x: 104, y: 427.5, width: 220, height: 11 }, "auto"),
    field(27, "well_c_reason_coc", "c_reason~Coordination of care", "checkbox", { x: 42, y: 404.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_medchange", "c_reason~Medication Change", "checkbox", { x: 42, y: 393, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_transfer", "c_reason~Transferring care back to PCP", "checkbox", { x: 42, y: 381.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_mi", "c_reason~Patient determined to be Mentally", "checkbox", { x: 305, y: 404.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_diagchange", "c_reason~Significant change in diagnosis", "checkbox", { x: 305, y: 393, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_annual", "c_reason~Annual Notification", "checkbox", { x: 305, y: 381.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_reason_other", "c_reason_other", "text", { x: 138, y: 358.5, width: 420, height: 11 }, "staff"),
    field(27, "well_c_req_meddiag", "c_requested~Medical Diagnosis", "checkbox", { x: 42, y: 278, width: 10, height: 10 }, "staff"),
    field(27, "well_c_req_meds", "c_requested~List of all medications", "checkbox", { x: 42, y: 266.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_req_bha", "c_requested~Behavioral Health Assessment", "checkbox", { x: 42, y: 255, width: 10, height: 10 }, "staff"),
    field(27, "well_c_req_isp", "c_requested~Individual Service Plan", "checkbox", { x: 42, y: 243.5, width: 10, height: 10 }, "staff"),
    field(27, "well_c_req_impression", "c_requested~Clinical Impression", "checkbox", { x: 42, y: 232, width: 10, height: 10 }, "staff"),
    field(27, "well_c_req_other", "c_requested_other", "text", { x: 136, y: 220.5, width: 360, height: 11 }, "staff"),
    ...axes.flatMap((y, index) => [
      field(27, `well_c_axis${index + 1}_code`, `c_axis${index + 1}_code`, "text", { x: 130, y, width: 112, height: 11 }, "staff", null, { fontSize: 8 }),
      field(27, `well_c_axis${index + 1}_description`, `c_axis${index + 1}_description`, "text", { x: 263, y, width: 250, height: 11 }, "staff", null, { fontSize: 8 }),
    ]),
  ];
}

function page28Fields(): FieldMapping[] {
  return [
    field(28, "well_c_psych_name", "c_psych_name", "text", { x: 385, y: 648.9, width: 180, height: 11 }, "staff"),
    field(28, "well_c_psych_email", "c_psych_email", "text", { x: 138, y: 625.9, width: 220, height: 11 }, "staff"),
    field(28, "well_c_psych_phone", "c_psych_phone", "text", { x: 442, y: 625.9, width: 130, height: 11 }, "staff"),
    field(28, "well_c_cm_name", "c_cm_name", "text", { x: 205, y: 602.8, width: 330, height: 11 }, "staff"),
    field(28, "well_c_cm_email", "c_cm_email", "text", { x: 138, y: 579.9, width: 220, height: 11 }, "staff"),
    field(28, "well_c_cm_phone", "c_cm_phone", "text", { x: 442, y: 579.9, width: 130, height: 11 }, "staff"),
    field(28, "well_c_other_name", "c_other_name", "text", { x: 164, y: 556.9, width: 370, height: 11 }, "staff"),
    field(28, "well_c_other_email", "c_other_email", "text", { x: 138, y: 533.8, width: 220, height: 11 }, "staff"),
    field(28, "well_c_other_phone", "c_other_phone", "text", { x: 442, y: 533.8, width: 130, height: 11 }, "staff"),
    field(28, "well_c_clinician", "c_clinician", "text", { x: 157, y: 463.7, width: 245, height: 11 }, "clinician"),
    field(28, "well_c_clinician_title", "c_clinician_title", "text", { x: 433, y: 463.7, width: 130, height: 11 }, "clinician"),
    field(28, "well_c_clinician_signature", "clinician_signature", "signature", { x: 92, y: 440.4, width: 300, height: 22 }, "clinician"),
    field(28, "well_c_date_sent", "c_date_sent", "text", { x: 470, y: 440.4, width: 90, height: 11 }, "clinician"),
    field(28, "well_c_sent_name", "staff_receiving_intake", "text", { x: 118, y: 417.2, width: 280, height: 11 }, "staff"),
    field(28, "well_c_sent_title", "c_clinician_title", "text", { x: 433, y: 417.2, width: 130, height: 11 }, "staff"),
    field(28, "well_c_sent_signature", "staff_signature", "signature", { x: 92, y: 393.9, width: 300, height: 22 }, "staff"),
    field(28, "well_c_sent_date", "staff_sign_date", "text", { x: 470, y: 393.9, width: 90, height: 11 }, "staff"),
    field(28, "well_c_sent_mailed", "c_sent_method=Mailed", "checkbox", { x: 42, y: 370.8, width: 10, height: 10 }, "staff"),
    field(28, "well_c_sent_faxed", "c_sent_method=Faxed", "checkbox", { x: 42, y: 347.5, width: 10, height: 10 }, "staff"),
    field(28, "well_c_sent_emailed", "c_sent_method=Emailed", "checkbox", { x: 42, y: 324.3, width: 10, height: 10 }, "staff"),
  ];
}

function page36Fields(): FieldMapping[] {
  return [
    field(36, "well_plan_client_name", "client_full_name", "text", { x: 68, y: 744, width: 100, height: 11 }, "auto", null, { fontSize: 8 }),
    field(36, "well_plan_dob", "dob", "text", { x: 205, y: 744, width: 90, height: 11 }, "auto", null, { fontSize: 8 }),
    field(36, "well_plan_mid", "mid_number", "text", { x: 370, y: 744, width: 80, height: 11 }, "auto", null, { fontSize: 8 }),
    field(36, "well_plan_record", "record_number", "text", { x: 505, y: 744, width: 80, height: 11 }, "auto", null, { fontSize: 8 }),
    field(36, "well_plan_client_signature", "signature", "signature", { x: 74, y: 614, width: 220, height: 18 }, "client", "consent_treatment_plan_participation"),
    field(36, "well_plan_client_printed", "client_full_name", "text", { x: 324, y: 614, width: 145, height: 11 }, "client", "consent_treatment_plan_participation"),
    field(36, "well_plan_client_date", "sign_date", "text", { x: 516, y: 614, width: 65, height: 11 }, "client", "consent_treatment_plan_participation"),
    field(36, "well_plan_guardian_signature", "guardian_signature", "signature", { x: 74, y: 584, width: 220, height: 18 }, "guardian", "consent_treatment_plan_participation"),
    field(36, "well_plan_guardian_printed", "guardian_name", "text", { x: 324, y: 584, width: 145, height: 11 }, "guardian", "consent_treatment_plan_participation"),
    field(36, "well_plan_guardian_date", "sign_date", "text", { x: 516, y: 584, width: 65, height: 11 }, "guardian", "consent_treatment_plan_participation"),
    field(36, "well_plan_qp_signature", "staff_signature", "signature", { x: 78, y: 515, width: 210, height: 18 }, "staff"),
    field(36, "well_plan_qp_printed", "staff_receiving_intake", "text", { x: 315, y: 515, width: 155, height: 11 }, "staff"),
    field(36, "well_plan_qp_date", "staff_sign_date", "text", { x: 516, y: 515, width: 65, height: 11 }, "staff"),
  ];
}

/**
 * The Welliance packet is a distinct 36-page form family. It must never
 * inherit coordinates from the 43-page Moore Divine packet just because some
 * labels happen to be similar.
 */
export function welliancePacketFields(): FieldMapping[] {
  const fields: FieldMapping[] = [];
  for (let page = 1; page <= 35; page++) fields.push(...headerFields(page));

  fields.push(
    ...pageWithoutHeader(1),
    ...pageWithoutHeader(2),
    ...pageWithoutHeader(3),
    ...pageWithoutHeader(4).map((candidate) =>
      ["needs", "strengths", "abilities", "preferences", "diagnosis_list"].includes(candidate.source)
        ? { ...candidate, y: candidate.y + 11.5 }
        : candidate,
    ),
  );

  fields.push(
    field(4, "well_axis1_axis_p4", "c_axis1_axis", "text", { x: 50, y: 420, width: 160, height: 11 }, "staff"),
    field(4, "well_axis1_code_p4", "c_axis1_code_number", "text", { x: 225, y: 405, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_axis1_description_p4", "c_axis1_description", "text", { x: 407, y: 405, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_axis2_axis_p4", "c_axis2_axis", "text", { x: 50, y: 379, width: 160, height: 11 }, "staff"),
    field(4, "well_axis2_code_p4", "c_axis2_code_number", "text", { x: 225, y: 364, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_axis2_description_p4", "c_axis2_description", "text", { x: 407, y: 364, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_axis3_axis_p4", "c_axis3_axis", "text", { x: 50, y: 336, width: 160, height: 11 }, "staff"),
    field(4, "well_axis3_code_p4", "c_axis3_code_number", "text", { x: 225, y: 321, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_axis3_description_p4", "c_axis3_description", "text", { x: 407, y: 321, width: 165, height: 35 }, "staff", null, { fontSize: 7.5, lines: 3, lineHeight: 9.5 }),
    field(4, "well_qp_signature_p4", "staff_signature", "signature", { x: 40, y: 92, width: 510, height: 20 }, "staff"),
  );

  fields.push(
    ...transformedPage(5, (y) => 0.9927 * y + 19.1),
    ...transformedPage(6, (y) => y + 26.2, ["mh_history_cont"]),
    ...transformedPage(7, (y) => 0.9904 * y + 36.4),
    ...transformedPage(8, (y) => y + 49.3),
  );

  fields.push(
    field(9, "well_ability_yes", "ability_to_provide=Yes", "checkbox", { x: 55, y: 628, width: 12, height: 12 }, "staff"),
    field(9, "well_ability_no", "ability_to_provide=No", "checkbox", { x: 55, y: 600, width: 12, height: 12 }, "staff"),
    field(9, "well_ability_clinician_signature", "clinician_signature", "signature", { x: 55, y: 562, width: 300, height: 22 }, "clinician"),
    field(9, "well_ability_clinician_date", "clinician_sign_date", "text", { x: 360, y: 562, width: 90, height: 11 }, "clinician"),
    ...page10Fields(),
    ...page11Fields(),
  );

  fields.push(
    ...signatureFields(12, "well_orientation_client", 168, "client", "consent_orientation", "sign_date", 42, 300, 432, 90),
    ...signatureFields(12, "well_orientation_staff", 134, "staff", "consent_orientation", "staff_sign_date", 42, 300, 432, 90),
    ...signatureFields(14, "well_rights_client", 181, "client", "consent_rights", "sign_date", 42, 300, 432, 90),
    ...signatureFields(14, "well_rights_staff", 147, "staff", "consent_rights", "staff_sign_date", 42, 300, 432, 90),
    field(15, "well_treatment_initial_1", "initials", "initials", { x: 42, y: 640.6, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_treatment_initial_2", "initials", "initials", { x: 42, y: 560.6, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_treatment_initial_3", "initials", "initials", { x: 42, y: 492.2, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_treatment_initial_4", "initials", "initials", { x: 42, y: 480.8, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_treatment_initial_5", "initials", "initials", { x: 42, y: 458.4, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_treatment_initial_6", "initials", "initials", { x: 42, y: 436, width: 18, height: 10 }, "client", "consent_treatment"),
    field(15, "well_oncall_client_name", "client_full_name", "text", { x: 42, y: 379.3, width: 330, height: 11 }, "client", "consent_treatment"),
    ...signatureFields(16, "well_bill_client", 538.9, "client", "consent_bill_of_rights", "sign_date", 42, 300, 432, 90),
    ...signatureFields(16, "well_bill_staff", 504, "staff", "consent_bill_of_rights", "staff_sign_date", 42, 300, 432, 90),
  );

  fields.push(
    ...roiFields(17, "roi1", {
      clientY: 625.5, recipientY: 612.3, itemOffset: 0,
      ackYs: [384.4, 281, 194.7], signatureY: 128, witnessY: 111,
    }),
    ...roiFields(18, "roi2", {
      clientY: 606.1, recipientY: 592.9, itemOffset: -19.3,
      ackYs: [376.4, 272.9, 186.6], signatureY: 120, witnessY: 103,
    }),
    ...roiFields(19, "roi3", {
      clientY: 625.5, recipientY: 612.3, itemOffset: 0,
      ackYs: [384.5, 281, 194.7], signatureY: 128, witnessY: 111,
    }),
  );

  fields.push(
    field(20, "well_transport_destination", "transport_destination", "text", { x: 294, y: 660, width: 245, height: 11 }, "client"),
    ...signatureFields(20, "well_transport_guardian", 546, "guardian", "consent_transport", "sign_date", 42, 300, 390, 170),
    ...signatureFields(20, "well_transport_client", 477, "client", "consent_transport", "sign_date", 42, 300, 390, 170),
    ...signatureFields(20, "well_transport_staff", 409, "staff", "consent_transport", "staff_sign_date", 42, 300, 390, 170),

    field(21, "well_ecare_signer_name", "signer_name", "text", { x: 486, y: 638, width: 90, height: 11 }, "client", "consent_emergency_care", { fontSize: 7.5 }),
    field(21, "well_ecare_ec1_name", "ec1_name", "text", { x: 148, y: 572.9, width: 300, height: 11 }, "client"),
    field(21, "well_ecare_ec1_street", "ec1_street", "text", { x: 137, y: 555.7, width: 285, height: 11 }, "client"),
    field(21, "well_ecare_ec1_home", "ec1_home_phone", "text", { x: 118, y: 539, width: 114, height: 11 }, "client"),
    field(21, "well_ecare_ec1_work", "ec1_work_phone", "text", { x: 264, y: 539, width: 112, height: 11 }, "client"),
    field(21, "well_ecare_ec1_cell", "ec1_cell_phone", "text", { x: 435, y: 539, width: 137, height: 11 }, "client"),
    field(21, "well_ecare_ec2_name", "ec2_name", "text", { x: 148, y: 516.1, width: 300, height: 11 }, "client"),
    field(21, "well_ecare_ec2_street", "ec2_street", "text", { x: 137, y: 498.8, width: 285, height: 11 }, "client"),
    field(21, "well_ecare_ec2_home", "ec2_home_phone", "text", { x: 118, y: 482.1, width: 114, height: 11 }, "client"),
    field(21, "well_ecare_ec2_work", "ec2_work_phone", "text", { x: 264, y: 482.1, width: 112, height: 11 }, "client"),
    field(21, "well_ecare_ec2_cell", "ec2_cell_phone", "text", { x: 435, y: 482.1, width: 137, height: 11 }, "client"),
    ...signatureFields(21, "well_ecare_client", 409, "client", "consent_emergency_care", "sign_date", 42, 300, 395, 170),
    ...signatureFields(21, "well_ecare_staff", 363, "staff", "consent_emergency_care", "staff_sign_date", 42, 300, 395, 170),

    field(22, "well_intervention_targets", "intervention_target_behaviors", "text", { x: 286, y: 492.3, width: 270, height: 11 }, "staff"),
    field(22, "well_intervention_until", "intervention_valid_until", "text", { x: 164, y: 376.5, width: 37, height: 11 }, "staff", null, { fontSize: 6.5 }),
    ...signatureFields(22, "well_intervention_guardian", 276, "guardian", "consent_emergency_interventions", "sign_date", 42, 300, 432, 90),
    ...signatureFields(22, "well_intervention_client", 226, "client", "consent_emergency_interventions", "sign_date", 42, 300, 432, 90),
    ...signatureFields(22, "well_intervention_staff", 169, "staff", "consent_emergency_interventions", "staff_sign_date", 42, 300, 432, 90),
  );

  fields.push(
    ...page23Fields(),
    ...page24Fields(),
    field(25, "well_tpp_client_name", "client_full_name", "text", { x: 55, y: 638.1, width: 260, height: 11 }, "client"),
    field(25, "well_tpp_guardian_signature", "guardian_signature", "signature", { x: 42, y: 522, width: 300, height: 23 }, "guardian", "consent_treatment_plan_participation"),
    field(25, "well_tpp_client_signature", "signature", "signature", { x: 42, y: 465, width: 300, height: 23 }, "client", "consent_treatment_plan_participation"),
    field(25, "well_tpp_staff_signature", "staff_signature", "signature", { x: 42, y: 408, width: 300, height: 23 }, "staff", "consent_treatment_plan_participation"),
    field(26, "well_rtp_client_name", "client_full_name", "text", { x: 42, y: 640.5, width: 260, height: 11 }, "client"),
    field(26, "well_rtp_guardian_signature", "guardian_signature", "signature", { x: 42, y: 568, width: 300, height: 23 }, "guardian", "consent_receipt_treatment_plan"),
    field(26, "well_rtp_client_signature", "signature", "signature", { x: 42, y: 511, width: 300, height: 23 }, "client", "consent_receipt_treatment_plan"),
    field(26, "well_rtp_staff_signature", "staff_signature", "signature", { x: 42, y: 454, width: 300, height: 23 }, "staff", "consent_receipt_treatment_plan"),
    ...page27Fields(),
    ...page28Fields(),
  );

  fields.push(
    field(30, "well_hipaa_understood", "hipaa_understood=true", "checkbox", { x: 44, y: 489.7, width: 10, height: 10 }, "client", "consent_hipaa"),
    field(30, "well_hipaa_copy", "hipaa_copy=true", "checkbox", { x: 44, y: 466.7, width: 10, height: 10 }, "client", "consent_hipaa"),
    ...signatureFields(30, "well_hipaa_client", 418, "client", "consent_hipaa", "sign_date", 42, 300, 432, 90),
    ...signatureFields(30, "well_hipaa_staff", 347, "staff", "consent_hipaa", "staff_sign_date", 42, 300, 432, 90),
    field(31, "well_confidentiality_client_name", "client_full_name", "text", { x: 45, y: 651, width: 235, height: 11 }, "client"),
    ...signatureFields(33, "well_confidentiality_client", 242, "client", "consent_confidentiality", "sign_date", 42, 260, 330, 90),
    ...signatureFields(33, "well_confidentiality_staff", 201, "staff", "consent_confidentiality", "staff_sign_date", 42, 260, 330, 90),
  );

  const page34Y: Record<string, number> = {
    cca_client_printed: 527,
    cca_client_sig: 527,
    cca_client_date: 527,
    cca_guardian_printed: 486,
    cca_guardian_sig: 486,
    cca_guardian_date: 486,
    cca_clinician_printed: 399,
    cca_clinician_sig: 399,
    cca_clinician_date: 399,
    cca_md_printed: 358,
    cca_md_sig: 358,
    cca_md_date: 358,
  };
  fields.push(
    ...pageWithoutHeader(41).map((candidate) => ({
      ...candidate,
      page: 34,
      y: page34Y[candidate.fieldKey] ?? candidate.y,
      height: ["signature", "signature_small"].includes(candidate.type) ? 20 : candidate.height,
    })),
    ...pageWithoutHeader(42).map((candidate) => {
      if (candidate.fieldKey === "otp_client_name") {
        return { ...candidate, page: 35, x: 105, y: 640, width: 240 };
      }
      if (candidate.fieldKey === "otp_record") {
        return { ...candidate, page: 35, x: 430, y: 640, width: 120 };
      }
      return {
        ...candidate,
        page: 35,
        y: candidate.y + 30,
        source: /^otp_row\d_client_date$/.test(candidate.source) ? "sign_date" : candidate.source,
      };
    }),
    ...page36Fields(),
  );

  return fields.map((candidate) => ({
    ...candidate,
    notes: `Verified Welliance Care packet placement${candidate.notes ? `; ${candidate.notes}` : ""}`,
  }));
}
