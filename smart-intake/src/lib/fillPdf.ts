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
  if (source === "dob" || /_date$/.test(source)) v = formatDate(v);
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
  if (f.lines > 1) {
    const lines = wrapText(text, font, f.fontSize, f.width, f.lines);
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
    page.drawText(t, { x: f.x, y: f.y + 4.5, size, font, color: INK });
  }
}

export interface FillInput {
  answers: Answers;
  signatures: Record<string, SignatureRecord>;
  consents: Record<string, boolean>;
  overrides?: FieldMapping[];       // admin mapping-screen overrides
  includeStaffFields?: boolean;     // default true; staff answers fill staff slots
}

export interface FillResult {
  pdfBytes: Uint8Array;
  filled: number;
  skipped: string[]; // fieldKeys left blank (no value / consent not given)
}

export function loadTemplateBytes(): Buffer {
  const candidates = [
    path.join(process.cwd(), "public", "templates", TEMPLATE_FILE),
    path.join(process.cwd(), TEMPLATE_FILE),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return fs.readFileSync(p);
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
  const doc = await PDFDocument.load(loadTemplateBytes());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const pages = doc.getPages();

  const answers: Answers = { ...input.answers };
  // derived/auto values
  const signerName =
    input.signatures.guardian?.printedName || input.signatures.client?.printedName ||
    str(answers.guardian_name) || str(answers.client_full_name);
  answers.signer_name ||= signerName;
  answers.sign_date ||=
    input.signatures.client?.signedDate || input.signatures.guardian?.signedDate ||
    formatDate(str(answers.intake_date)) || new Date().toLocaleDateString("en-US");
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
  for (const f of mergedMap(input.overrides)) {
    const page = pages[f.page - 1];
    if (!page) continue;
    const staffRoles = ["staff", "clinician", "medicalDirector", "witness"];
    if (staffRoles.includes(f.role) && input.includeStaffFields === false) {
      skipped.push(f.fieldKey);
      continue;
    }
    if (f.type === "signature" || f.type === "signature_small") {
      if (drawSignature(page, f, ctx, italic)) filled++;
      else skipped.push(f.fieldKey);
      continue;
    }
    if (f.consentKey && !input.consents[f.consentKey]) {
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
      if (initials) {
        page.drawText(initials, { x: f.x, y: f.y + 1, size: 9, font: bold, color: INK });
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
    const resolved = resolveValue(f.source, answers);
    if (f.type === "checkbox") {
      if (resolved.checked) {
        page.drawText("X", { x: f.x, y: f.y + 1, size: f.fontSize, font: bold, color: INK });
        filled++;
      } else skipped.push(f.fieldKey);
      continue;
    }
    if (resolved.text) {
      drawTextField(page, f, resolved.text, font);
      filled++;
    } else skipped.push(f.fieldKey);
  }

  return { pdfBytes: await doc.save(), filled, skipped };
}
