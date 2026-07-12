import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { generatePacketForIntake } from "@/lib/generatePacket";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { sendIntakeToDocuSign } from "@/lib/sendDocuSign";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  let result: Awaited<ReturnType<typeof generatePacketForIntake>>;
  try {
    result = await generatePacketForIntake(params.id, user!.id, provider!.id, { skipAutoCompletedCopies: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Packet generation failed";
    const status = message.startsWith("Packet identity check failed") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docusign = await sendIntakeToDocuSign({
    intakeId: params.id,
    providerId: provider!.id,
    userId: user!.id,
  });

  if (["not_configured", "missing_email", "failed"].includes(docusign.status)) {
    try {
      await autoSendCompletedCopiesIfEnabled({
        intakeId: params.id,
        providerId: provider!.id,
        userId: user!.id,
      });
    } catch (error) {
      console.error("auto-send completed copies failed", error);
    }
  }

  return NextResponse.json({ ok: true, ...result, docusign });
}
