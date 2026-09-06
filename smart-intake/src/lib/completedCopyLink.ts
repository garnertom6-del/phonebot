import { prisma } from "./prisma";
import { appBaseUrl } from "./baseUrl";
import { completionReadinessForIntake } from "./completionReadiness";
import { copyTokenExpiry, copyTokenIsLive, copiesPath } from "./copyTokens";
import { newIntakeToken } from "./tokens";

export class CompletedCopyLinkError extends Error {
  constructor(message: string, public status = 409, public blockers: Array<{ code: string; message: string }> = []) { super(message); }
}

/** Prepare a copies-only URL. This never sends messages or records delivery. */
export async function prepareCompletedCopyLink(
  intakeId: string,
  providerId: string,
  request: Request,
  checkReadiness: typeof completionReadinessForIntake = completionReadinessForIntake,
) {
  const intake = await prisma.intake.findFirst({
    where: { id: intakeId, providerId },
    select: {
      id: true, status: true, archived: true, submittedAt: true, contentRevision: true,
      provider: { select: { status: true } },
      signatures: { orderBy: { id: "asc" }, select: { id: true, updatedAt: true, invalidatedAt: true } },
    },
  });
  if (!intake) throw new CompletedCopyLinkError("Not found.", 404);
  if (intake.archived || !intake.submittedAt || intake.status !== "COMPLETED" || intake.provider?.status !== "ACTIVE") {
    throw new CompletedCopyLinkError("Client copies require an active, submitted, completed intake. Open the intake to review its current status.");
  }
  const readiness = await checkReadiness(intakeId, providerId);
  if (!readiness) throw new CompletedCopyLinkError("Not found.", 404);
  if (!readiness.ready || readiness.packetState !== "current" || !readiness.packet.pdfId || !readiness.packet.filePath) {
    throw new CompletedCopyLinkError("The completed packet or its signatures need review before creating a copies link.", 409, readiness.blockers);
  }
  const packetId = readiness.packet.pdfId;
  const access = await prisma.$transaction(async (tx) => {
    // Serialize simultaneous copy-link requests so one cannot replace a token
    // another request has just returned. Keep every write provider-scoped.
    await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intakeId} AND "providerId" = ${providerId}`;
    const current = await tx.intake.findFirst({
      where: { id: intakeId, providerId, archived: false, status: "COMPLETED", submittedAt: { not: null }, provider: { status: "ACTIVE" } },
      select: {
        contentRevision: true, copyToken: true, copyTokenExpiresAt: true,
        generatedPdfs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, contentRevision: true } },
        signatures: { orderBy: { id: "asc" }, select: { id: true, updatedAt: true, invalidatedAt: true } },
      },
    });
    if (!current || current.contentRevision !== intake.contentRevision || current.generatedPdfs[0]?.id !== packetId || current.generatedPdfs[0]?.contentRevision !== current.contentRevision) {
      throw new CompletedCopyLinkError("The intake or packet changed. Refresh and review the current packet before copying its link.");
    }
    // Re-signing can change the packet without changing its content revision.
    if (JSON.stringify(current.signatures) !== JSON.stringify(intake.signatures)) {
      throw new CompletedCopyLinkError("A signature changed. Refresh and review the current packet before copying its link.");
    }
    if (copyTokenIsLive(current.copyToken, current.copyTokenExpiresAt) && current.copyToken && current.copyTokenExpiresAt) {
      return { copyToken: current.copyToken, expiresAt: current.copyTokenExpiresAt, renewed: false };
    }
    const copyToken = newIntakeToken();
    const expiresAt = copyTokenExpiry();
    await tx.intake.updateMany({ where: { id: intakeId, providerId, contentRevision: current.contentRevision }, data: { copyToken, copyTokenExpiresAt: expiresAt } });
    return { copyToken, expiresAt, renewed: true };
  });
  return { link: `${appBaseUrl(request)}${copiesPath(access.copyToken)}`, expiresAt: access.expiresAt.toISOString(), packetId, renewed: access.renewed };
}
