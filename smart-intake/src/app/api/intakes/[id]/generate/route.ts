import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { generatePacketForIntake, PacketIdentityMismatchError } from "@/lib/generatePacket";
import { ProviderPacketNotReadyError } from "@/lib/providerPacketTemplates";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const body = await req.json().catch(() => ({})) as { allowIdentityMismatch?: boolean };
  let result: Awaited<ReturnType<typeof generatePacketForIntake>>;
  try {
    result = await generatePacketForIntake(params.id, user!.id, provider!.id, {
      allowNameMismatch: body.allowIdentityMismatch === true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Packet generation failed";
    if (error instanceof PacketIdentityMismatchError) {
      return NextResponse.json({
        code: error.code,
        error: message,
        recordName: error.recordName,
        answerName: error.answerName,
        canOverride: true,
      }, { status: 409 });
    }
    if (error instanceof ProviderPacketNotReadyError) {
      return NextResponse.json({
        code: error.code,
        error: error.message,
        packetReadiness: error.readiness,
        canContinueIntake: true,
      }, { status: 409 });
    }
    const status = message.startsWith("Packet identity check failed") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, ...result });
}
