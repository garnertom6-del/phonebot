/**
 * What a client is allowed to upload from their phone, in one place so the
 * rules can be tested. The route used to hold these inline, which meant a
 * dependency bump or a refactor could quietly widen them with nothing failing.
 *
 * Clients photograph an insurance card or an ID, or attach a PDF. Anything
 * else is refused - this is the only path by which a file from an
 * unauthenticated link reaches provider storage.
 */

/** Document slots the client-facing uploader offers. */
export const UPLOAD_DOC_TYPES = [
  "birth_certificate", "insurance_card", "photo_id", "court_order", "ss_card",
  "iep_records", "medication_list", "pcp_plan", "immunization_records", "standing_orders", "other",
] as const;

export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

export const UPLOAD_ALLOWED_MIME: ReadonlySet<string> = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);

export const UPLOAD_ALLOWED_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|heif)$/i;

export type UploadRejection =
  | { ok: false; status: 400; error: string }
  | { ok: true };

/**
 * Decide whether an uploaded file may be stored. Mirrors exactly what the
 * route enforced: a known slot, under the size cap, and either an allowed
 * MIME type or an allowed extension (phones often send octet-stream for HEIC).
 */
export function checkClientUpload(input: {
  docType: string;
  fileName: string;
  fileSize: number;
  fileType: string;
}): UploadRejection {
  if (!(UPLOAD_DOC_TYPES as readonly string[]).includes(input.docType)) {
    return { ok: false, status: 400, error: "Bad docType" };
  }
  if (input.fileSize > UPLOAD_MAX_BYTES) {
    return { ok: false, status: 400, error: "File too large (15MB max)" };
  }
  if (!UPLOAD_ALLOWED_MIME.has(input.fileType) && !UPLOAD_ALLOWED_EXT.test(input.fileName)) {
    return { ok: false, status: 400, error: "Please upload a photo (JPG/PNG/HEIC) or a PDF." };
  }
  return { ok: true };
}

/**
 * Storage-safe file name. Strips every character that could escape the upload
 * directory or confuse the filesystem, then keeps the tail so the extension
 * survives.
 */
export function safeUploadName(fileName: string): string {
  return fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
}
