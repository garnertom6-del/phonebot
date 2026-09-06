import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BENEFIT_RESOURCES } from "./benefitsResources";
import { isMasterUser } from "./staffProviderScope";
import { activeReferralPermission, SUPPORT_PROGRESS_STATUSES, type SupportReferralPatch } from "./supportReferralTypes";

export class SupportReferralError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_REFERRAL") { super(message); }
}
export type ReferralScope = { providerId: string; intakeId: string; userId: string };

async function assertScope(tx: Prisma.TransactionClient, scope: ReferralScope, write: boolean) {
  const [intake, user] = await Promise.all([
    tx.intake.findFirst({ where: { id: scope.intakeId, providerId: scope.providerId, provider: { status: "ACTIVE" } }, select: { id: true } }),
    tx.user.findUnique({ where: { id: scope.userId }, select: { role: true, memberships: { where: { providerId: scope.providerId, active: true }, select: { role: true } } } }),
  ]);
  if (!intake || !user || (!isMasterUser(user) && !user.memberships.length)) throw new SupportReferralError("Not found.", 404, "NOT_FOUND");
  const readOnly = !isMasterUser(user) && user.memberships[0]?.role === "REVIEWER";
  if (write && readOnly) throw new SupportReferralError("Reviewer accounts are read-only.", 403, "READ_ONLY");
  return readOnly;
}

function detailInclude(providerId: string) {
  return {
    assignedUser: { select: { id: true, name: true } },
    events: { where: { providerId }, orderBy: { revision: "desc" as const }, include: { actorUser: { select: { id: true, name: true } } } },
  };
}

export async function listSupportReferrals(scope: ReferralScope) {
  return prisma.$transaction(async (tx) => {
    const readOnly = await assertScope(tx, scope, false);
    const [referrals, memberships] = await Promise.all([
      tx.supportReferral.findMany({ where: { providerId: scope.providerId, intakeId: scope.intakeId }, include: detailInclude(scope.providerId), orderBy: { createdAt: "asc" } }),
      tx.userMembership.findMany({ where: { providerId: scope.providerId, active: true, role: { in: ["PROVIDER_ADMIN", "STAFF"] } }, select: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: "asc" } } }),
    ]);
    return { referrals, staff: memberships.map((membership) => membership.user), readOnly };
  });
}

export async function createSupportReferral(scope: ReferralScope, input: { resourceId: string; category: string }) {
  const resource = BENEFIT_RESOURCES.find((item) => item.id === input.resourceId);
  if (!resource || !resource.needs.some((need) => need === input.category)) throw new SupportReferralError("Choose a listed resource and one of its support topics.");
  try {
    return await prisma.$transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const existing = await tx.supportReferral.findFirst({ where: { providerId: scope.providerId, intakeId: scope.intakeId, resourceId: resource.id }, select: { id: true } });
      if (existing) throw new SupportReferralError("This resource is already tracked for this intake.", 409, "ALREADY_TRACKED");
      const referral = await tx.supportReferral.create({ data: {
        providerId: scope.providerId, intakeId: scope.intakeId,
        resourceId: resource.id, resourceName: resource.title, resourceUrl: resource.url, category: input.category,
      } });
      await tx.supportReferralEvent.create({ data: {
        providerId: scope.providerId, intakeId: scope.intakeId, referralId: referral.id, actorUserId: scope.userId,
        kind: "SUGGESTED", fromStatus: null, toStatus: "SUGGESTED", revision: 1,
        detailsJson: JSON.stringify({ resourceId: resource.id, category: input.category }),
      } });
      return tx.supportReferral.findFirstOrThrow({ where: { id: referral.id, providerId: scope.providerId, intakeId: scope.intakeId }, include: detailInclude(scope.providerId) });
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new SupportReferralError("This resource is already tracked for this intake.", 409, "ALREADY_TRACKED");
    throw error;
  }
}

function observedDate(value: string, label: string, now: Date) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 5 * 60_000) throw new SupportReferralError(`${label} must be a valid date that is not in the future.`);
  return parsed;
}

