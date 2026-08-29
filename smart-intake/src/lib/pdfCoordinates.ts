import type { PDFFont } from "pdf-lib";

const PDF_TEXT_REPLACEMENTS: Record<string, string> = {
  "\u00a0": " ",
  "\u00ad": "",
  "\u200b": "",
  "\u200c": "",
  "\u200d": "",
  "\u200e": "",
  "\u200f": "",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2190": "<-",
  "\u2192": "->",
  "\u2713": "Yes",
  "\u2714": "Yes",
  "\u2705": "Yes",
  "\u2715": "X",
  "\u274c": "X",
};

/**
 * Standard PDF fonts use WinAnsi and throw when clinical notes contain
 * characters such as non-breaking hyphens, arrows, or emoji. Preserve every
 * encodable character, translate common symbols, and use a visible fallback
 * instead of failing the whole packet preview or generation request.
 */
export function sanitizePdfText(text: string, font: PDFFont): string {
  let safe = "";
  for (const character of String(text || "").normalize("NFC")) {
    const replacement = PDF_TEXT_REPLACEMENTS[character]
      ?? (/^[\r\n\t]$/.test(character) ? " " : character);
    for (const candidate of replacement) {
      try {
        font.encodeText(candidate);
        safe += candidate;
      } catch {
        safe += "?";
      }
    }
  }
  return safe;
}

/** Wrap text to fit a width; returns at most maxLines lines (last line ellipsized). */
export function wrapText(
  text: string, font: PDFFont, fontSize: number, width: number, maxLines: number,
): string[] {
  const words = sanitizePdfText(text, font).replace(/\s+/g, " ").trim().split(" ");
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
  const safeText = sanitizePdfText(text, font);
  let size = start;
  while (size > 5 && font.widthOfTextAtSize(safeText, size) > width) size -= 0.5;
  return size;
}
