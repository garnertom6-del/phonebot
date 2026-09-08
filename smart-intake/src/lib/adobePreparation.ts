import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { prisma } from "./prisma";
import { isMasterUser } from "./staffProviderScope";
import { readFile, saveFile, deleteFile } from "./storage";
import { adobeConfigured, adobeMonthlyBudget, createAdobeTransport, AdobeRejectedOperation, type AdobeTransport } from "./adobePdfServices";
import { estimatedAdobeUnits, parsePageSelection, preparationJobSchema, type AdobeOperation, type PreparationFile } from "./adobePreparationTypes";

export class AdobePreparationError extends Error { constructor(message: string, public status = 400) { super(message); } }
export type PreparationScope = { providerId: string; userId: string };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 25 * 1024 * 1024;
const uploadTypes: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
export async function preparationScope(tx: Prisma.TransactionClient, scope: PreparationScope, write = false) {
  const [provider, user] = await Promise.all([
    tx.provider.findFirst({ where: { id: scope.providerId, status: "ACTIVE" } }),
    tx.user.findUnique({ where: { id: scope.userId }, include: { memberships: { where: { providerId: scope.providerId, active: true } } } }),
  ]);
  if (!provider || !user || (!isMasterUser(user) && !user.memberships.length)) throw new AdobePreparationError("Provider not found.", 404);
  const canWrite = isMasterUser(user) || user.memberships[0]?.role === "PROVIDER_ADMIN";
  if (write && !canWrite) throw new AdobePreparationError("Provider administrator access is required to prepare blank forms.", 403);
  return { provider, user, canWrite, isMaster: isMasterUser(user) };
}
export async function inspectPreparationPdf(bytes: Buffer): Promise<PreparationFile["inspection"] & { pageCount: number | null }> {
  if (bytes.subarray(0, 1024).indexOf("%PDF-") === -1) throw new AdobePreparationError("This file is not a PDF.");
  // Encrypted object streams cannot be safely inspected by pdf-lib without decryption.
  // Treat an encryption marker conservatively; only the password-removal tool can accept this source.
  if (/\/Encrypt(?=[\s/<])/.test(bytes.toString("latin1"))) return { pageCount: null, encrypted: true, warnings: ["Password protected; page and field inspection is unavailable until protection is removed."] };
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const count = pdf.getPageCount();
    if (!count || count > 100) throw new AdobePreparationError("Use a PDF with 1–100 pages.");
    const signed = pdf.context.enumerateIndirectObjects().some(([, obj]) => obj instanceof PDFDict && (obj.get(PDFName.of("Type")) === PDFName.of("Sig") || (obj.has(PDFName.of("ByteRange")) && obj.has(PDFName.of("Contents")))));
    if (signed) throw new AdobePreparationError("This PDF contains a digital signature. Keep signed documents in Document Center; preparation tools accept blank, unsigned forms only.");
    if (pdf.isEncrypted) return { pageCount: count, encrypted: true, signed: false, warnings: ["Password protected. Only removal with the document password is available."] };
    const fields = pdf.getForm().getFields().map(f => f.getName());
    return { pageCount: count, encrypted: false, signed: false, fieldCount: fields.length, fields: fields.slice(0, 500), warnings: fields.length ? ["PDF form fields still need Smart Intake answer mapping and preview review."] : ["No interactive fields detected. Scanned PDFs may need OCR; use the existing mapper to place Smart Intake answers."] };
  } catch (error) { if (error instanceof AdobePreparationError) throw error; throw new AdobePreparationError("The PDF could not be inspected. Repair it in Acrobat and upload a new copy."); }
}
function cleanName(name: string) { return name.replace(/\\/g, "/").split("/").pop()!.replace(/[^a-zA-Z0-9._ -]/g, "-").slice(0, 150) || "blank-form.pdf"; }
export async function createPreparationSample(scope: PreparationScope) {
  await preparationScope(prisma, scope, true);
  const pdf = await PDFDocument.create();
  for (let n = 1; n <= 2; n++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`SYNTHETIC ADOBE TEST - PAGE ${n}`, { x: 40, y: 730, size: 20 });
    page.drawText("No client information. Demonstration only.", { x: 40, y: 685, size: 13 });
    page.drawText("Name: ______________________", { x: 40, y: 630, size: 14 });
    page.drawText("Date: _______________________", { x: 40, y: 595, size: 14 });
    page.drawText("Practice OCR, conversion, page tools and accessibility checks.", { x: 40, y: 525, size: 11 });
    page.drawText("This sample is not a provider intake template.", { x: 40, y: 490, size: 12 });
  }
  return uploadPreparationFile(scope, Buffer.from(await pdf.save()), "SYNTHETIC-Adobe-Practice.pdf", true);
}
function publicFile(file: { inspectionJson: string; filePath: string; createdByUserId: string; providerId: string; [key: string]: unknown }) {
  const { inspectionJson, filePath: _path, createdByUserId: _user, providerId: _provider, ...visible } = file;
  return { ...visible, inspection: JSON.parse(inspectionJson) };
}
async function estimatedMonth(tx: Prisma.TransactionClient = prisma) {
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const usage = await tx.adobePreparationJob.aggregate({ where: { createdAt: { gte: start } }, _sum: { estimatedUnits: true } });
  return usage._sum.estimatedUnits || 0;
}
export async function listPreparation(scope: PreparationScope) {
  const ctx = await preparationScope(prisma, scope);
  const [files, jobs, monthlyEstimatedUnits] = await Promise.all([
    prisma.adobePreparationFile.findMany({ where: { providerId: scope.providerId }, orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.adobePreparationJob.findMany({ where: { providerId: scope.providerId }, orderBy: { createdAt: "desc" }, take: 100 }), estimatedMonth(),
  ]);
  return { providerId: ctx.provider.id, providerName: ctx.provider.name, canWrite: ctx.canWrite, isMaster: ctx.isMaster,
    configured: adobeConfigured(), adobeClientId: process.env.ADOBE_PDF_EMBED_CLIENT_ID?.trim() || null, monthlyEstimatedUnits, monthlyBudget: adobeMonthlyBudget(),
    files: files.map(publicFile), jobs: jobs.map(j => ({ id: j.id, operation: j.operation, status: j.status, estimatedUnits: j.estimatedUnits, inputIds: JSON.parse(j.inputIdsJson), message: j.message, cleanupPending: j.cleanupPending, createdAt: j.createdAt, createdByName: j.createdByName, nextPollAt: j.nextPollAt })),
  };
}
export async function uploadPreparationFile(scope: PreparationScope, bytes: Buffer, name: string, confirmedNoClientData: boolean, sourceFileId?: string) {
  const { user } = await preparationScope(prisma, scope, true);
  if (!confirmedNoClientData) throw new AdobePreparationError("Confirm that the file is a blank form or synthetic sample with no client information.");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new AdobePreparationError("Upload a nonempty file no larger than 25 MB.");
  name = cleanName(name);
  const ext = name.split(".").pop()!.toLowerCase(), mimeType = uploadTypes[ext];
  if (!mimeType) throw new AdobePreparationError("Supported files: PDF, DOCX, XLSX, PPTX, TXT, PNG and JPEG.");
  if (["docx", "xlsx", "pptx"].includes(ext) && bytes.subarray(0, 2).toString() !== "PK") throw new AdobePreparationError("This is not a valid Office document.");
  if (ext === "png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new AdobePreparationError("Invalid PNG file.");
  if (["jpg", "jpeg"].includes(ext) && bytes.subarray(0, 3).toString("hex") !== "ffd8ff") throw new AdobePreparationError("Invalid JPEG file.");
  const inspection = mimeType === "application/pdf" ? await inspectPreparationPdf(bytes) : { pageCount: null };
  if (sourceFileId && !(await prisma.adobePreparationFile.findFirst({ where: { id: sourceFileId, providerId: scope.providerId } }))) throw new AdobePreparationError("Original file not found in this provider.", 404);
  const id = randomUUID(), filePath = `adobe-preparation/${scope.providerId}/${id}.${ext}`;
  saveFile(filePath, bytes);
  try {
    await prisma.$transaction(async tx => {
      await preparationScope(tx, scope, true);
      await tx.adobePreparationFile.create({ data: { id, providerId: scope.providerId, name, mimeType, filePath, sha256: hash(bytes), byteCount: bytes.length, pageCount: inspection.pageCount, inspectionJson: JSON.stringify(inspection), sourceFileId, createdByUserId: user.id, createdByName: user.name } });
      await tx.auditLog.create({ data: { providerId: scope.providerId, userId: user.id, event: "adobe_blank_form_uploaded", detail: JSON.stringify({ fileId: id, sourceFileId, confirmedNoClientData: true, sha256: hash(bytes) }) } });
    });
  } catch (error) { deleteFile(filePath); throw error; }
  return { id };
}
export async function readPreparationFile(scope: PreparationScope, id: string) {
  await preparationScope(prisma, scope);
  const file = await prisma.adobePreparationFile.findFirst({ where: { id, providerId: scope.providerId } });
  if (!file) throw new AdobePreparationError("File not found.", 404);
  let bytes: Buffer;
  try { bytes = readFile(file.filePath); } catch { throw new AdobePreparationError("The saved file is unavailable.", 404); }
  if (hash(bytes) !== file.sha256) throw new AdobePreparationError("File integrity check failed. Upload a verified source copy.", 409);
  return { file, bytes };
}
async function cleanupAssets(id: string, transport: AdobeTransport) {
  const job = await prisma.adobePreparationJob.findUnique({ where: { id } });
  if (!job) return;
  const remaining: string[] = [];
  for (const assetId of JSON.parse(job.assetIdsJson) as string[]) {
    try { await transport.removeAsset(assetId); } catch { remaining.push(assetId); }
  }
  await prisma.adobePreparationJob.updateMany({ where: { id }, data: { assetIdsJson: JSON.stringify(remaining), cleanupPending: remaining.length > 0 } });
}
export async function startPreparationJob(scope: PreparationScope, raw: unknown, suppliedTransport?: AdobeTransport) {
  const input = preparationJobSchema.parse(raw);
  const { user } = await preparationScope(prisma, scope, true);
  // Passwords are used only in the outgoing request. Never persist, audit or echo them.
  const safeOptions = { ...input.options, password: undefined };
  const requestHash = hash(JSON.stringify({ operation: input.operation, inputIds: input.inputIds, options: safeOptions }));
  const prior = await prisma.adobePreparationJob.findUnique({ where: { providerId_idempotencyKey: { providerId: scope.providerId, idempotencyKey: input.idempotencyKey } } });
  if (prior) { if (prior.requestHash !== requestHash) throw new AdobePreparationError("This request key was already used for different work. Reload before starting another job.", 409); return { id: prior.id, reused: true }; }
  if (!suppliedTransport && !adobeConfigured()) throw new AdobePreparationError("Adobe PDF Services setup is pending. Local upload, inspection and the Acrobat handoff are available.", 503);
  if (new Set(input.inputIds).size !== input.inputIds.length) throw new AdobePreparationError("Choose each source file only once.");
  const files = await Promise.all(input.inputIds.map(id => readPreparationFile(scope, id)));
  const operation = input.operation;
  const isMulti = ["combine", "insert", "replace", "watermark"].includes(operation);
  if ((!isMulti && files.length !== 1) || (operation === "combine" && files.length < 2) || (["insert", "replace", "watermark"].includes(operation) && files.length !== 2)) throw new AdobePreparationError(isMulti ? "Choose the required source PDFs in order." : "Choose one source file for this tool.");
  if (files.reduce((n, f) => n + f.bytes.length, 0) > MAX_BYTES) throw new AdobePreparationError("Selected files exceed the combined 25 MB limit.");
  for (const { file } of files) {
    const inspection = JSON.parse(file.inspectionJson);
    if (operation === "create" ? file.mimeType === "application/pdf" || !Object.values(uploadTypes).includes(file.mimeType) : file.mimeType !== "application/pdf") throw new AdobePreparationError(operation === "create" ? "Choose a supported Office, text or image file." : "This tool requires PDF source files.");
    if (inspection.signed) throw new AdobePreparationError("Signed PDFs cannot be processed.");
    if (inspection.encrypted && operation !== "unprotect") throw new AdobePreparationError("Remove protection with the document password before using this tool.");
  }
  const count = files[0].file.pageCount || 1;
  const totalPages = files.reduce((sum, f) => sum + (f.file.pageCount || 50), 0);
  if (totalPages > 100) throw new AdobePreparationError("Choose at most 100 pages per job.");
  if (["protect", "unprotect"].includes(operation) && (!input.options.password || input.options.password.length < (operation === "protect" ? 8 : 1))) throw new AdobePreparationError("Enter the document password (at least 8 characters for a new password).");
  if (["rotate", "reorder", "delete"].includes(operation)) {
    let pages: number[];
    try { pages = parsePageSelection(input.options.pages, count); } catch (error) { throw new AdobePreparationError((error as Error).message); }
    if (operation === "delete" && pages.length >= count) throw new AdobePreparationError("Keep at least one page in the new copy.");
    if (operation === "reorder" && pages.length !== count) throw new AdobePreparationError("Reordering must include every page exactly once.");
  }
  if (operation === "split" && input.options.pageSize >= count) throw new AdobePreparationError("Pages per file must be smaller than the source page count.");
  if (["insert", "replace"].includes(operation) && input.options.basePage > count + (operation === "insert" ? 1 : 0)) throw new AdobePreparationError("The insertion/replacement page is outside this document.");
  if (operation === "replace" && input.options.basePage - 1 + (files[1].file.pageCount || 0) > count) throw new AdobePreparationError("The replacement file contains more pages than the selected space.");
  const units = estimatedAdobeUnits(operation, totalPages);
  if (input.acknowledgedUnits !== units) throw new AdobePreparationError(`This operation is estimated at ${units} Adobe transactions. Review the estimate and retry.`, 409);
  const id = randomUUID();
  try {
    await prisma.$transaction(async tx => {
      await preparationScope(tx, scope, true);
      if ((await estimatedMonth(tx)) + units > adobeMonthlyBudget()) throw new AdobePreparationError("The Smart Intake monthly Adobe budget would be exceeded. Review usage and the configured budget before starting more work.", 409);
      await tx.adobePreparationJob.create({ data: { id, providerId: scope.providerId, idempotencyKey: input.idempotencyKey, requestHash, operation, inputIdsJson: JSON.stringify(input.inputIds), optionsJson: JSON.stringify(safeOptions), estimatedUnits: units, createdByUserId: user.id, createdByName: user.name } });
      await tx.auditLog.create({ data: { providerId: scope.providerId, userId: user.id, event: "adobe_preparation_requested", detail: JSON.stringify({ jobId: id, operation, inputIds: input.inputIds, confirmedNoClientData: true, estimatedUnits: units }) } });
    });
  } catch (error) {
    const existing = await prisma.adobePreparationJob.findUnique({ where: { providerId_idempotencyKey: { providerId: scope.providerId, idempotencyKey: input.idempotencyKey } } });
    if (existing?.requestHash === requestHash) return { id: existing.id, reused: true };
    throw error;
  }
  const transport = suppliedTransport || createAdobeTransport();
  const ids: string[] = [];
  let submitting = false;
  try {
    for (const { bytes, file } of files) {
      ids.push(await transport.upload({ bytes, mimeType: file.mimeType, pageCount: file.pageCount }));
      await prisma.adobePreparationJob.update({ where: { id }, data: { assetIdsJson: JSON.stringify(ids), cleanupPending: true } });
    }
    submitting = true;
    const pollingUrl = await transport.submit(operation, ids, input.options, count);
    await prisma.adobePreparationJob.update({ where: { id }, data: { pollingUrl, status: "RUNNING", nextPollAt: new Date(Date.now() + 3000) } });
  } catch (error) {
    const rejected = error instanceof AdobeRejectedOperation;
    await prisma.adobePreparationJob.updateMany({ where: { id }, data: { status: rejected ? "FAILED" : submitting ? "SUBMISSION_UNKNOWN" : "FAILED", message: rejected ? error.message : submitting ? "Adobe did not confirm the job location. Do not resubmit automatically; this request may have used transactions. Review Adobe usage before starting a new job." : "Adobe could not upload the source. Check credentials, quota and the source file. No output was saved." } });
    if (!submitting || rejected) await cleanupAssets(id, transport);
  }
  return { id, reused: false };
}
export async function refreshPreparationJob(scope: PreparationScope, id: string, suppliedTransport?: AdobeTransport) {
  await preparationScope(prisma, scope, true);
  const job = await prisma.adobePreparationJob.findFirst({ where: { id, providerId: scope.providerId } });
  if (!job) throw new AdobePreparationError("Job not found.", 404);
  const transport = suppliedTransport || createAdobeTransport();
  if (["DONE", "NO_CHANGE", "FAILED", "EXPIRED"].includes(job.status)) { if (job.cleanupPending) await cleanupAssets(id, transport); return; }
  // Adobe assets expire after 24 hours. Never silently submit a replacement job.
  if (Date.now() - job.createdAt.getTime() > 24 * 60 * 60 * 1000) {
    await prisma.adobePreparationJob.update({ where: { id }, data: { status: "EXPIRED", message: "Adobe's 24-hour result window expired. The original remains available. Review usage before creating a new request." } });
    await cleanupAssets(id, transport); return;
  }
  if (!job.pollingUrl) return;
  if (job.nextPollAt && job.nextPollAt.getTime() > Date.now()) return;
  const token = randomUUID(), now = new Date();
  const claimed = await prisma.adobePreparationJob.updateMany({ where: { id, status: "RUNNING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 5 * 60000), nextPollAt: new Date(Date.now() + 5000) } });
  if (!claimed.count) return;
  const savedPaths: string[] = [];
  try {
    const status = await transport.status(job.pollingUrl);
    if (status === "running") return;
    if (status === "failed") {
      await prisma.adobePreparationJob.updateMany({ where: { id, leaseToken: token }, data: { status: "FAILED", message: "Adobe could not process this file. Review its format, password and permissions, and check Adobe quota. The original is unchanged." } });
      await cleanupAssets(id, transport); return;
    }
    const operation = job.operation as AdobeOperation;
    const outputs = await transport.result(operation, job.pollingUrl, async ids => {
      const current = await prisma.adobePreparationJob.findUniqueOrThrow({ where: { id } });
      await prisma.adobePreparationJob.updateMany({ where: { id, leaseToken: token }, data: { assetIdsJson: JSON.stringify([...new Set([...JSON.parse(current.assetIdsJson), ...ids])]), cleanupPending: true } });
    });
    const sourceId = (JSON.parse(job.inputIdsJson) as string[])[0];
    const sourceRecord = await prisma.adobePreparationFile.findUniqueOrThrow({ where: { id: sourceId } });
    const outputRecords: Prisma.AdobePreparationFileUncheckedCreateInput[] = [];
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i], fileId = randomUUID(), filePath = `adobe-preparation/${scope.providerId}/${id}-${i}.${output.extension}`;
      let inspection: Awaited<ReturnType<typeof inspectPreparationPdf>> = { pageCount: null };
      if (output.mimeType === "application/pdf") inspection = await inspectPreparationPdf(output.bytes);
      if (operation === "protect" && inspection.encrypted) inspection.pageCount = sourceRecord.pageCount;
      saveFile(filePath, output.bytes); savedPaths.push(filePath);
      // Retain the source's provider/filename cues so processing cannot hide packet identity warnings.
      const outputName = cleanName(`${sourceRecord.name.replace(/\.[^.]+$/, "").slice(0, 90)}-${operation}-${i + 1}.${output.extension}`);
      outputRecords.push({ id: fileId, providerId: scope.providerId, name: outputName, filePath, mimeType: output.mimeType, sha256: hash(output.bytes), byteCount: output.bytes.length, pageCount: inspection.pageCount, inspectionJson: JSON.stringify(inspection), sourceFileId: sourceId, jobId: id, createdByUserId: job.createdByUserId, createdByName: job.createdByName });
    }
    await prisma.$transaction(async tx => {
      await preparationScope(tx, scope, true);
      const accepted = await tx.adobePreparationJob.updateMany({ where: { id, status: "RUNNING", leaseToken: token }, data: { status: "DONE", message: "Output saved. Review the new copy before using it as a packet template." } });
      if (!accepted.count) throw new AdobePreparationError("Another request updated this job. Reload its status.", 409);
      for (const data of outputRecords) await tx.adobePreparationFile.create({ data });
      await tx.auditLog.create({ data: { providerId: scope.providerId, userId: scope.userId, event: "adobe_preparation_completed", detail: JSON.stringify({ jobId: id, outputIds: outputRecords.map(r => r.id) }) } });
    });
    savedPaths.length = 0;
    await cleanupAssets(id, transport);
  } catch (error) {
    for (const filePath of savedPaths) deleteFile(filePath);
    const invalidOutput = error instanceof AdobePreparationError && error.status === 400;
    await prisma.adobePreparationJob.updateMany({ where: { id, status: "RUNNING", leaseToken: token }, data: error instanceof AdobeRejectedOperation ? { status: error.unchanged ? "NO_CHANGE" : "FAILED", message: error.message } : invalidOutput ? { status: "FAILED", message: `The Adobe result could not be accepted: ${error.message}` } : { message: "The result could not be retrieved yet. Check status again; this does not submit another Adobe job." } });
    if (error instanceof AdobeRejectedOperation || invalidOutput) await cleanupAssets(id, transport);
  } finally {
    await prisma.adobePreparationJob.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
  }
}
export async function promotePreparationFile(scope: PreparationScope, id: string, confirmedProviderForm: boolean) {
  const { user } = await preparationScope(prisma, scope, true);
  if (!confirmedProviderForm) throw new AdobePreparationError("Verify that this is the correct blank form for this provider.");
  const { file, bytes } = await readPreparationFile(scope, id);
  if (file.promotedTemplateId) return { templateId: file.promotedTemplateId };
  if (file.mimeType !== "application/pdf") throw new AdobePreparationError("Convert this file to PDF before mapping it.");
  const inspection = await inspectPreparationPdf(bytes);
  if (inspection.encrypted) throw new AdobePreparationError("Remove password protection before mapping a template.");
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false }), page = pdf.getPage(0);
  const templateId = randomUUID(), filePath = `templates/providers/${scope.providerId}/adobe-${templateId}.pdf`;
  saveFile(filePath, bytes);
  try {
    const result = await prisma.$transaction(async tx => {
      await preparationScope(tx, scope, true);
      const current = await tx.adobePreparationFile.findFirstOrThrow({ where: { id, providerId: scope.providerId } });
      if (current.promotedTemplateId) return { templateId: current.promotedTemplateId, created: false };
      await tx.pdfTemplate.create({ data: { id: templateId, providerId: scope.providerId, name: `Prepared provider template ${templateId}`, originalFileName: file.name, filePath, pageCount: inspection.pageCount!, pageWidth: page.getWidth(), pageHeight: page.getHeight(), isActive: false, mappingStatus: "DRAFT" } });
      await tx.adobePreparationFile.update({ where: { id }, data: { promotedTemplateId: templateId } });
      await tx.auditLog.create({ data: { providerId: scope.providerId, userId: user.id, event: "adobe_preparation_sent_to_mapping", detail: JSON.stringify({ fileId: id, templateId, sha256: file.sha256, confirmedProviderForm: true }) } });
      return { templateId, created: true };
    });
    if (!result.created) deleteFile(filePath);
    return { templateId: result.templateId };
  } catch (error) { deleteFile(filePath); throw error; }
}
