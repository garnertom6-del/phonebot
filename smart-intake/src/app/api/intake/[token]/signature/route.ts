import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({ where: { token: params.token } });
  if (!intake || intake.tokenExpiresAt < new Date()) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  const parsed = signatureSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature data" }, { status: 400 });
  const d = parsed.data;
  if (!["client", "guardian"].includes(d.role)) {
    return NextResponse.json({ error: "Clients may only sign as client or guardian" }, { status: 403 });
  }
  await prisma.signature.upsert({
    where: { intakeId_role: { intakeId: intake.id, role: d.role } },
    create: { intakeId: intake.id, ...d },
    update: { imageData: d.imageData, printedName: d.printedName, signedDate: d.signedDate, relationship: d.relationship },
  });
  await audit("signature_captured", {
    intakeId: intake.id, detail: `${d.role} / ${d.relationship || "client"}`,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  // a client/guardian signature moves the intake to SIGNED once submitted
  if (["SUBMITTED", "NEEDS_REVIEW"].includes(intake.status)) {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
  }
  return NextResponse.json({ ok: true });
}
