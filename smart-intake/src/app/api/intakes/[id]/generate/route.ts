import { NextRequest, NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { generatePacketForIntake, PacketIdentityMismatchError } from "@/lib/generatePacket";
import { ProviderPacketNotReadyError } from "@/lib/providerPacketTemplates";
import { generationReadinessForIntake } from "@/lib/generationReadiness";

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const readiness = await generationReadinessForIntake(params.id, provider!.id);
  if (!readiness) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!readiness.ready) {
    return NextResponse.json({
      code: "INTAKE_NOT_READY",
      error: "Resolve the readiness blockers before generating the completed packet.",
      blockers: readiness.blockers,
    }, { status: 409 });
  }
  let result: Awaited<ReturnType<typeof generatePacketForIntake>>;
  try {
    result = await generatePacketForIntake(params.id, user!.id, provider!.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Packet generation failed";
    if (error instanceof PacketIdentityMismatchError) {
      return NextResponse.json({
        code: error.code,
        error: message,
        recordName: error.recordName,
        answerName: error.answerName,
        canOverride: false,
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
