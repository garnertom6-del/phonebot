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
  "\u2015": "-",
  "\u2212": "-",
  "\u2190": "<-",
  "\u2192": "->",
  "\u2713": "Yes",
  "\u2714": "Yes",
  "\u2705": "Yes",
  "\u2715": "X",
  "\u274c": "X",
  "\u2611": "",
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\u2032": "'",
  "\u2033": '"',
  "\u2026": "...",
  "\u2022": "-",
  "\u00B7": "-",
  "\u202F": " ",
  "\u2007": " ",
  "\u2009": " ",
  "\uFEFF": "",
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
};

/**
 * Standard PDF fonts use WinAnsi and throw when clinical notes contain
 * ligatures, checkmarks, emoji, or other CCA-imported Unicode. Translate
 * common symbols, then keep only characters the font can encode so a single
 * glyph cannot 500 the whole packet preview.
 */
export function sanitizePdfText(text: unknown, font: PDFFont): string {
  const raw = text == null
    ? ""
    : Array.isArray(text)
      ? text.map((item) => String(item)).join(", ")
      : String(text);
  const flattened = raw.normalize("NFC")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  let safe = "";
  for (const character of flattened) {
    const replacement = Object.prototype.hasOwnProperty.call(PDF_TEXT_REPLACEMENTS, character)
      ? PDF_TEXT_REPLACEMENTS[character]
      : character;
    for (const candidate of replacement) {
      try {
        font.encodeText(candidate);
        safe += candidate;
      } catch {
        safe += "?";
      }
    }
  }
  return safe.replace(/ {2,}/g, " ").trim();
}

function textWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    const safe = sanitizePdfText(text, font);
    return safe ? font.widthOfTextAtSize(safe, size) : 0;
  }
}

/** Wrap text to fit a width; returns at most maxLines lines (last line ellipsized). */
export function wrapText(
  text: string, font: PDFFont, fontSize: number, width: number, maxLines: number,
): string[] {
  const words = sanitizePdfText(text, font).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (textWidth(font, candidate, fontSize) <= width || !cur) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && textWidth(font, lines[maxLines - 1], fontSize) > width) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && textWidth(font, last + "...", fontSize) > width) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}...`;
  }
  return lines;
}

/** Shrink font size until a single line fits the width (floor 5pt). */
export function fitFontSize(text: string, font: PDFFont, start: number, width: number): number {
  const safeText = sanitizePdfText(text, font);
  let size = start;
  while (size > 5 && textWidth(font, safeText, size) > width) size -= 0.5;
  return size;
}
