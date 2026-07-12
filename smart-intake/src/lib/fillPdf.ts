/**
 * Fills the ACTUAL 43-page Moore Divine Care Client Intake Package PDF using
 * the coordinate map (base map + database overrides). The template has no
 * AcroForm fields, so every value is drawn as a coordinate-based overlay.
 */
import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { PACKET_MAP, TEMPLATE_FILE, type FieldMapping } from "@/config/mooreDivinePacketMap";
import { wrapText, fitFontSize } from "./pdfCoordinates";
import {
  SignatureContext, SignatureRecord, drawSignature, embedSignatureImages,
  initialsFromName, signatureForRole,
} from "./signaturePlacement";
import { applyOperationalDefaults } from "./answerDefaults";

export type Answers = Record<string, unknown>;

const INK = rgb(0.07, 0.12, 0.35);

const FREQ_CODES: Record<string, string> = {
  "Not used past month": "0", "1-3x past month": "1", "1-2x per week": "2",
  "3-6x per week": "3", "Daily": "4",
};
const ROUTE_CODES: Record<string, string> = {
  Oral: "1", Smoking: "2", Inhalation: "3", Injection: "4", Other: "5",
};

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "";
  return String(v);
}

/** Resolve a mapping's `source` expression against the answers. */
export function resolveValue(source: string, answers: Answers): { text?: string; checked?: boolean } {
  if (source.includes("=")) {
    const [key, expected] = source.split("=");
    const v = answers[key];
    if (expected === "true") return { checked: v === true || v === "true" || v === "Yes" };
    return { checked: str(v) === expected };
  }
  if (source.includes("~")) {
    const [key, expected] = source.split("~");
    const v = answers[key];
    return { checked: Array.isArray(v) ? v.includes(expected) : str(v).includes(expected) };
  }
  let v = str(answers[source]);
  if (/^sub\d_freq$/.test(source) && FREQ_CODES[v]) v = `${FREQ_CODES[v]} (${v})`;
  if (/^sub\d_route$/.test(source) && ROUTE_CODES[v]) v = `${ROUTE_CODES[v]} (${v})`;
  if (
    source === "dob" ||
    /_date$/.test(source) ||
    /(^|_)date_(sent|adjudicated)$/.test(source) ||
    source === "intervention_valid_until"
  ) v = formatDate(v);
  return { text: v };
}

function formatDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

function drawTextField(
  page: PDFPage, f: FieldMapping, text: string, font: PDFFont,
) {
  if (!text) return;
  // baselines are lifted a few points so text floats just above the printed
  // underlines instead of touching them
  const flowTotal = f.flowLines ?? f.lines;
  const start = f.startLine ?? 0;
  if (f.lines > 1 || flowTotal > f.lines || start > 0) {
    const lines = wrapText(text, font, f.fontSize, f.width, flowTotal)
      .slice(start, start + f.lines);
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: f.x, y: f.y + f.height - f.fontSize - i * f.lineHeight + 2.5,
        size: f.fontSize, font, color: INK,
      });
    });
  } else {
    const size = fitFontSize(text, font, f.fontSize, f.width);
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > f.width) t = t.slice(0, -1);
    const x = f.align === "center"
      ? f.x + Math.max(0, (f.width - font.widthOfTextAtSize(t, size)) / 2)
      : f.x;
    page.drawText(t, { x, y: f.y + 4.5, size, font, color: INK });
  }
}

function checkboxLeftShift(f: FieldMapping): number {
  const key = f.fieldKey;
  if (f.page === 2 && /^(edu_|funding_|income_|veteran_)/.test(key)) return f.width;
  if (f.page === 5 && /^(rs_|a_income_|a_medicaid$|a_medicare$|svc_|mh_)/.test(key)) return f.width;
  if (f.page === 6 && /^sev_/.test(key)) return f.width * 2;
  if (f.page === 9 && /^able_/.test(key)) return -f.width;
  if (f.page === 11 && /^pc_/.test(key)) return f.width;
  if (f.page === 34 && /^hipaa_/.test(key)) return f.width / 2;
  return 0;
}

