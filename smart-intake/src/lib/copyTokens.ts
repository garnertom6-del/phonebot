import { prisma } from "./prisma";
import { newIntakeToken } from "./tokens";

export function copyTokenExpiryDays(): number {
  return parseInt(process.env.COPIES_LINK_EXPIRY_DAYS || "90", 10);
}

export function copyTokenExpiry(now = Date.now()): Date {
  return new Date(now + copyTokenExpiryDays() * 24 * 60 * 60 * 1000);
}

export function copyTokenIsLive(
  copyToken: string | null | undefined,
  copyTokenExpiresAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (!copyToken) return false;
  if (!copyTokenExpiresAt) return false;
  const expiresAt = copyTokenExpiresAt instanceof Date
    ? copyTokenExpiresAt.getTime()
    : Date.parse(copyTokenExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * Mint or refresh a copies-only token. Never rotates the Easy Mode intake token.
 * Call when status becomes COMPLETED and immediately before copy delivery.
 */
export async function ensureCompletedCopyToken(intakeId: string, now = Date.now()): Promise<{
  copyToken: string;
  copyTokenExpiresAt: Date;
  minted: boolean;
}> {
  const intake = await prisma.intake.findUnique({
    where: { id: intakeId },
    select: { id: true, copyToken: true, copyTokenExpiresAt: true },
  });
  if (!intake) {
    throw new Error("Intake not found");
  }
  if (copyTokenIsLive(intake.copyToken, intake.copyTokenExpiresAt, now)) {
    return {
      copyToken: intake.copyToken!,
      copyTokenExpiresAt: intake.copyTokenExpiresAt instanceof Date
        ? intake.copyTokenExpiresAt
        : new Date(intake.copyTokenExpiresAt as Date),
      minted: false,
    };
  }
  const copyToken = newIntakeToken();
  const copyTokenExpiresAt = copyTokenExpiry(now);
  await prisma.intake.update({
    where: { id: intakeId },
    data: { copyToken, copyTokenExpiresAt },
  });
  return { copyToken, copyTokenExpiresAt, minted: true };
}

export function copiesPath(copyToken: string): string {
  return `/copies/${copyToken}`;
}
