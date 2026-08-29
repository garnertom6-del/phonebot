import qrcode from "./vendor/qrcode-generator";

export type QrSvgData = {
  /** One SVG path covering every dark module, in module units (1 unit = 1 square). */
  path: string;
  /** Number of modules per side, so the viewBox is `0 0 size size`. */
  size: number;
};

/**
 * Build the SVG path for a QR code of `text`. Type number 0 lets the library
 * pick the smallest version that fits; level M survives a slightly dirty or
 * off-angle phone camera. Returns null when the text is empty or too long.
 */
export function qrSvgData(text: string, level: "L" | "M" | "Q" | "H" = "M"): QrSvgData | null {
  const value = (text || "").trim();
  if (!value) return null;
  try {
    const qr = qrcode(0, level);
    qr.addData(value, "Byte");
    qr.make();
    const size = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < size; row++) {
      let col = 0;
      while (col < size) {
        if (!qr.isDark(row, col)) { col++; continue; }
        // Merge consecutive dark modules in a row into one rectangle.
        let run = 1;
        while (col + run < size && qr.isDark(row, col + run)) run++;
        parts.push(`M${col} ${row}h${run}v1h-${run}z`);
        col += run;
      }
    }
    return { path: parts.join(""), size };
  } catch {
    return null;
  }
}
