import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { prisma } from "./prisma";
import { isMasterUser } from "./staffProviderScope";
import { fileExists, readFile, saveFile, deleteFile } from "./storage";
import { fillPacket } from "./fillPdf";
import { consentsFromAnswers, loadAnswerSnapshot, loadSignatures } from "./intakeData";
import { requireProviderPacketForCompletion, ProviderPacketNotReadyError } from "./providerPacketTemplates";
import { z } from "zod";
import { createReviewSchema, createCorrectionSchema, updateCorrectionSchema } from "./documentReviewTypes";

export class DocumentReviewError extends Error {
  constructor(message: string, public status = 400, public code = "REVIEW_ERROR") { super(message); }
}
export type ReviewScope = { intakeId: string; providerId: string; userId: string };

async function scopeFor(tx: Prisma.TransactionClient, scope: ReviewScope, write = false) {
  const intake = await tx.intake.findFirst({ where: { id: scope.intakeId, providerId: scope.providerId, provider: { status: "ACTIVE" } }, include: { client: { select: { fullName: true } } } });
  const user = await tx.user.findUnique({ where: { id: scope.userId }, include: { memberships: { where: { providerId: scope.providerId, active: true } } } });
  if (!intake || !user || (!isMasterUser(user) && !user.memberships.length)) throw new DocumentReviewError("Intake not found.", 404);
  const readOnly = !isMasterUser(user) && user.memberships[0]?.role === "REVIEWER";
  if (write && readOnly) throw new DocumentReviewError("Reviewer accounts are read-only.", 403);
  return { intake, user, readOnly };
}

export async function listDocumentReviews(scope: ReviewScope) {
  return prisma.$transaction(async tx => {
    const { intake, readOnly } = await scopeFor(tx, scope);
    const versions = await tx.documentReview.findMany({ where: { intakeId: intake.id }, orderBy: { createdAt: "desc" }, select: {
      id: true, source: true, packetVersion: true, contentRevision: true, pageCount: true, fillWarningCount: true, sha256: true, createdAt: true, createdByName: true,
    } });
    const memberships = await tx.userMembership.findMany({ where: { providerId: scope.providerId, active: true, role: { in: ["STAFF", "PROVIDER_ADMIN"] } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } });
    const staff = memberships.map(m => m.user);
    const corrections = await tx.documentCorrection.findMany({ where: { review: { intakeId: intake.id } }, orderBy: { createdAt: "desc" } });
    const packets = await tx.generatedPdf.findMany({ where: { intakeId: intake.id }, orderBy: { packetVersion: "desc" }, select: { id: true, packetVersion: true, contentRevision: true, createdAt: true } });
    return { clientName: intake.client.fullName, providerId: scope.providerId, contentRevision: intake.contentRevision, readOnly,
      adobeClientId: process.env.ADOBE_PDF_EMBED_CLIENT_ID?.trim() || null,
      versions, corrections: corrections.map(c => ({ ...c, ownerActive: staff.some(u => u.id === c.assignedUserId) })), staff, packets };
  });
}

export async function createDocumentReview(scope: ReviewScope, input: z.infer<typeof createReviewSchema>) {
  const initial = await scopeFor(prisma, scope, true);
  if (initial.intake.contentRevision !== input.expectedContentRevision) throw new DocumentReviewError("The intake changed. Reload and review the current answers before making a review copy.", 409, "CONTENT_CONFLICT");
  let bytes: Buffer;
  let packetVersion: number | null = null;
  let fillWarningCount = 0;
  let contentRevision = input.expectedContentRevision;
  if (input.sourcePacketId) {
    const packet = await prisma.generatedPdf.findFirst({ where: { id: input.sourcePacketId, intakeId: scope.intakeId } });
    if (!packet || !fileExists(packet.filePath)) throw new DocumentReviewError("The selected packet file is unavailable.", 404);
    bytes = readFile(packet.filePath);
    packetVersion = packet.packetVersion;
    contentRevision = packet.contentRevision;
  } else {
    let template;
    try { template = await requireProviderPacketForCompletion(scope.providerId); }
    catch (error) { if (error instanceof ProviderPacketNotReadyError) throw new DocumentReviewError(error.message, 409, error.code); throw error; }
    const snapshot = await loadAnswerSnapshot(scope.intakeId);
    if (snapshot.contentRevision !== input.expectedContentRevision) throw new DocumentReviewError("The intake changed. Reload before saving a review copy.", 409, "CONTENT_CONFLICT");
    const result = await fillPacket({ answers: snapshot.answers, signatures: await loadSignatures(scope.intakeId), consents: consentsFromAnswers(snapshot.answers), templateBytes: template.bytes, fields: template.fields });
    bytes = Buffer.from(result.pdfBytes);
    fillWarningCount = result.warnings.length;
  }
  const pdf = await PDFDocument.load(bytes);
  if (!input.sourcePacketId) {
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const page of pdf.getPages()) {
      page.drawText("DRAFT REVIEW COPY - NOT A COMPLETED PACKET", { x: 12, y: 5, size: 8, font, color: rgb(0.7, 0.12, 0.12) });
    }
    bytes = Buffer.from(await pdf.save());
  }
  const id = randomUUID();
  const filePath = `document-reviews/${scope.intakeId}/${id}.pdf`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  saveFile(filePath, bytes);
  try {
    return await prisma.$transaction(async tx => {
      const { intake, user } = await scopeFor(tx, scope, true);
      if (intake.contentRevision !== input.expectedContentRevision) throw new DocumentReviewError("Answers changed while creating this copy. Reload and try again.", 409, "CONTENT_CONFLICT");
      const review = await tx.documentReview.create({ data: { id, intakeId: intake.id, source: input.sourcePacketId ? "GENERATED" : "DRAFT", sourcePacketId: input.sourcePacketId, packetVersion, contentRevision, filePath, sha256, pageCount: pdf.getPageCount(), fillWarningCount, createdByUserId: user.id, createdByName: user.name } });
      await tx.auditLog.create({ data: { providerId: scope.providerId, intakeId: intake.id, userId: user.id, event: "document_review_created", detail: JSON.stringify({ reviewId: id, source: review.source, contentRevision, sha256 }) } });
      return { id };
    });
  } catch (error) { deleteFile(filePath); throw error; }
}

