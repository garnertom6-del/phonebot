import { z } from "zod";

export const createReviewSchema = z.object({
  expectedContentRevision: z.number().int().positive(),
  sourcePacketId: z.string().uuid().optional(),
}).strict();
export const createCorrectionSchema = z.object({
  reviewId: z.string().uuid(),
  page: z.number().int().min(1).max(1000),
  comment: z.string().trim().min(3).max(2000),
  assignedUserId: z.string().uuid(),
}).strict();
export const updateCorrectionSchema = z.object({
  expectedRevision: z.number().int().positive(),
  assignedUserId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  resolutionNote: z.string().trim().min(3).max(2000).optional(),
}).strict().refine(v => v.status || v.assignedUserId, "Choose a correction change.");

export type ReviewVersion = {
  id: string; source: string; packetVersion: number | null; contentRevision: number;
  pageCount: number; fillWarningCount: number; sha256: string; createdAt: string; createdByName: string;
};
export type ReviewCorrection = {
  id: string; reviewId: string; page: number; comment: string; status: string;
  assignedUserId: string; assignedName: string; ownerActive: boolean;
  createdByName: string; createdAt: string; revision: number;
  resolutionNote: string | null; resolvedByName: string | null; resolvedAt: string | null;
};
export type DocumentCenterData = {
  clientName: string; providerId: string; contentRevision: number; readOnly: boolean;
  adobeClientId: string | null;
  versions: ReviewVersion[]; corrections: ReviewCorrection[];
  staff: { id: string; name: string }[];
  packets: { id: string; packetVersion: number; contentRevision: number; createdAt: string }[];
};
