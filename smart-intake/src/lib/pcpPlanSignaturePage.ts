/**
 * NC DMH/DD/SAS Person-Centered Plan "PLAN SIGNATURES" page (1/1/2022 version),
 * appended to a generated packet with the client's own captured signature.
 *
 * This is a state form, so it prints exactly as issued and the values are
 * stamped onto it at fixed coordinates. Every coordinate below was measured
 * from the blank PDF itself - checkbox squares and fill-in rules were detected
 * in a 300dpi render, not estimated - so a long legal name or a re-scanned
 * template cannot quietly push text over a printed label.
 *
 * Three rules this page must never break:
 *   1. The signature is the PNG the client drew on their phone. There is no
 *      typed fallback: an unsigned form prints blank and reports a warning.
 *   2. No date is written anywhere on this page (provider instruction).
 *   3. The third box is "For I/DD services only". It is ticked only when the
 *      CCA documents an I/DD diagnosis - never by default - because it is an
 *      attestation printed above the client's signature.
 */
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sanitizePdfText } from "@/lib/pdfCoordinates";
import { classifyDiagnosis } from "@/lib/ccaMedicalNecessity";
import type { CcaReview } from "@/lib/ccaReview";
import type { SignatureRecord } from "@/lib/signaturePlacement";

export const PCP_PLAN_SIGNATURE_TEMPLATE = "nc-pcp-plan-signatures-2022.pdf";

/** The blank form is 595.44 x 770.57pt - NOT US Letter. */
export const PCP_PAGE_SIZE = { width: 595.44, height: 770.5694 } as const;

const CHECKBOX_SIZE = 7.3;
const INK = rgb(0.07, 0.12, 0.35);

/** Bottom-left corner of each printed checkbox square. */
const BOX = {
  agreesWithPlan: { x: 57.0, y: 689.9 },
  freeChoiceOfProvider: { x: 57.0, y: 671.9 },
  iddServicesOnly: { x: 57.0, y: 653.9 },
  selfYes: { x: 181.4, y: 617.9 },
  selfNo: { x: 211.7, y: 617.9 },
} as const;

/** Text blanks: x is the left end of the printed rule, maxWidth its length. */
const TEXT = {
  name: { x: 115, y: 722.9, maxWidth: 95 },
  dob: { x: 246, y: 722.8, maxWidth: 70 },
  midNumber: { x: 385, y: 722.8, maxWidth: 85 },
  recordNumber: { x: 529, y: 725.1, maxWidth: 60 },
  clientPrintName: { x: 265.5, y: 602.6, maxWidth: 149 },
  guardianPrintName: { x: 265.5, y: 575.7, maxWidth: 149 },
  relationship: { x: 139.0, y: 557.7, maxWidth: 121 },
  caseAgency: { x: 267.5, y: 512.6, maxWidth: 142 },
} as const;

/**
 * Signature blanks: the image is fitted inside and sits on the printed rule.
 * Height is capped at 12pt because this form leaves only ~11pt of clear space
 * between the rule and the caption above it - a taller box lets a tall
 * signature print up through "Person Receiving Services:".
 */
const SIGN = {
  client: { x: 74.2, y: 600.8, width: 148.5, height: 12 },
  guardian: { x: 74.0, y: 573.9, width: 148.7, height: 12 },
} as const;

export interface PcpPlanSignatureInput {
  clientName: string;
  dob?: string | null;
  midNumber?: string | null;
  recordNumber?: string | null;
  caseManagementAgency?: string | null;
  /** False when a parent or legal guardian signs instead of the client. */
  clientIsOwnLegalRepresentative: boolean;
  /** Only true when the CCA documents an I/DD diagnosis. */
  iddDocumented: boolean;
  /** Guardian's relationship to the client, when a guardian signs. */
  guardianRelationship?: string | null;
  signatures: Record<string, SignatureRecord>;
}

export interface PcpPlanSignatureResult {
  pdfBytes: Uint8Array;
  /** Blanks deliberately or unavoidably left empty, for the packet audit line. */
  warnings: string[];
  signedBy: "client" | "guardian" | null;
}

/**
 * True when any diagnosis on the CCA is intellectual/developmental.
 *
 * The shared classifier covers F70-F79. F84 (autism spectrum) is added here
 * only, because on this form "I/DD" means eligibility for an ICF-IID or the
 * Community Alternatives Program, which does include autism - while the
 * service scorer deliberately treats F84 as mental health for coverage.
 */
export function pcpIddDocumented(review: CcaReview | null | undefined): boolean {
  if (!review) return false;
  const all = [review.primaryDiagnosis, ...review.additionalDiagnoses, ...review.sudDiagnoses]
    .filter((dx): dx is NonNullable<typeof dx> => !!dx && !!(dx.code || dx.label));
  return all.some((dx) => (
    classifyDiagnosis(dx) === "idd" || /\bF84(\.\d+)?\b/i.test(`${dx.code} ${dx.label}`)
  ));
}

