import { prisma } from "./prisma";
import { COPY_ALLOWED_STATUSES } from "./completedCopies";

export async function findIntakeByCopyToken(token: string) {
  return prisma.intake.findUnique({
    where: { copyToken: token },
    include: {
      client: true,
      provider: true,
      signatures: { select: { id: true, role: true, printedName: true, signedDate: true } },
    },
  });
}

function copyTokenUnexpired(copyTokenExpiresAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!copyTokenExpiresAt) return false;
  const expiresAt = copyTokenExpiresAt instanceof Date
    ? copyTokenExpiresAt.getTime()
    : Date.parse(String(copyTokenExpiresAt));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function copyLinkIsAvailable(intake: {
  archived: boolean;
  submittedAt: Date | string | null;
  copyTokenExpiresAt: Date | string | null;
  provider?: { status?: string | null } | null;
}, now = Date.now()): boolean {
  if (intake.archived || !intake.submittedAt) return false;
  if (!copyTokenUnexpired(intake.copyTokenExpiresAt, now)) return false;
  if (intake.provider && intake.provider.status !== "ACTIVE") return false;
  return true;
}

export function copyPacketIsReady(intake: {
  archived: boolean;
  status: string;
  copyTokenExpiresAt: Date | string | null;
  provider?: { status?: string | null } | null;
}, now = Date.now()): boolean {
  if (intake.archived || !COPY_ALLOWED_STATUSES.includes(intake.status)) return false;
  if (!copyTokenUnexpired(intake.copyTokenExpiresAt, now)) return false;
  if (intake.provider && intake.provider.status !== "ACTIVE") return false;
  return true;
}