function drawCenteredX(page: PDFPage, f: FieldMapping, font: PDFFont) {
  const size = f.fontSize || Math.min(f.width, f.height, 10);
  const textWidth = font.widthOfTextAtSize("X", size);
  const boxLeft = f.x - checkboxLeftShift(f);
  const x = boxLeft + (f.width - textWidth) / 2;
  const y = f.y + (f.height - size) / 2 + 1;
  page.drawText("X", { x, y, size, font, color: INK });
  page.drawText("X", { x: x + 0.25, y, size, font, color: INK });
}

function drawCenteredInitials(page: PDFPage, f: FieldMapping, initials: string, font: PDFFont) {
  let size = Math.min(f.fontSize || 9, f.height || 10);
  while (size > 5 && font.widthOfTextAtSize(initials, size) > f.width) size -= 0.5;
  const width = font.widthOfTextAtSize(initials, size);
  page.drawText(initials, {
    x: f.x + Math.max(0, (f.width - width) / 2),
    y: f.y + Math.max(0, (f.height - size) / 2) + 1,
    size,
    font,
    color: INK,
  });
}

function missingClientPlaceholder(f: FieldMapping): string {
  if (/height|weight|hair/i.test(f.source)) return "N/A";
  return "Not reported";
}

export interface FillInput {
  answers: Answers;
  signatures: Record<string, SignatureRecord>;
  consents: Record<string, boolean>;
  overrides?: FieldMapping[];       // admin mapping-screen overrides
  fields?: FieldMapping[];          // fully resolved field map
  templateBytes?: Buffer | Uint8Array;
  includeStaffFields?: boolean;     // default true; staff answers fill staff slots
}

export interface FillResult {
  pdfBytes: Uint8Array;
  filled: number;
  skipped: string[]; // fieldKeys left blank (no value / consent not given)
}

let templateCache: Buffer | null = null;

export function loadTemplateBytes(): Buffer {
  // the 43-page template never changes at runtime - read it from disk once
  if (templateCache) return templateCache;
  const candidates = [
    path.join(process.cwd(), "public", "templates", TEMPLATE_FILE),
    path.join(process.cwd(), TEMPLATE_FILE),
  ];
  for (const p of candidates) if (fs.existsSync(p)) { templateCache = fs.readFileSync(p); return templateCache; }
  throw new Error(
    `Template PDF not found. Place ${TEMPLATE_FILE} in the project root ` +
    `(and public/templates/). Searched: ${candidates.join(", ")}`,
  );
}

export function mergedMap(overrides?: FieldMapping[]): FieldMapping[] {
  if (!overrides?.length) return PACKET_MAP.fields;
  const byKey = new Map(PACKET_MAP.fields.map((f) => [f.fieldKey, f]));
  for (const o of overrides) {
    if ((o as FieldMapping & { deleted?: boolean }).deleted) byKey.delete(o.fieldKey);
    else byKey.set(o.fieldKey, { ...byKey.get(o.fieldKey), ...o });
  }
  return [...byKey.values()];
}