export async function updateSupportReferral(scope: ReferralScope, referralId: string, patch: SupportReferralPatch) {
  return prisma.$transaction(async (tx) => {
    await assertScope(tx, scope, true);
    const current = await tx.supportReferral.findFirst({ where: { id: referralId, providerId: scope.providerId, intakeId: scope.intakeId } });
    if (!current) throw new SupportReferralError("Not found.", 404, "NOT_FOUND");
    if (current.revision !== patch.expectedRevision) throw new SupportReferralError("This referral changed in another window. Reload it and review the latest details before saving again.", 409, "REFERRAL_CONFLICT");
    const now = new Date();
    const data: Prisma.SupportReferralUncheckedUpdateManyInput = {};
    let status = patch.status ?? current.status;
    let grantedAt = current.permissionGrantedAt;
    let withdrawnAt = current.permissionWithdrawnAt;
    if (patch.permissionAction) {
      if (!patch.permissionAt || !patch.note?.trim()) throw new SupportReferralError("Record the permission date and how the client's decision was confirmed.");
      const when = observedDate(patch.permissionAt, "Permission date", now);
      if (patch.permissionAction === "GRANT") {
        if (patch.permissionConfirmed !== true) throw new SupportReferralError("Confirm that explicit permission was obtained for this resource.");
        if (!patch.permissionSource) throw new SupportReferralError("Choose who gave permission.");
        if (withdrawnAt && when <= withdrawnAt) throw new SupportReferralError("Renewed permission must be after its withdrawal.");
        grantedAt = when;
        data.permissionGrantedAt = when;
        data.permissionSource = patch.permissionSource;
      } else {
        if (!grantedAt || when < grantedAt) throw new SupportReferralError("Withdrawal must be on or after the recorded permission date.");
        withdrawnAt = when;
        data.permissionWithdrawnAt = when;
        status = "DECLINED";
        data.nextContactAt = null;
        if (patch.contactedAt || patch.confirmedAssistanceAt || patch.nextContactAt) throw new SupportReferralError("Withdraw permission separately from recording further contact or assistance.");
      }
      data.permissionRecordedByUserId = scope.userId;
    } else if (patch.permissionAt || patch.permissionSource || patch.permissionConfirmed !== undefined) {
      throw new SupportReferralError("Choose a permission action before recording permission details.");
    }
    const permissionActive = activeReferralPermission({ permissionGrantedAt: grantedAt, permissionWithdrawnAt: withdrawnAt });
    const assignedUserId = patch.assignedUserId !== undefined ? patch.assignedUserId : current.assignedUserId;
    const progressing = SUPPORT_PROGRESS_STATUSES.has(status);
    if ((progressing || patch.contactedAt || patch.confirmedAssistanceAt || patch.nextContactAt) && !permissionActive) throw new SupportReferralError("Record explicit client permission before progressing or scheduling contact.", 400, "PERMISSION_REQUIRED");
    if ((progressing || patch.contactedAt || patch.confirmedAssistanceAt || patch.nextContactAt) && !assignedUserId) throw new SupportReferralError("Assign an active staff member from this provider before progressing.");
    if (assignedUserId && (patch.assignedUserId !== undefined || progressing || patch.contactedAt || patch.confirmedAssistanceAt || patch.nextContactAt)) {
      const member = await tx.userMembership.findFirst({ where: { providerId: scope.providerId, userId: assignedUserId, active: true, role: { in: ["PROVIDER_ADMIN", "STAFF"] } }, select: { id: true } });
      if (!member) throw new SupportReferralError("The assigned staff member must have active write access to this provider.", 400, "INVALID_ASSIGNEE");
    }
    if (patch.assignedUserId !== undefined) data.assignedUserId = patch.assignedUserId;
    if (patch.nextContactAt !== undefined && patch.permissionAction !== "WITHDRAW") data.nextContactAt = patch.nextContactAt ? new Date(patch.nextContactAt) : null;
    if (patch.contactedAt) {
      const contactedAt = observedDate(patch.contactedAt, "Contact date", now);
      if (grantedAt && contactedAt < grantedAt) throw new SupportReferralError("Contact cannot be before the current permission date.");
      data.contactedAt = contactedAt;
    }
    if (status === "CONTACTED" && !current.contactedAt && !patch.contactedAt) throw new SupportReferralError("Enter the actual contact date before marking Contacted.");
    if (patch.confirmedAssistanceAt) {
      if (!patch.note?.trim()) throw new SupportReferralError("Describe how receipt of assistance was confirmed.");
      const confirmedAt = observedDate(patch.confirmedAssistanceAt, "Assistance receipt date", now);
      if (grantedAt && confirmedAt < grantedAt) throw new SupportReferralError("Assistance confirmation cannot be before the current permission date.");
      data.confirmedAssistanceAt = confirmedAt;
    }
    if (patch.status !== undefined || patch.permissionAction === "WITHDRAW") data.status = status;
    if (!Object.keys(data).length && !patch.note?.trim()) throw new SupportReferralError("Choose a change or add an outcome note before saving.");
    const revision = current.revision + 1;
    const saved = await tx.supportReferral.updateMany({ where: { id: referralId, providerId: scope.providerId, intakeId: scope.intakeId, revision: patch.expectedRevision }, data: { ...data, revision } });
    if (saved.count !== 1) throw new SupportReferralError("This referral changed. Reload and review the latest details before saving again.", 409, "REFERRAL_CONFLICT");
    await tx.supportReferralEvent.create({ data: {
      providerId: scope.providerId, intakeId: scope.intakeId, referralId, actorUserId: scope.userId,
      kind: patch.permissionAction === "WITHDRAW" ? "PERMISSION_WITHDRAWN" : patch.permissionAction === "GRANT" ? "PERMISSION_GRANTED" : patch.confirmedAssistanceAt ? "ASSISTANCE_CONFIRMED" : patch.contactedAt ? "CONTACT_RECORDED" : patch.status && patch.status !== current.status ? "STATUS_CHANGED" : "UPDATED",
      fromStatus: current.status, toStatus: status, revision,
      detailsJson: JSON.stringify({ ...patch, expectedRevision: undefined, assignedUserId, permissionActive }),
    } });
    return tx.supportReferral.findFirstOrThrow({ where: { id: referralId, providerId: scope.providerId, intakeId: scope.intakeId }, include: detailInclude(scope.providerId) });
  });
}
