/**
 * Staff-facing Acrobat Pro workstation guidance and download helpers.
 *
 * Desktop Adobe Acrobat Pro runs on staff computers, not on Render. These
 * strings and download URLs help staff prepare packets and scans locally,
 * then re-upload them on the surfaces that already accept files.
 *
 * Cloud OCR / compress belongs in `adobePdfServices.ts` (Codex follow-up).
 */

export const DOWNLOAD_FOR_ACROBAT_FINAL = "Download for Acrobat";
export const DOWNLOAD_FOR_ACROBAT_DRAFT = "Download draft for Acrobat";

export const ACROBAT_PACKET_DOWNLOAD_HELP =
  "Open the downloaded PDF in Adobe Acrobat Pro on your workstation. Use OCR, fix fillable fields, or redact as needed, then save. Re-upload the saved file where Smart Intake already accepts packet, CCA, or NC Tracks uploads. Acrobat Pro is not installed on the server.";

export const ACROBAT_TEMPLATE_PREP_TIP =
  "Prepare provider packet PDFs in Adobe Acrobat Pro before mapping and approval: add AcroForm fillable fields, run OCR on scanned pages, and save. Then upload here. Desktop Acrobat is a staff workstation tool — this server cannot run Acrobat Pro.";

export const ACROBAT_SCAN_OCR_TIP =
  "If this scan is a photo or an image-only PDF, run OCR in Adobe Acrobat Pro first, then upload. Readable text improves MID, PCP, and plan extraction.";

export type AcrobatPacketDocumentState = "DRAFT_PREVIEW" | "CURRENT_FINAL";

export function acrobatDownloadLabel(documentState: AcrobatPacketDocumentState) {
  return documentState === "CURRENT_FINAL" ? DOWNLOAD_FOR_ACROBAT_FINAL : DOWNLOAD_FOR_ACROBAT_DRAFT;
}

/** Staff packet download that browsers save (attachment) for opening in Acrobat Pro. */
export function packetAcrobatDownloadHref(intakeId: string, documentState: AcrobatPacketDocumentState) {
  return documentState === "CURRENT_FINAL"
    ? `/api/intakes/${intakeId}/pdf?download=1`
    : `/api/intakes/${intakeId}/pdf?preview=1&download=1`;
}

export function packetPdfContentDisposition(fileName: string, mode: "inline" | "attachment") {
  return `${mode}; filename="${fileName}"`;
}
