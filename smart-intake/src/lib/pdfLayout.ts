export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageLayout {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** Extracts visible text and coordinates from a blank packet for AI suggestions. */
export async function extractPdfLayout(bytes: Uint8Array): Promise<PdfPageLayout[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
  const pages: PdfPageLayout[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const transform = item.transform;
        return [{
          text: item.str.trim().replace(/\s+/g, " ").slice(0, 180),
          x: Number(transform[4] || 0),
          y: Number(transform[5] || 0),
          width: Number(item.width || 0),
          height: Number(item.height || 0),
        }];
      })
      .filter((item) => item.width > 0 && item.height > 0);
    pages.push({ page: pageNumber, width: viewport.width, height: viewport.height, items });
  }
  return pages;
}

export function layoutPrompt(pages: PdfPageLayout[]): string {
  return pages.map((page) => {
    const items = page.items.slice(0, 140)
      .map((item) => `${item.text} [x=${item.x.toFixed(1)}, y=${item.y.toFixed(1)}, w=${item.width.toFixed(1)}, h=${item.height.toFixed(1)}]`)
      .join(" | ");
    return `PAGE ${page.page} (${page.width.toFixed(1)}x${page.height.toFixed(1)}): ${items || "[no extractable text]"}`;
  }).join("\n");
}
