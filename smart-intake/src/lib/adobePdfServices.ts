/**
 * Adobe PDF Services API stub — Codex handoff surface.
 *
 * This first slice does **not** call Adobe from Render. Staff use desktop
 * Acrobat Pro (see `adobeAcrobatPrep.ts`). When `PDF_SERVICES_CLIENT_ID` and
 * `PDF_SERVICES_CLIENT_SECRET` are set, Codex should implement:
 *
 * 1. OCR on CCA / NC Tracks PDF uploads (image-only scans) before extraction.
 *    Intended callers: `src/app/api/intakes/[id]/cca/route.ts` and
 *    `src/app/api/intakes/[id]/nctracks-upload/route.ts` via
 *    `maybeOcrUploadedPdf`.
 * 2. Compress / optimize generated packets after assembly.
 *    Intended caller: `src/lib/generatePacket.ts` via
 *    `maybeOptimizeGeneratedPacket`. If bytes change, recompute the stored
 *    SHA-256; the certificate page fingerprints the pre-certificate packet.
 *
 * Acrobat Sign is **out of scope** here. DocuSign remains the live e-sign
 * path (`src/lib/docusign.ts`, `src/lib/sendDocuSign.ts`). A later Codex
 * slice may add optional Acrobat Sign beside DocuSign — do not replace it
 * in this module.
 *
 * The app must keep running when these env vars are empty. There is no Adobe
 * SDK dependency.
 */

export const PDF_SERVICES_CLIENT_ID_ENV = "PDF_SERVICES_CLIENT_ID";
export const PDF_SERVICES_CLIENT_SECRET_ENV = "PDF_SERVICES_CLIENT_SECRET";

function envValue(name: string) {
  return (process.env[name] || "").trim();
}

export function adobePdfServicesConfigured(): boolean {
  return !!(envValue(PDF_SERVICES_CLIENT_ID_ENV) && envValue(PDF_SERVICES_CLIENT_SECRET_ENV));
}

export type AdobePdfServicesStatus = {
  configured: boolean;
  ocrEnabled: boolean;
  optimizeEnabled: boolean;
  signEnabled: boolean;
};

/**
 * Runtime flags for the unimplemented cloud operations. OCR and compress stay
 * off until Codex fills in the Adobe PDF Services calls. Acrobat Sign stays
 * off regardless of credentials (DocuSign is the live e-sign path).
 */
export function adobePdfServicesStatus(): AdobePdfServicesStatus {
  const configured = adobePdfServicesConfigured();
  return {
    configured,
    ocrEnabled: false,
    optimizeEnabled: false,
    signEnabled: false,
  };
}

function asBuffer(bytes: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

/**
 * Optional OCR before CCA / NC Tracks extraction. Returns the original bytes
 * until Codex implements Adobe PDF Services OCR. Never throws when credentials
 * are missing. When credentials exist but the call is not implemented yet,
 * logs once per process and returns the original bytes so production does not
 * break.
 */
export async function maybeOcrUploadedPdf(
  bytes: Buffer | Uint8Array,
  mimeType?: string,
): Promise<Buffer> {
  const input = asBuffer(bytes);
  const status = adobePdfServicesStatus();
  if (!status.configured || !status.ocrEnabled) {
    if (status.configured && !status.ocrEnabled) {
      warnUnimplemented("ocr", mimeType);
    }
    return input;
  }
  return input;
}

/**
 * Optional compress / optimize for a fully assembled intake packet.
 * Identity until Codex implements Adobe PDF Services. If a future
 * implementation returns different bytes, `generatePacket` must store a hash
 * of those bytes.
 */
export async function maybeOptimizeGeneratedPacket(bytes: Buffer | Uint8Array): Promise<Buffer> {
  const input = asBuffer(bytes);
  const status = adobePdfServicesStatus();
  if (!status.configured || !status.optimizeEnabled) {
    if (status.configured && !status.optimizeEnabled) {
      warnUnimplemented("optimize");
    }
    return input;
  }
  return input;
}

const warned = new Set<string>();
function warnUnimplemented(operation: "ocr" | "optimize", mimeType?: string) {
  if (warned.has(operation)) return;
  warned.add(operation);
  const extra = mimeType ? ` (mime ${mimeType})` : "";
  console.warn(
    `Adobe PDF Services ${operation} is configured but not implemented yet${extra}. Returning original PDF bytes.`,
  );
}
