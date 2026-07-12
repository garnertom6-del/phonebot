/** Extracts text for server-side packet QA. This is intentionally used only
 * for preflight checks, not as the source of client answers. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n");
}
