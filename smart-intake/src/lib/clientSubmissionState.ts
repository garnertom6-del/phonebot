import type { Prisma } from "@prisma/client";

type SignatureRole = {
  role: string;
};

type ClientSubmissionState = {
  status: string;
  submittedAt?: Date | string | null;
  signatures?: SignatureRole[];
};

export function hasClientOrGuardianSignature(signatures: SignatureRole[] | undefined): boolean {
  return !!signatures?.some((signature) => (
    signature.role === "client" || signature.role === "guardian"
  ));
}

export function clientSubmissionFinished(intake: ClientSubmissionState): boolean {
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
      submittedAt: null,
      status: { notIn: ["SIGNED", "COMPLETED"] },
    },
    data: { lastActivityAt: new Date() },
  });
  return locked.count === 1;
}
