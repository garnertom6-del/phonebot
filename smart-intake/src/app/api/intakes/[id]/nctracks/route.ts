import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import {
  applyNcTracksResult,
  lookupNcTracks,
  ncTracksConfigured,
} from "@/lib/ncTracksLookup";

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!ncTracksConfigured()) {
    await audit("nctracks_lookup_not_configured", { intakeId: intake.id, userId: user!.id });
    return NextResponse.json({
      error:
        "NC Tracks automatic lookup is not connected yet. Add NC_TRACKS_LOOKUP_URL in Render after you have an approved portal/API workflow.",
      setupNeeded: true,
    }, { status: 501 });
  }

  const current = await loadAnswers(intake.id);
  try {
    const result = await lookupNcTracks({
      intakeId: intake.id,
      client: {
        fullName: intake.client.fullName,
        dob: intake.client.dob,
        midNumber: intake.client.midNumber,
        recordNumber: intake.client.recordNumber,
        phone: intake.client.phone,
      },
      answers: current,
    });
    const { next, filled } = applyNcTracksResult(current, result);
    const defaults = applyOperationalDefaults(next);
    await saveAnswers(intake.id, defaults);
    await syncStructuredRows(intake.id, defaults);
    await prisma.client.update({
      where: { id: intake.clientId },
      data: {
        midNumber: s(defaults.mid_number) || intake.client.midNumber,
        recordNumber: s(defaults.record_number) || intake.client.recordNumber,
        phone: s(defaults.client_phone_cell) || intake.client.phone,
      },
    });
    await audit("nctracks_lookup_completed", {
      intakeId: intake.id,
      userId: user!.id,
      detail: filled.length ? `Filled ${filled.join(", ")}` : "No matching fields returned",
    });
    return NextResponse.json({ ok: true, filled, count: filled.length });
  } catch (e) {
    const error = e instanceof Error ? e.message : "NC Tracks lookup failed";
    await audit("nctracks_lookup_failed", { intakeId: intake.id, userId: user!.id, detail: error });
    return NextResponse.json({ error }, { status: 502 });
  }
}
