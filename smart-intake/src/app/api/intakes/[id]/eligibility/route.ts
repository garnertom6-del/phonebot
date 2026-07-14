import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers } from "@/lib/intakeData";
import { applyNcTracksResult } from "@/lib/ncTracksLookup";
import { checkNcTracksEligibility, nctracksEdiConfigured } from "@/lib/nctracksEdi";

/**
 * Direct NC Tracks eligibility check for one intake (Trading Partner / EDI).
 * Runs a 270, parses the 271, auto-fills Medicaid/plan answers, and reports
 * the coverage result. Dormant until NCTRACKS_EDI_* is configured.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  if (!nctracksEdiConfigured()) {
    return NextResponse.json(
      { error: "Automatic NC Tracks eligibility is not connected yet. Enroll as an NC Tracks Trading Partner, or enter details by hand." },
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
    return NextResponse.json({ error: "Need at least the client's name and date of birth to check eligibility." }, { status: 400 });
  }

  try {
    const now = new Date();
    const { result, mapped } = await checkNcTracksEligibility({
      fullName, dob,
      gender: String(answers.gender || ""),
      medicaidId: intake.client.midNumber || String(answers.mid_number || "") || undefined,
      // unique-per-check identifiers (no Date.now import needed for uniqueness: intake + ms)
      controlNumber: (now.getTime() % 1_000_000_000),
      traceNumber: `${intake.id.replace(/-/g, "").slice(0, 20)}`,
      now,
    });

    const { next, filled } = applyNcTracksResult(answers, mapped);
    if (filled.length) await saveAnswers(intake.id, next);

    await audit(result.rejectReason ? "nctracks_lookup_failed" : "nctracks_lookup_completed", {
      providerId: provider!.id, intakeId: intake.id, userId: user!.id,
      detail: result.rejectReason
        ? `NC Tracks: ${result.rejectReason}`
        : `NC Tracks: ${result.active ? "active" : "inactive"}${result.planName ? ` - ${result.planName}` : ""}`,
    });

    return NextResponse.json({
      ok: true,
      active: result.active,
      planName: result.planName || null,
      memberId: result.memberId || null,
      effectiveDate: result.effectiveDate || null,
      rejectReason: result.rejectReason || null,
      filled,
    });
  } catch (e) {
    console.error("NC Tracks eligibility check failed", e);
    return NextResponse.json(
      { error: "Could not reach NC Tracks right now. Try again in a minute, or enter details by hand." },
      { status: 502 },
    );
  }
}
