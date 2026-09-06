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
  return prisma.$transaction(async (tx) => {
    // Use the same row lock as staff copy-link preparation. A delivery that
    // started earlier must re-read any token that another request just issued.
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intakeId}`;
    const intake = await tx.intake.findUnique({
      where: { id: intakeId },
      select: { id: true, copyToken: true, copyTokenExpiresAt: true },
    });
    if (!intake) throw new Error("Intake not found");
    if (copyTokenIsLive(intake.copyToken, intake.copyTokenExpiresAt, now) && intake.copyToken && intake.copyTokenExpiresAt) {
      return { copyToken: intake.copyToken, copyTokenExpiresAt: intake.copyTokenExpiresAt, minted: false };
    }
    const copyToken = newIntakeToken();
    const copyTokenExpiresAt = copyTokenExpiry(now);
    await tx.intake.update({ where: { id: intakeId }, data: { copyToken, copyTokenExpiresAt } });
    return { copyToken, copyTokenExpiresAt, minted: true };
  });
}

export function copiesPath(copyToken: string): string {
  return `/copies/${copyToken}`;
}