export async function fillPacket(input: FillInput): Promise<FillResult> {
  const doc = await PDFDocument.load(input.templateBytes ?? loadTemplateBytes());
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const signatureFont = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  const answers: Answers = applyOperationalDefaults(input.answers, { forPdf: true });
  // derived/auto values
  const signerName =
    input.signatures.guardian?.printedName || input.signatures.client?.printedName ||
    str(answers.guardian_name) || str(answers.client_full_name);
  answers.signer_name ||= signerName;
  answers.sign_date ||=
    input.signatures.client?.signedDate || input.signatures.guardian?.signedDate ||
    formatDate(str(answers.intake_date)) || new Date().toLocaleDateString("en-US");
  answers.staff_sign_date ||=
    input.signatures.staff?.signedDate ||
    input.signatures.clinician?.signedDate ||
    input.signatures.witness?.signedDate ||
    "";
  answers.clinician_sign_date ||=
    input.signatures.clinician?.signedDate ||
    input.signatures.staff?.signedDate ||
    input.signatures.witness?.signedDate ||
    "";
  answers.witness_sign_date ||=
    input.signatures.witness?.signedDate ||
    input.signatures.staff?.signedDate ||
    input.signatures.clinician?.signedDate ||
    "";
  answers.medical_director_sign_date ||= input.signatures.medicalDirector?.signedDate || "";
  answers.intake_date ||= new Date().toLocaleDateString("en-US");
  answers.referral_date ||= answers.intake_date;
  answers.assess_date ||= answers.intake_date;

  const ctx: SignatureContext = {
    signatures: input.signatures,
    consents: input.consents,
    embedded: await embedSignatureImages(doc, input.signatures),
  };
  const initials = initialsFromName(signerName);

  let filled = 0;
  const skipped: string[] = [];
  for (const f of input.fields ?? mergedMap(input.overrides)) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const staffRoles = ["staff", "clinician", "medicalDirector", "witness"];
    if (staffRoles.includes(f.role) && input.includeStaffFields === false) {
      skipped.push(f.fieldKey);
      continue;
    }
    // The POC template's printed rules are part of the form. Normal mapped
    // text and signature fields sit on those rules and must not erase them.
    // Only an explicit whiteout mapping may cover stale template text.
    if (f.type === "signature" || f.type === "signature_small") {
      if (drawSignature(page, f, ctx, signatureFont)) filled++;
      else skipped.push(f.fieldKey);
      continue;
    }
    const fillsBeforeSignature = f.fieldKey === "hipaa_understood" || f.fieldKey === "hipaa_copy";
    if (f.consentKey && !fillsBeforeSignature && !input.consents[f.consentKey]) {
      skipped.push(f.fieldKey);
      continue;
    }
    // Purpose-of-disclosure boxes are intentionally left for the client to
    // choose; do not infer or pre-check a legal purpose from staff notes.
    if (/^roi\d+_purpose_/.test(f.fieldKey)) {
      skipped.push(f.fieldKey);
      continue;
    }
    // a signing date only appears when that role actually signed
    if (f.source.endsWith("sign_date") &&
        !signatureForRole(ctx, f.role === "auto" ? "client" : f.role)) {
      skipped.push(f.fieldKey);
      continue;
    }
    if (f.type === "initials") {
      const targetSelected = !f.source.includes("~") || resolveValue(f.source, answers).checked === true;
      if (initials && targetSelected) {
        drawCenteredInitials(page, f, initials, bold);
        filled++;
      } else skipped.push(f.fieldKey);
      continue;
    }
    if (f.type === "survey_rating") {
      const v = str(answers[f.source]);
      if (/^[123]$/.test(v)) {
        page.drawText(`[ ${v} ]`, { x: f.x, y: f.y + 2, size: f.fontSize, font: bold, color: INK });
        filled++;
      } else skipped.push(f.fieldKey);
      continue;
    }
    if (f.type === "whiteout_text") {
      page.drawRectangle({ x: f.x, y: f.y, width: f.width, height: f.height, color: rgb(1, 1, 1) });
      const resolved = resolveValue(f.source, answers);
      if (resolved.text) {
        drawTextField(page, f, resolved.text, bold);
        filled++;
      } else skipped.push(f.fieldKey);
      continue;
    }
    const resolved = resolveValue(f.source, answers);
    if (f.type === "checkbox") {
      if (resolved.checked) {
        drawCenteredX(page, f, bold);
        filled++;
      } else skipped.push(f.fieldKey);
      continue;
    }
    const placeholder = f.page >= 2 && f.page <= 12 && f.role === "client" &&
      f.type === "text" && !f.fieldKey.startsWith("hdr_") && !f.consentKey
      ? missingClientPlaceholder(f)
      : "";
    const text = resolved.text || placeholder;
    if (text) {
      drawTextField(page, f, text, bold);
      filled++;
    } else skipped.push(f.fieldKey);
  }

  // Keep the original Word/PDF drawing streams readable by older viewers.
  // Object-stream rewriting can make the ruled form render blank or lose lines.
  return { pdfBytes: await doc.save({ useObjectStreams: false }), filled, skipped };
}
