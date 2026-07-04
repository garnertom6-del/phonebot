import type { PDFFont } from "pdf-lib";

/** Wrap text to fit a width; returns at most maxLines lines (last line ellipsized). */
export function wrapText(
  text: string, font: PDFFont, fontSize: number, width: number, maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(candidate, fontSize) <= width || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && font.widthOfTextAtSize(lines[maxLines - 1], fontSize) > width) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(last + "…", fontSize) > width) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

/** Shrink font size until a single line fits the width (floor 5pt). */
export function fitFontSize(text: string, font: PDFFont, start: number, width: number): number {
  let size = start;
  while (size > 5 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  return size;
}
