/**
 * Signing certificate: a final page appended to every generated packet that
 * records who signed, how their identity was checked, when, from where, and
 * a SHA-256 fingerprint of the packet pages. If even one letter of those
 * pages is later altered, the fingerprint will no longer match.
 * (To verify: remove the last page, hash the remaining bytes' page content -
 * or simply regenerate from the stored answers and compare fingerprints.)
 */
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SignatureStatus } from "@/lib/signatureStatus";

export interface CertificateSigner {
  role: string;
  printedName: string;
  relationship?: string | null;
  signedDate: string;
  dobVerified?: boolean;
  ip?: string | null;
  createdAt?: Date | null;
}

export interface CertificateInfo {
  clientName: string;
  providerName?: string;
  signers: CertificateSigner[];
  signatureStatuses?: SignatureStatus[];
  consentLabels: string[];
  generatedAt: Date;
}

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const ROLE_LABELS: Record<string, string> = {
  client: "Client", guardian: "Parent / Legal Guardian", staff: "QP / Qualified Professional",
  clinician: "Clinician", witness: "Witness", medicalDirector: "Medical Director",
};

/** Returns the packet with a certificate page appended + the fingerprint of
 *  the original (pre-certificate) bytes. */
export async function appendCertificatePage(
  packetBytes: Uint8Array, info: CertificateInfo,
): Promise<{ pdfBytes: Uint8Array; sha256: string }> {
  const fingerprint = sha256Hex(packetBytes);
  const doc = await PDFDocument.load(packetBytes);
  const certificateProvider = info.providerName?.trim() || "Provider";
  const certificateAppName = certificateProvider.replace(/,\s*Inc\.?$/i, "") || "Provider";
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const ink = rgb(0.07, 0.12, 0.35);
  let y = 740;

  const line = (text: string, opts: { bold?: boolean; size?: number; gap?: number } = {}) => {
    page.drawText(text, { x: 50, y, size: opts.size ?? 10, font: opts.bold ? bold : font, color: ink });
    y -= opts.gap ?? 16;
  };

  line(`${certificateProvider} - Certificate of Electronic Signing`, { bold: true, size: 15, gap: 26 });
  line(`Document: Client Intake Package for ${info.clientName}`, { size: 11, gap: 18 });
  line(`Generated: ${info.generatedAt.toLocaleString("en-US", { timeZone: "America/New_York" })} (Eastern)`, { size: 11, gap: 24 });

  line("Signers", { bold: true, size: 12, gap: 18 });
  for (const s of info.signers) {
    line(`${ROLE_LABELS[s.role] || s.role}: ${s.printedName}` +
      (s.relationship && s.relationship !== "client" ? ` (${s.relationship})` : ""), { size: 10, gap: 14 });
    line(`  Signed ${s.signedDate}` +
      (s.createdAt ? ` (recorded ${s.createdAt.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET)` : "") +
      (s.ip ? ` from IP ${s.ip}` : "") +
      (s.dobVerified ? " - identity confirmed by date of birth" : ""), { size: 9, gap: 16 });
  }
  y -= 8;

  line("Signature status", { bold: true, size: 12, gap: 16 });
  for (const status of info.signatureStatuses || []) {
    if (status.state === "captured") {
      line(`${status.label}: Captured${status.signedDate ? ` on ${status.signedDate}` : " (date not recorded)"}`, { size: 8, gap: 11 });
    } else {
      line(`${status.label}: Missing - ${status.reason}`, { size: 8, gap: 11 });
    }
  }
  y -= 6;

  line("Consents agreed to in this packet", { bold: true, size: 12, gap: 18 });
  if (info.consentLabels.length === 0) line("(none)", { size: 10, gap: 14 });
  for (const c of info.consentLabels.slice(0, 18)) line(`- ${c}`, { size: 9, gap: 13 });
  if (info.consentLabels.length > 18) line(`...and ${info.consentLabels.length - 18} more`, { size: 9, gap: 13 });
  y -= 8;

  line("Document fingerprint (SHA-256 of the packet pages)", { bold: true, size: 12, gap: 16 });
  line(fingerprint.slice(0, 64), { size: 9, gap: 13 });
  y -= 4;
  line("If the packet pages are altered after signing, this fingerprint will no longer match.", { size: 8, gap: 12 });
  line(`Signatures were captured electronically in the ${certificateAppName} Smart Intake application.`, { size: 8, gap: 12 });

  // Preserve the form's original drawing streams when appending the certificate.
  const pdfBytes = await doc.save({ useObjectStreams: false });
  return { pdfBytes, sha256: fingerprint };
}
