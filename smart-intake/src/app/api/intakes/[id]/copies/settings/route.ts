import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { setAutoSendCompletedCopies } from "@/lib/sendCompletedCopies";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;

  const body = await req.json();
  if (typeof body.autoSend !== "boolean") {
    return NextResponse.json({ error: "autoSend must be true or false" }, { status: 400 });
  }

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await setAutoSendCompletedCopies(intake.id, body.autoSend);
  await audit("answers_updated", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `completed copy auto-send ${body.autoSend ? "on" : "off"}`,
  });

  return NextResponse.json({ ok: true, autoSend: body.autoSend });
}
