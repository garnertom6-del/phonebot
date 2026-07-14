import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers } from "@/lib/intakeData";
import { applyNcTracksResult } from "@/lib/ncTracksLookup";
import { checkNcTracksEligibility, nctracksEdiConfigured } from "@/lib/nctracksEdi";
import {
  coverageMessage, snapshotFrom271, snapshotFromAnswers, snapshotToAnswers,
} from "@/lib/eligibilityState";

/**
 * Direct NC Tracks eligibility for one intake (Trading Partner / 270-271 EDI).
 *  GET  - return the last saved coverage snapshot + whether the feature is
 *         connected (so the UI can render the right state on load).
 *  POST - run a live 270, parse the 271, auto-fill Medicaid/plan answers, save
 *         a coverage snapshot, and report the result.
 * Dormant until NCTRACKS_EDI_* is configured (see README_NCTRACKS_EDI.md).
 */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = await loadAnswers(intake.id);
  const snapshot = snapshotFromAnswers(answers);
  const hasName = !!(intake.client.fullName || answers.client_full_name);
  const hasDob = !!(intake.client.dob || answers.dob);
  return NextResponse.json({
    configured: nctracksEdiConfigured(),
    canCheck: hasName && hasDob,
    snapshot,
    message: coverageMessage(snapshot),
  });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  if (!nctracksEdiConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error: "Automatic NC Tracks eligibility is not connected yet. Enroll as an NC Tracks Trading Partner (see README_NCTRACKS_EDI.md), or enter the details by hand.",
      },
      { status: 400 },
    );
  }
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const answers = await loadAnswers(intake.id);
  const fullName = intake.client.fullName || String(answers.client_full_name || "");
  const dob = intake.client.dob || String(answers.dob || "");
  if (!fullName || !dob) {
    return NextResponse.json(
      { error: "Need at least the client's name and date of birth to check eligibility." },
      { status: 400 },
    );
  }

  try {
    const now = new Date();
    const { result, mapped } = await checkNcTracksEligibility({
      fullName, dob,
      gender: String(answers.gender || ""),
      medicaidId: intake.client.midNumber || String(answers.mid_number || "") || undefined,
      controlNumber: now.getTime() % 1_000_000_000,
      traceNumber: intake.id.replace(/-/g, "").slice(0, 20),
      now,
    });

    // auto-fill packet answers, then persist the coverage snapshot alongside them
    const { next, filled } = applyNcTracksResult(answers, mapped);
    const snapshot = snapshotFrom271(result, now);
    const merged = { ...next, ...snapshotToAnswers(snapshot) };
    await saveAnswers(intake.id, merged);

    await audit(result.rejectReason ? "nctracks_lookup_failed" : "nctracks_lookup_completed", {
      providerId: provider!.id, intakeId: intake.id, userId: user!.id,
      detail: `NC Tracks EDI: ${coverageMessage(snapshot)}`,
    });

    return NextResponse.json({ ok: true, configured: true, snapshot, message: coverageMessage(snapshot), filled });
  } catch (e) {
    console.error("NC Tracks eligibility check failed", e);
    return NextResponse.json(
      { error: "Could not reach NC Tracks right now. Try again in a minute, or enter the details by hand." },
      { status: 502 },
    );
  }
}
