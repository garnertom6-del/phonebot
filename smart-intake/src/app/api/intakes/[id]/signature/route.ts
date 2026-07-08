import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";

/** Staff-side signature capture (staff, clinician, witness, medical director). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const parsed = signatureSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  const intake = await prisma.intake.findUnique({ where: { id: params.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = parsed.data;
  await prisma.signature.upsert({
    where: { intakeId_role: { intakeId: intake.id, role: d.role } },
    create: { intakeId: intake.id, ...d },
    update: { imageData: d.imageData, printedName: d.printedName, signedDate: d.signedDate, relationship: d.relationship },
  });
  await audit("signature_captured", { intakeId: intake.id, userId: user!.id, detail: `${d.role} (staff dashboard)` });
  return NextResponse.json({ ok: true });
}
