import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export const DRAFT_WATERMARK_TEXT = "DRAFT";

export function fileSafePdfName(value: string) {
  return value.replace(/\W+/g, "-").replace(/^-+|-+$/g, "") || "Intake";
}

export function packetDownloadFileName(input: {
  providerName: string;
  clientName: string;
  documentState: "DRAFT_PREVIEW" | "CURRENT_FINAL";
}): string {
  const base = `${fileSafePdfName(input.providerName)}-Intake-${fileSafePdfName(input.clientName)}`;
  return input.documentState === "DRAFT_PREVIEW" ? `${base}-DRAFT.pdf` : `${base}.pdf`;
}

/**
 * Stamps a visible DRAFT watermark on every page as real PDF text so a visual
 * or text extract still shows DRAFT. Used only for draft/preview bytes.
 */
export async function stampDraftWatermark(pdfBytes: Uint8Array | Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    const size = Math.max(48, Math.min(width, height) * 0.18);
    const textWidth = font.widthOfTextAtSize(DRAFT_WATERMARK_TEXT, size);
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x: (width - textWidth) / 2,
      y: height / 2 - size / 3,
      size,
      font,
      color: rgb(0.72, 0.12, 0.12),
      opacity: 0.28,
      rotate: degrees(32),
    });
    const headerSize = 14;
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x: 18,
      y: height - 22,
      size: headerSize,
      font,
      color: rgb(0.72, 0.12, 0.12),
    });
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x: 18,
      y: 16,
      size: headerSize,
      font,
      color: rgb(0.72, 0.12, 0.12),
    });
  }
  return doc.save({ useObjectStreams: false });
}