function tick(page: PDFPage, font: PDFFont, box: { x: number; y: number }) {
  const size = 6;
  const width = font.widthOfTextAtSize("X", size);
  page.drawText("X", {
    x: box.x + (CHECKBOX_SIZE - width) / 2,
    y: box.y + 1.6,
    size,
    font,
    color: INK,
  });
}

/** Draws text shrunk to stay inside its printed blank; returns false if empty. */
function write(
  page: PDFPage, font: PDFFont,
  slot: { x: number; y: number; maxWidth: number },
  value: unknown, startSize = 9,
): boolean {
  const text = sanitizePdfText(String(value ?? "").trim(), font);
  if (!text) return false;
  let size = startSize;
  while (size > 5 && font.widthOfTextAtSize(text, size) > slot.maxWidth) size -= 0.25;
  page.drawText(text, { x: slot.x, y: slot.y, size, font, color: INK });
  return true;
}

/**
 * Appends the PLAN SIGNATURES page to a packet.
 * Returns the packet unchanged (with a warning) if the blank form is missing,
 * so a template problem can never block packet generation.
 */
export async function appendPcpPlanSignaturePage(
  packetBytes: Uint8Array, input: PcpPlanSignatureInput,
): Promise<PcpPlanSignatureResult> {
  const warnings: string[] = [];
  const templatePath = path.join(process.cwd(), "public", "templates", PCP_PLAN_SIGNATURE_TEMPLATE);
  if (!fs.existsSync(templatePath)) {
    return {
      pdfBytes: packetBytes,
      warnings: [`PCP plan signature page skipped: ${PCP_PLAN_SIGNATURE_TEMPLATE} is not installed`],
      signedBy: null,
    };
  }

  const doc = await PDFDocument.load(packetBytes);
  const template = await PDFDocument.load(fs.readFileSync(templatePath));
  const [copied] = await doc.copyPages(template, [0]);
  doc.addPage(copied);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Header - straight off the client record, never typed by staff.
  write(copied, font, TEXT.name, input.clientName);
  write(copied, font, TEXT.dob, input.dob);
  write(copied, font, TEXT.midNumber, input.midNumber);
  write(copied, font, TEXT.recordNumber, input.recordNumber);

  // Section I attestations.
  tick(copied, bold, BOX.agreesWithPlan);
  tick(copied, bold, BOX.freeChoiceOfProvider);
  if (input.iddDocumented) tick(copied, bold, BOX.iddServicesOnly);

  // Who is signing decides which block is used and how "Self" is answered.
  const guardian = input.signatures.guardian;
  const client = input.signatures.client;
  const useGuardian = !input.clientIsOwnLegalRepresentative && !!guardian;
  const signer = useGuardian ? guardian : client;
  tick(copied, bold, useGuardian ? BOX.selfNo : BOX.selfYes);

  const signSlot = useGuardian ? SIGN.guardian : SIGN.client;
  const nameSlot = useGuardian ? TEXT.guardianPrintName : TEXT.clientPrintName;

  // The signature is the drawn PNG only. No typed stand-in, ever.
  let drewSignature = false;
  if (signer?.imageData?.startsWith("data:image")) {
    const base64 = signer.imageData.split(",")[1];
    if (base64) {
      try {
        const image = await doc.embedPng(Buffer.from(base64, "base64"));
        const dims = image.scale(1);
        const scale = Math.min(signSlot.width / dims.width, signSlot.height / dims.height);
        const width = dims.width * scale;
        const height = dims.height * scale;
        copied.drawImage(image, {
          x: signSlot.x + (signSlot.width - width) / 2,
          y: signSlot.y,
          width,
          height,
        });
        drewSignature = true;
      } catch {
        // fall through to the warning below - a corrupt PNG must not be faked
      }
    }
  }
  if (!drewSignature) {
    warnings.push(
      `PCP plan signature page: no ${useGuardian ? "guardian" : "client"} signature image on file, `
      + "so the signature line was left blank",
    );
  }

  // Printed name stays legible text - that is what the blank is for.
  write(copied, font, nameSlot, signer?.printedName || input.clientName);
  if (useGuardian) write(copied, font, TEXT.relationship, input.guardianRelationship || "Legal guardian");

  if (!write(copied, font, TEXT.caseAgency, input.caseManagementAgency)) {
    warnings.push("PCP plan signature page: no case management agency set for this provider");
  }

  // No date is written on this page, by provider instruction. Sections II-IV
  // (QP/LP signature, service orders, other team members) are completed on
  // paper by staff and are deliberately left untouched.

  return { pdfBytes: await doc.save(), warnings, signedBy: signer ? (useGuardian ? "guardian" : "client") : null };
}
