import type { Prisma } from "@prisma/client";

type SignatureRole = {
  role: string;
  invalidatedAt?: Date | string | null;
};

type ClientSubmissionState = {
  status: string;
  submittedAt?: Date | string | null;
  signatures?: SignatureRole[];
};

export function hasClientOrGuardianSignature(signatures: SignatureRole[] | undefined): boolean {
  return !!signatures?.some((signature) => (
    (signature.role === "client" || signature.role === "guardian") && !signature.invalidatedAt
  ));
}

export function clientSubmissionFinished(intake: ClientSubmissionState): boolean {
  if (intake.status === "NEEDS_REVIEW") {
    return !!intake.submittedAt && hasClientOrGuardianSignature(intake.signatures);
  }
  return intake.status === "SIGNED"
    || intake.status === "COMPLETED"
    || (!!intake.submittedAt && hasClientOrGuardianSignature(intake.signatures));
}

export async function lockOpenClientIntake(
  db: Prisma.TransactionClient,
  intakeId: string,
): Promise<boolean> {
  const locked = await db.intake.updateMany({
    where: {
      id: intakeId,
      OR: [
        { submittedAt: null, status: { notIn: ["SIGNED", "COMPLETED"] } },
        {
          status: "NEEDS_REVIEW",
          signatures: {
            none: {
              role: { in: ["client", "guardian"] },
              invalidatedAt: null,
            },
          },
        },
      ],
    },
    data: { lastActivityAt: new Date() },
  });
  return locked.count === 1;
}
