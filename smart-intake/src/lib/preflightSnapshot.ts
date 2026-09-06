import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decodeAnswerRows } from "./intakeData";

export function preflightReviewMatchesRevision(detail: string | null, contentRevision: number): boolean {
  const recorded = /(?:^|;\s*)contentRevision:(\d+)(?:;|$)/.exec(detail || "");
  // Older reviews still use the timestamp gate. Newly recorded reviews also
  // bind to the revision, including writes in the same millisecond.
  return !recorded || Number(recorded[1]) === contentRevision;
}

async function readSource(tx: Prisma.TransactionClient, intakeId: string, providerId: string) {
  await tx.$executeRaw`UPDATE "Intake" SET "id" = "id" WHERE "id" = ${intakeId} AND "providerId" = ${providerId}`;
  return tx.intake.findFirst({
    where: { id: intakeId, providerId },
    include: {
      client: { select: { fullName: true, dob: true } },
      signatures: { orderBy: { id: "asc" }, select: { role: true, updatedAt: true, invalidatedAt: true } },
      uploadedDocuments: {
        where: { docType: "CCA" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, docType: true, reviewJson: true },
      },
    },
  });
}

function fingerprint(intake: NonNullable<Awaited<ReturnType<typeof readSource>>>) {
  return JSON.stringify({
    contentRevision: intake.contentRevision, archived: intake.archived, expectCca: intake.expectCca,
    client: intake.client, signatures: intake.signatures, documents: intake.uploadedDocuments,
  });
}

export async function loadPreflightSnapshot(intakeId: string, providerId: string) {
  return prisma.$transaction(async (tx) => {
    const intake = await readSource(tx, intakeId, providerId);
    if (!intake) return null;
    const answers = decodeAnswerRows(await tx.intakeAnswer.findMany({ where: { intakeId } }));
    return { intake, answers, fingerprint: fingerprint(intake) };
  });
}

/** The freshness audit and comparison share the same lock as answer writers. */
export async function recordPreflightReview(
  snapshot: NonNullable<Awaited<ReturnType<typeof loadPreflightSnapshot>>>,
  providerId: string,
  userId: string,
  detail: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const current = await readSource(tx, snapshot.intake.id, providerId);
    if (!current || fingerprint(current) !== snapshot.fingerprint) return false;
    await tx.auditLog.create({ data: {
      event: "preflight_reviewed", providerId, intakeId: current.id, userId,
      detail: `${detail}; contentRevision:${current.contentRevision}`,
    } });
    return true;
  });
}
