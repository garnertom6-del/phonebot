import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import type { FieldMapping } from "@/config/mooreDivinePacketMap";

export interface SignatureRecord {
  role: string;          // client | guardian | staff | clinician | witness | medicalDirector
  imageData: string;     // data URL (image/png)
  printedName: string;
  signedDate: string;
}

export interface SignatureContext {
  signatures: Record<string, SignatureRecord>; // by role
  consents: Record<string, boolean>;           // consentKey -> agreed
  embedded: Map<string, PDFImage>;
}

export async function embedSignatureImages(
  doc: PDFDocument, signatures: Record<string, SignatureRecord>,
): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  for (const [role, sig] of Object.entries(signatures)) {
    if (!sig?.imageData?.startsWith("data:image")) continue;
    const b64 = sig.imageData.split(",")[1];
    if (!b64) continue;
    try {
      out.set(role, await doc.embedPng(Buffer.from(b64, "base64")));
    } catch {
      // ignore malformed image; typed-name fallback is used instead
    }
  }
  return out;
}

/** Which stored signature satisfies a mapped signature slot. */
export function signatureForRole(
  ctx: SignatureContext, role: string,
): { record: SignatureRecord; image?: PDFImage } | null {
  const tryRoles =
    role === "client" ? ["client", "guardian"] :   // guardian signs for minors
    role === "guardian" ? ["guardian"] :
    role === "staff" ? ["staff", "clinician", "witness"] :
    role === "clinician" ? ["clinician", "staff", "witness"] :
    role === "witness" ? ["witness", "staff", "clinician"] :
    [role];
  for (const r of tryRoles) {
    const record = ctx.signatures[r];
    if (record) return { record, image: ctx.embedded.get(r) };
  }
  return null;
}

/**
 * Draw one mapped signature slot. Skips (leaves blank) when the consent for
 * that form was not given or no signature of the required role exists -
 * staff-role slots stay blank until staff sign in the dashboard.
 */
export function drawSignature(
  page: PDFPage, f: FieldMapping, ctx: SignatureContext, italicFont: PDFFont,
): boolean {
  if (f.consentKey && !ctx.consents[f.consentKey]) return false;
  const match = signatureForRole(ctx, f.role === "auto" ? "client" : f.role);
  if (!match) return false;
  if (match.image) {
    const dims = match.image.scale(1);
    const scale = Math.min((f.width * 0.98) / dims.width, (f.height * 0.95) / dims.height);
    const width = dims.width * scale;
    const height = dims.height * scale;
    page.drawImage(match.image, {
      x: f.x + (f.width - width) / 2,
      y: f.y + (f.height - height) / 2,
      width,
      height,
    });
  } else {
    let size = Math.min(12, f.height);
    while (size > 6 && italicFont.widthOfTextAtSize(match.record.printedName, size) > f.width) {
      size -= 0.5;
    }
    page.drawText(match.record.printedName, {
      x: f.x, y: f.y + 6, size, font: italicFont,
      color: rgb(0.05, 0.1, 0.3),
    });
  }
  return true;
}

export function initialsFromName(name: string): string {
  return (name || "").trim().split(/[\s-]+/).filter(Boolean)
    .map((p) => p[0]!.toUpperCase()).join("").slice(0, 4);
}
