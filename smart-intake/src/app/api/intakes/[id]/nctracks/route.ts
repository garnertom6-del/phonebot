import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswerSnapshot, saveAnswerSnapshotChanges } from "@/lib/intakeData";
import { AnswerConflictError } from "@/lib/answerRevisions";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import {
  applyNcTracksResult,
  lookupNcTracks,
  ncTracksConfigured,
} from "@/lib/ncTracksLookup";

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!ncTracksConfigured()) {
    await audit("nctracks_lookup_not_configured", { providerId: provider!.id, intakeId: intake.id, userId: user!.id });
    return NextResponse.json({
      error:
        "Automatic NC Tracks lookup is not connected yet. You can enter the details by hand, or ask your administrator to connect it.",
      setupNeeded: true,
    }, { status: 501 });
  }

  const baseline = await loadAnswerSnapshot(intake.id);
  const current = baseline.answers;
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
    await saveAnswerSnapshotChanges(intake.id, baseline, defaults, { syncClient: true, expectedClientIdentity: intake.client });
    await audit("nctracks_lookup_completed", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: filled.length ? `Filled ${filled.join(", ")}` : "No matching fields returned",
    });
    return NextResponse.json({ ok: true, filled, count: filled.length });
  } catch (e) {
    if (e instanceof AnswerConflictError) return NextResponse.json({ ...e.toJSON(), error: "The intake changed during the NC Tracks lookup. Review the saved answers and run the lookup again." }, { status: 409 });
    const error = e instanceof Error ? e.message : "NC Tracks lookup failed";
    await audit("nctracks_lookup_failed", { providerId: provider!.id, intakeId: intake.id, userId: user!.id, detail: error });
    return NextResponse.json({ error }, { status: 502 });
  }
}
