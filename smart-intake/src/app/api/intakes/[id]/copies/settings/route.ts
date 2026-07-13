import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { setAutoEmailProviderPacket, setAutoSendCompletedCopies } from "@/lib/sendCompletedCopies";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;

  const body = await req.json();
  if (typeof body.autoSend !== "boolean" && typeof body.autoEmailProvider !== "boolean") {
    return NextResponse.json({ error: "Choose a completed-copy or provider-email setting." }, { status: 400 });
  }

  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (typeof body.autoSend === "boolean") await setAutoSendCompletedCopies(intake.id, body.autoSend);
  if (typeof body.autoEmailProvider === "boolean") {
    if (body.autoEmailProvider && !provider!.email) {
      return NextResponse.json({ error: "Add the provider email on the master dashboard before enabling automatic packet email." }, { status: 400 });
    }
    await setAutoEmailProviderPacket(intake.id, body.autoEmailProvider);
  }
  await audit("answers_updated", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: body.autoSend !== undefined
      ? `completed copy auto-send ${body.autoSend ? "on" : "off"}`
      : `provider completed packet email ${body.autoEmailProvider ? "on" : "off"}`,
  });

  return NextResponse.json({ ok: true, autoSend: body.autoSend, autoEmailProvider: body.autoEmailProvider });
}
