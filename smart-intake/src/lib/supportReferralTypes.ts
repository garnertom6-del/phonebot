import { z } from "zod";

export const SUPPORT_REFERRAL_STATUSES = ["SUGGESTED", "WANTS_HELP", "CONTACTED", "APPLIED", "WAITING", "APPROVED", "DENIED", "UNAVAILABLE", "DECLINED"] as const;
export type SupportReferralStatus = (typeof SUPPORT_REFERRAL_STATUSES)[number];
export const SUPPORT_REFERRAL_LABELS: Record<SupportReferralStatus, string> = {
  SUGGESTED: "Suggested", WANTS_HELP: "Wants help", CONTACTED: "Contacted", APPLIED: "Applied", WAITING: "Waiting",
  APPROVED: "Approved", DENIED: "Denied", UNAVAILABLE: "Unavailable", DECLINED: "Declined",
};
export const SUPPORT_PROGRESS_STATUSES = new Set<string>(["WANTS_HELP", "CONTACTED", "APPLIED", "WAITING", "APPROVED", "DENIED"]);
// Approval may still need follow-up to confirm that assistance was received.
export const SUPPORT_CLOSED_STATUSES = new Set<string>(["DENIED", "UNAVAILABLE", "DECLINED"]);
const date = z.string().datetime({ offset: true });
export const createSupportReferralSchema = z.object({
  resourceId: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(50),
}).strict();
export const updateSupportReferralSchema = z.object({
  expectedRevision: z.number().int().positive(),
  status: z.enum(SUPPORT_REFERRAL_STATUSES).optional(),
  assignedUserId: z.string().trim().min(1).max(100).nullable().optional(),
  nextContactAt: date.nullable().optional(),
  permissionAction: z.enum(["GRANT", "WITHDRAW"]).optional(),
  permissionConfirmed: z.boolean().optional(),
  permissionAt: date.optional(),
  permissionSource: z.enum(["CLIENT", "LEGAL_REPRESENTATIVE"]).optional(),
  contactedAt: date.optional(),
  confirmedAssistanceAt: date.optional(),
  note: z.string().trim().max(2000).optional(),
}).strict();
export type SupportReferralPatch = z.infer<typeof updateSupportReferralSchema>;
export type ReferralStaff = { id: string; name: string };
export interface SupportReferralView {
  id: string;
  providerId: string;
  intakeId: string;
  resourceId: string;
  resourceName: string;
  resourceUrl: string;
  category: string;
  status: SupportReferralStatus;
  assignedUserId: string | null;
  assignedUser: ReferralStaff | null;
  nextContactAt: string | null;
  permissionGrantedAt: string | null;
  permissionWithdrawnAt: string | null;
  permissionSource: string | null;
  contactedAt: string | null;
  confirmedAssistanceAt: string | null;
  revision: number;
  events: Array<{ id: string; kind: string; fromStatus: string | null; toStatus: string; revision: number; detailsJson: string; occurredAt: string; actorUser: ReferralStaff }>;
}

export function activeReferralPermission(referral: { permissionGrantedAt: Date | string | null; permissionWithdrawnAt: Date | string | null }): boolean {
  return !!referral.permissionGrantedAt && (!referral.permissionWithdrawnAt || new Date(referral.permissionGrantedAt) > new Date(referral.permissionWithdrawnAt));
}
