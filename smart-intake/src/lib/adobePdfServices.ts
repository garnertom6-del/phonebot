/**
 * Clinical-document boundary for the existing CCA, NCTracks and final-packet callers.
 * These functions deliberately preserve bytes and never upload client data to Adobe.
 * The separate blank-form workspace uses adobePreparationTransport.ts for real API operations.
 * DocuSign remains the live e-sign path. This module never signs or recompresses final packets.
 */
export const PDF_SERVICES_CLIENT_ID_ENV = "ADOBE_PDF_SERVICES_CLIENT_ID";
export const PDF_SERVICES_CLIENT_SECRET_ENV = "ADOBE_PDF_SERVICES_CLIENT_SECRET";
export function adobePdfServicesConfigured(): boolean {
  return !!(process.env[PDF_SERVICES_CLIENT_ID_ENV]?.trim() && process.env[PDF_SERVICES_CLIENT_SECRET_ENV]?.trim());
}
export type AdobePdfServicesStatus = { configured: boolean; ocrEnabled: boolean; optimizeEnabled: boolean; signEnabled: boolean };
// These flags describe automatic CLIENT document processing, not blank-template tools.
export function adobePdfServicesStatus(): AdobePdfServicesStatus {
  return { configured: adobePdfServicesConfigured(), ocrEnabled: false, optimizeEnabled: false, signEnabled: false };
}
export async function maybeOcrUploadedPdf(bytes: Buffer | Uint8Array, _mimeType?: string): Promise<Buffer> {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}
export async function maybeOptimizeGeneratedPacket(bytes: Buffer | Uint8Array): Promise<Buffer> {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}