async function assignee(tx: Prisma.TransactionClient, scope: ReviewScope, userId: string) {
  const membership = await tx.userMembership.findFirst({ where: { providerId: scope.providerId, userId, active: true, role: { in: ["STAFF", "PROVIDER_ADMIN"] } }, include: { user: { select: { name: true } } } });
  if (!membership) throw new DocumentReviewError("Assign active staff from this provider.");
  return membership.user.name;
}

export async function createDocumentCorrection(scope: ReviewScope, input: z.infer<typeof createCorrectionSchema>) {
  return prisma.$transaction(async tx => {
    const { user } = await scopeFor(tx, scope, true);
    const review = await tx.documentReview.findFirst({ where: { id: input.reviewId, intakeId: scope.intakeId } });
    if (!review) throw new DocumentReviewError("Review copy not found.", 404);
    if (input.page > review.pageCount) throw new DocumentReviewError(`Choose a page from 1 to ${review.pageCount}.`);
    const assignedName = await assignee(tx, scope, input.assignedUserId);
    const correction = await tx.documentCorrection.create({ data: { ...input, assignedName, createdByUserId: user.id, createdByName: user.name } });
    await tx.auditLog.create({ data: { providerId: scope.providerId, intakeId: scope.intakeId, userId: user.id, event: "document_correction_created", detail: JSON.stringify({ correctionId: correction.id, reviewId: review.id, page: input.page, assignedUserId: input.assignedUserId }) } });
    return correction;
  });
}

export async function updateDocumentCorrection(scope: ReviewScope, correctionId: string, input: z.infer<typeof updateCorrectionSchema>) {
  return prisma.$transaction(async tx => {
    const { user } = await scopeFor(tx, scope, true);
    const correction = await tx.documentCorrection.findFirst({ where: { id: correctionId, review: { intakeId: scope.intakeId } } });
    if (!correction) throw new DocumentReviewError("Correction not found.", 404);
    if (correction.revision !== input.expectedRevision) throw new DocumentReviewError("This correction changed in another window. Reload the latest details before applying your change.", 409, "CORRECTION_CONFLICT");
    if (input.status === "RESOLVED" && !input.resolutionNote) throw new DocumentReviewError("Describe what was corrected and verified before resolving this item.");
    const data: Prisma.DocumentCorrectionUpdateManyMutationInput = { revision: { increment: 1 } };
    if (input.assignedUserId) { data.assignedUserId = input.assignedUserId; data.assignedName = await assignee(tx, scope, input.assignedUserId); }
    if (input.status) {
      data.status = input.status;
      data.resolutionNote = input.status === "RESOLVED" ? input.resolutionNote : null;
      data.resolvedByName = input.status === "RESOLVED" ? user.name : null;
      data.resolvedAt = input.status === "RESOLVED" ? new Date() : null;
    }
    const changed = await tx.documentCorrection.updateMany({ where: { id: correction.id, revision: input.expectedRevision }, data });
    if (changed.count !== 1) throw new DocumentReviewError("This correction changed. Reload before saving again.", 409, "CORRECTION_CONFLICT");
    await tx.auditLog.create({ data: { providerId: scope.providerId, intakeId: scope.intakeId, userId: user.id, event: "document_correction_updated", detail: JSON.stringify({ correctionId, previous: { status: correction.status, assignedUserId: correction.assignedUserId, resolutionNote: correction.resolutionNote }, ...input }) } });
    return tx.documentCorrection.findUniqueOrThrow({ where: { id: correction.id } });
  });
}
