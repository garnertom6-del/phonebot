import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";
import { loadAnswers, saveAnswers } from "@/lib/intakeData";

/** Staff-side signature capture (staff, clinician, witness, medical director). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const parsed = signatureSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  if (!["staff", "clinician", "witness", "medicalDirector"].includes(parsed.data.role)) {
    return NextResponse.json({ error: "Staff signature role required" }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({ where: { id: params.id, providerId: provider!.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = parsed.data;
  const existing = await prisma.signature.findUnique({
    where: { intakeId_role: { intakeId: intake.id, role: d.role } },
    select: { id: true },
  });
  await prisma.signature.upsert({
    where: { intakeId_role: { intakeId: intake.id, role: d.role } },
    create: { intakeId: intake.id, ...d },
    update: { imageData: d.imageData, printedName: d.printedName, signedDate: d.signedDate, relationship: d.relationship },
  });
  if (d.role === "clinician") {
    const answers = await loadAnswers(intake.id);
    answers.clinician_name = d.printedName;
    answers.c_clinician = d.printedName;
    if (!answers.cca_provider_credentials) answers.cca_provider_credentials = d.printedName;
    if (!answers.dis_prepared_by) answers.dis_prepared_by = d.printedName;
    await saveAnswers(intake.id, answers);
  }
  await audit("signature_captured", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `${d.role} (staff dashboard${existing ? "; replaced" : ""})`,
  });
  return NextResponse.json({ ok: true, replaced: !!existing });
}
