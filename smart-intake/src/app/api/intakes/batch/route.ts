import { NextRequest, NextResponse } from "next/server";
import { batchIntakesSchema } from "@/lib/validation";
import { requireStaff } from "@/lib/staffGuard";
import { createStaffIntake } from "@/lib/staffIntakes";
import { generatePacketForIntake } from "@/lib/generatePacket";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;

  const parsed = batchIntakesSchema.safeParse(await req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({
      error: issue?.message || "Invalid input",
      path: issue?.path.join("."),
    }, { status: 400 });
  }

  const recordRows = parsed.data.intakes.map((intake, index) => ({
    value: intake.recordNumber.trim(),
    row: index + 1,
  }));
  const seenRecords = new Map<string, number>();
  for (const item of recordRows) {
    const key = item.value.toLowerCase();
    const existingRow = seenRecords.get(key);
    if (existingRow) {
      return NextResponse.json({
        error: `Rows ${existingRow} and ${item.row} use the same Record#`,
        path: `intakes.${item.row - 1}.recordNumber`,
      }, { status: 400 });
    }
    seenRecords.set(key, item.row);
  }
  const existingClient = await prisma.client.findFirst({
    where: { providerId: provider!.id, recordNumber: { in: recordRows.map((item) => item.value) } },
    select: { fullName: true, recordNumber: true },
  });
  if (existingClient) {
    return NextResponse.json({
      error: `Record# ${existingClient.recordNumber} already belongs to ${existingClient.fullName}`,
      path: "recordNumber",
    }, { status: 400 });
  }

  const created = [];
  const failures = [];
  const commonExpectCca = parsed.data.expectCca;
  const shouldGenerateDraftPackets = parsed.data.generateDraftPackets || parsed.data.generatePackets;

  for (const [index, intake] of parsed.data.intakes.entries()) {
    try {
      const item = await createStaffIntake({
        ...intake,
        expectCca: intake.expectCca ?? commonExpectCca,
      }, user!.id, provider!.id, req);
      let packet: Awaited<ReturnType<typeof generatePacketForIntake>> | undefined;
      let packetError: string | undefined;
      if (shouldGenerateDraftPackets) {
        try {
          packet = await generatePacketForIntake(item.id, user!.id, provider!.id);
        } catch (error) {
          packetError = error instanceof Error ? error.message : "Packet generation failed";
        }
      }
      created.push({ ...item, packet, packetError });
    } catch (error) {
      failures.push({
        row: index + 1,
        clientName: intake.fullName,
        error: error instanceof Error ? error.message : "Failed to create intake",
      });
    }
  }

  return NextResponse.json({
    created,
    failures,
    ok: failures.length === 0,
  }, { status: failures.length && !created.length ? 400 : 200 });
}
