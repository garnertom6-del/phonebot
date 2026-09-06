import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";
import { saveAnswersInTransaction, decodeAnswerRows } from "@/lib/intakeData";
import { assertReviewedContentRevision, ContentRevisionConflictError } from "@/lib/contentRevision";

/** Staff-side signature capture (staff, clinician, witness, medical director). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const body = await req.json();
  const parsed = signatureSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  if (!["staff", "clinician", "witness", "medicalDirector"].includes(parsed.data.role)) {
    return NextResponse.json({ error: "Staff signature role required" }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: { select: { fullName: true, dob: true } } },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = parsed.data;
  try {
    const replaced = await prisma.$transaction(async (tx) => {
      const locked = await tx.intake.update({ where: { id: intake.id }, data: { lastActivityAt: new Date() }, include: { client: true } });
      assertReviewedContentRevision(body.expectedContentRevision, locked.contentRevision);
      const existing = await tx.signature.findUnique({
        where: { intakeId_role: { intakeId: intake.id, role: d.role } },
        select: { id: true },
      });
      await tx.signature.upsert({
        where: { intakeId_role: { intakeId: intake.id, role: d.role } },
        create: {
          intakeId: intake.id,
          ...d,
          contentRevision: locked.contentRevision,
          subjectNameSnapshot: d.printedName,
          subjectDobSnapshot: locked.client.dob,
          signerUserId: user!.id,
        },
        update: {
          imageData: d.imageData,
          printedName: d.printedName,
          signedDate: d.signedDate,
          relationship: d.relationship,
          contentRevision: locked.contentRevision,
          subjectNameSnapshot: d.printedName,
          subjectDobSnapshot: locked.client.dob,
          signerUserId: user!.id,
          invalidatedAt: null,
          invalidatedReason: null,
        },
      });
      if (d.role === "clinician") {
        const answers = decodeAnswerRows(await tx.intakeAnswer.findMany({ where: { intakeId: intake.id } }));
        await saveAnswersInTransaction(tx, intake.id, {
          clinician_name: d.printedName,
          c_clinician: d.printedName,
          ...(!answers.cca_provider_credentials ? { cca_provider_credentials: d.printedName } : {}),
          ...(!answers.dis_prepared_by ? { dis_prepared_by: d.printedName } : {}),
        }, { invalidateSignatures: false });
      }
      return !!existing;
      });
    await audit("signature_captured", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: `${d.role} (staff dashboard${replaced ? "; replaced" : ""})`,
    });
    return NextResponse.json({ ok: true, replaced });
    } catch (error) {
    if (error instanceof ContentRevisionConflictError) return NextResponse.json(error.toJSON(), { status: 409 });
    throw error;
  }
}
