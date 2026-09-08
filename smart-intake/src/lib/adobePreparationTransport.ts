import { Readable } from "node:stream";
import * as Adobe from "@adobe/pdfservices-node-sdk";
import type { AdobeOperation, PreparationOptions } from "./adobePreparationTypes";
import { parsePageSelection } from "./adobePreparationTypes";

// Only this adapter contacts Adobe. Credentials, asset IDs and polling URLs stay on the server.
export type AdobeInput = { bytes: Buffer; mimeType: string; pageCount: number | null };
export type AdobeOutput = { bytes: Buffer; mimeType: string; extension: string };
export class AdobeRejectedOperation extends Error {
  constructor(public unchanged = false) { super(unchanged ? "This PDF is already compressed. Use the saved source; Adobe did not need to create a smaller copy." : "Adobe rejected this operation. Check the source format, permissions, password and account quota. No new copy was created."); }
}
function knownAdobeRejection(error: unknown): never {
  if (error instanceof Adobe.ServiceApiError && error.statusCode >= 400 && error.statusCode < 500) throw new AdobeRejectedOperation(error.errorCode === "PDF_ALREADY_COMPRESSED");
  if (error instanceof Adobe.ServiceUsageError) throw new AdobeRejectedOperation();
  throw error;
}
export interface AdobeTransport {
  upload(input: AdobeInput): Promise<string>;
  submit(operation: AdobeOperation, assets: string[], options: PreparationOptions, pageCount: number): Promise<string>;
  status(pollingUrl: string): Promise<"running" | "done" | "failed">;
  result(operation: AdobeOperation, pollingUrl: string, rememberAssets: (ids: string[]) => Promise<void>): Promise<AdobeOutput[]>;
  removeAsset(id: string): Promise<void>;
}
export function adobeConfigured() { return !!(process.env.ADOBE_PDF_SERVICES_CLIENT_ID?.trim() && process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET?.trim()); }
export function adobeMonthlyBudget() { const n = Number(process.env.ADOBE_PDF_SERVICES_MONTHLY_BUDGET || "500"); return Number.isInteger(n) && n > 0 ? n : 500; }
export function validateAdobePollingUrl(value: string) {
  const url = new URL(value);
  if (!["https://pdf-services.adobe.io", "https://pdf-services-ue1.adobe.io"].includes(url.origin) || !url.pathname.startsWith("/operation/") || url.username || url.password) throw new Error("Unexpected Adobe job location.");
  return value;
}
function cloudAssetId(asset: Adobe.Asset) {
  if (!(asset instanceof Adobe.CloudAsset)) throw new Error("Unexpected Adobe asset type.");
  return asset.assetId;
}
function pageRanges(pages: number[]) { const ranges = new Adobe.PageRanges(); for (const n of pages) ranges.addSinglePage(n); return ranges; }
export function createAdobeJob(operation: AdobeOperation, ids: string[], options: PreparationOptions, count: number): Adobe.PDFServicesJob {
  const assets = ids.map(id => new Adobe.CloudAsset(id));
  const inputAsset = assets[0];
  const selected = () => pageRanges(parsePageSelection(options.pages, count));
  switch (operation) {
    case "ocr": return new Adobe.OCRJob({ inputAsset, params: new Adobe.OCRParams({ ocrType: Adobe.OCRSupportedType.SEARCHABLE_IMAGE_EXACT }) });
    case "compress": return new Adobe.CompressPDFJob({ inputAsset, params: new Adobe.CompressPDFParams({ compressionLevel: Adobe.CompressionLevel[options.compression] }) });
    case "linearize": return new Adobe.LinearizePDFJob({ inputAsset });
    case "create": return new Adobe.CreatePDFJob({ inputAsset });
    case "word": case "excel": case "powerpoint": case "rtf": {
      const formats = { word: Adobe.ExportPDFTargetFormat.DOCX, excel: Adobe.ExportPDFTargetFormat.XLSX, powerpoint: Adobe.ExportPDFTargetFormat.PPTX, rtf: Adobe.ExportPDFTargetFormat.RTF };
      return new Adobe.ExportPDFJob({ inputAsset, params: new Adobe.ExportPDFParams({ targetFormat: formats[operation] }) });
    }
    case "png": case "jpeg": return new Adobe.ExportPDFToImagesJob({ inputAsset, params: new Adobe.ExportPDFToImagesParams({ outputType: Adobe.ExportPDFToImagesOutputType.ZIP_OF_PAGE_IMAGES, targetFormat: operation === "png" ? Adobe.ExportPDFToImagesTargetFormat.PNG : Adobe.ExportPDFToImagesTargetFormat.JPEG }) });
    case "combine": { const params = new Adobe.CombinePDFParams(); assets.forEach(a => params.addAsset(a)); return new Adobe.CombinePDFJob({ params }); }
    case "split": return new Adobe.SplitPDFJob({ inputAsset, params: new Adobe.SplitPDFParams({ pageCount: options.pageSize }) });
    case "rotate": return new Adobe.RotatePagesJob({ inputAsset, params: new Adobe.RotatePagesParams().setAngleToRotatePagesBy(options.angle, selected()) });
    case "delete": return new Adobe.DeletePagesJob({ inputAsset, params: new Adobe.DeletePagesParams({ pageRanges: selected() }) });
    case "reorder": return new Adobe.ReorderPagesJob({ params: new Adobe.ReorderPagesParams({ asset: inputAsset, pageRanges: selected() }) });
    case "insert": return new Adobe.InsertPagesJob({ params: new Adobe.InsertPagesParams(inputAsset).addPagesToInsertAt({ inputAsset: assets[1], basePage: options.basePage }) });
    case "replace": return new Adobe.ReplacePagesJob({ params: new Adobe.ReplacePagesParams(inputAsset).addPagesForReplace({ asset: assets[1], basePage: options.basePage }) });
    case "watermark": return new Adobe.PDFWatermarkJob({ inputAsset, watermarkAsset: assets[1], params: new Adobe.PDFWatermarkParams({ watermarkAppearance: new Adobe.WatermarkAppearance({ opacity: 20, appearOnForeground: true }) }) });
    case "extract": return new Adobe.ExtractPDFJob({ inputAsset, params: new Adobe.ExtractPDFParams({ elementsToExtract: [Adobe.ExtractElementType.TEXT, Adobe.ExtractElementType.TABLES] }) });
    case "properties": return new Adobe.PDFPropertiesJob({ inputAsset, params: new Adobe.PDFPropertiesParams({ includePageLevelProperties: true }) });
    case "accessibility": return new Adobe.PDFAccessibilityCheckerJob({ inputAsset });
    case "autotag": return new Adobe.AutotagPDFJob({ inputAsset, params: new Adobe.AutotagPDFParams({ generateReport: true }) });
    case "protect": return new Adobe.ProtectPDFJob({ inputAsset, params: new Adobe.ProtectPDFParams({ userPassword: options.password, encryptionAlgorithm: Adobe.EncryptionAlgorithm.AES_256 }) });
    case "unprotect": return new Adobe.RemoveProtectionJob({ inputAsset, params: new Adobe.RemoveProtectionParams({ password: options.password! }) });
  }
}
const resultTypes = {
  ocr: Adobe.OCRResult, compress: Adobe.CompressPDFResult, linearize: Adobe.LinearizePDFResult, create: Adobe.CreatePDFResult,
  word: Adobe.ExportPDFResult, excel: Adobe.ExportPDFResult, powerpoint: Adobe.ExportPDFResult, rtf: Adobe.ExportPDFResult,
  png: Adobe.ExportPDFToImagesResult, jpeg: Adobe.ExportPDFToImagesResult, combine: Adobe.CombinePDFResult, split: Adobe.SplitPDFResult,
  rotate: Adobe.RotatePagesResult, reorder: Adobe.ReorderPagesResult, delete: Adobe.DeletePagesResult, insert: Adobe.InsertPagesResult,
  replace: Adobe.ReplacePagesResult, watermark: Adobe.PDFWatermarkResult, extract: Adobe.ExtractPDFResult, properties: Adobe.PDFPropertiesResult,
  accessibility: Adobe.PDFAccessibilityCheckerResult, autotag: Adobe.AutotagPDFResult, protect: Adobe.ProtectPDFResult, unprotect: Adobe.RemoveProtectionResult,
};
const extensions: Record<string, string> = { "application/pdf": "pdf", "application/zip": "zip", "application/json": "json", "text/html": "html", "text/plain": "txt", "application/rtf": "rtf", "text/rtf": "rtf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx", "image/png": "png", "image/jpeg": "jpg" };
export function createAdobeTransport(): AdobeTransport {
  if (!adobeConfigured()) throw new Error("Adobe PDF Services credentials are not configured.");
  const services = new Adobe.PDFServices({ credentials: new Adobe.ServicePrincipalCredentials({ clientId: process.env.ADOBE_PDF_SERVICES_CLIENT_ID!.trim(), clientSecret: process.env.ADOBE_PDF_SERVICES_CLIENT_SECRET!.trim() }), clientConfig: new Adobe.ClientConfig({ timeout: 20000, region: Adobe.Region.US }) });
  return {
    async upload(input) { const stream = Readable.from(input.bytes); try { return cloudAssetId(await services.upload({ readStream: stream, mimeType: input.mimeType })); } finally { stream.destroy(); } },
    async submit(operation, ids, options, count) { try { return validateAdobePollingUrl(await services.submit({ job: createAdobeJob(operation, ids, options, count) })); } catch (error) { return knownAdobeRejection(error); } },
    async status(url) { try { const value = (await services.getJobStatus({ pollingURL: validateAdobePollingUrl(url) })).status; return value === "done" ? "done" : value === "failed" ? "failed" : "running"; } catch (error) { return knownAdobeRejection(error); } },
    async result(operation, url, rememberAssets) {
      // Call only after DONE. The SDK's getJobResult otherwise waits for a remote job.
      const resultType = resultTypes[operation] as new (...args: any[]) => Adobe.PDFServicesJobResult;
      const { result } = await services.getJobResult({ pollingURL: validateAdobePollingUrl(url), resultType });
      if (result instanceof Adobe.PDFPropertiesResult) return [{ bytes: Buffer.from(result.getPDFPropertiesJson), mimeType: "application/json", extension: "json" }];
      let assets: Adobe.Asset[];
      if (result instanceof Adobe.AutotagPDFResult) assets = [result.taggedPDF, result.report, result.resource].filter((a): a is Adobe.Asset => !!a);
      else if (result instanceof Adobe.ExtractPDFResult) assets = [result.resource, result.content].filter((a): a is Adobe.Asset => !!a);
      else if (result instanceof Adobe.ExportPDFToImagesResult) assets = result.assets;
      else if (result instanceof Adobe.SplitPDFResult) assets = result.assets || (result.asset ? [result.asset] : []);
      else if (result instanceof Adobe.PDFAccessibilityCheckerResult) assets = [result.asset, result.report].filter((a): a is Adobe.Asset => !!a);
      else assets = [(result as { asset: Adobe.Asset }).asset];
      if (!assets.length || assets.length > 100) throw new Error("Adobe returned an unexpected output count.");
      await rememberAssets(assets.map(cloudAssetId));
      const outputs: AdobeOutput[] = [];
      let total = 0;
      for (const asset of assets) {
        const stream = await services.getContent({ asset });
        const chunks: Buffer[] = [];
        for await (const data of stream.readStream as Readable) {
          const chunk = Buffer.from(data); total += chunk.length;
          if (total > 50 * 1024 * 1024) { (stream.readStream as Readable).destroy(); throw new Error("Adobe output exceeds 50 MB."); }
          chunks.push(chunk);
        }
        const mimeType = stream.mimeType.split(";")[0].toLowerCase();
        outputs.push({ bytes: Buffer.concat(chunks), mimeType, extension: extensions[mimeType] || "bin" });
      }
      return outputs;
    },
    async removeAsset(id) { try { await services.deleteAsset({ asset: new Adobe.CloudAsset(id) }); } catch (error) { if (!(error instanceof Adobe.ServiceApiError && error.statusCode === 404)) throw error; } },
  };
}
