import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { newIntakeSchema } from "@/lib/validation";
import { newIntakeToken, tokenExpiry, tokenExpiryDays } from "@/lib/tokens";
import { audit } from "@/lib/auditLog";
import { missingRequired, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

export async function GET(req: NextRequest) {
  try {
    const { deny } = await requireStaff();
    if (deny) return deny;
    const showArchived = new URL(req.url).searchParams.get("archived") === "1";
    // Lean list query: no signature image blobs, no per-row follow-up queries.
    // Everything the dashboard needs comes back in four batched queries total.
    const intakes = await prisma.intake.findMany({
      where: { archived: showArchived },
      include: {
        client: true,
        signatures: { select: { role: true } },
        uploadedDocuments: { where: { docType: "CCA" }, select: { id: true }, take: 1 },
        generatedPdfs: { select: { id: true }, take: 1 },
        auditLogs: { where: { event: "cca_imported" }, orderBy: { createdAt: "desc" }, select: { detail: true }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });
    const ids = intakes.map((i) => i.id);
    const answerRows = await prisma.intakeAnswer.findMany({
      where: { intakeId: { in: ids } }, select: { intakeId: true, key: true, value: true },
    });
    const answersByIntake = new Map<string, Record<string, unknown>>();
    for (const r of answerRows) {
      let bucket = answersByIntake.get(r.intakeId);
      if (!bucket) { bucket = {}; answersByIntake.set(r.intakeId, bucket); }
      try { bucket[r.key] = JSON.parse(r.value); } catch { bucket[r.key] = r.value; }
    }
    const rows = intakes.map((i) => {
      const answers = applyOperationalDefaults(answersByIntake.get(i.id) || {});
      const signed = i.signatures.some((s) => s.role === "client" || s.role === "guardian");
      return {
        id: i.id, status: i.status, archived: i.archived, token: i.token, tokenExpiresAt: i.tokenExpiresAt,
        client: i.client, linkSentAt: i.linkSentAt, lastActivityAt: i.lastActivityAt,
        submittedAt: i.submittedAt, createdAt: i.createdAt,
        percentComplete: percentComplete(answers),
        missingRequired: missingRequired(answers, signed),
        hasPdf: i.generatedPdfs.length > 0,
        hasCca: i.uploadedDocuments.length > 0,
        ccaDetail: i.auditLogs[0]?.detail || "",
      };
    });
    return NextResponse.json({ intakes: rows });
  } catch (error) {
    console.error("GET /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't load the intake list right now." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, deny } = await requireStaff();
    if (deny) return deny;
    const parsed = newIntakeSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }
    const d = parsed.data;
    const client = await prisma.client.create({
      data: {
        fullName: d.fullName, dob: d.dob, midNumber: d.midNumber, recordNumber: d.recordNumber,
        email: d.email || null, phone: d.phone || null, guardianName: d.guardianName || null,
        guardianEmail: d.guardianEmail || null, guardianPhone: d.guardianPhone || null,
      },
    });
    const body = parsed.data as typeof parsed.data & { expectCca?: boolean };
    const intake = await prisma.intake.create({
      data: {
        clientId: client.id, token: newIntakeToken(), tokenExpiresAt: tokenExpiry(),
        expectCca: body.expectCca !== false,
        intakeDate: d.intakeDate || new Date().toLocaleDateString("en-US"),
        location: d.location || "Greensboro",
      },
    });
    // Prefill answers from the staff-entered basics so the client doesn't retype them.
    const prefill: Record<string, unknown> = applyOperationalDefaults({
      client_full_name: d.fullName, dob: d.dob, mid_number: d.midNumber,
      record_number: d.recordNumber, intake_date: intake.intakeDate, location: intake.location,
      client_email: d.email, client_phone_cell: d.phone,
      guardian_name: d.guardianName, guardian_email: d.guardianEmail, guardian_phone: d.guardianPhone,
      is_minor_or_incompetent: d.guardianName ? "Yes" : undefined,
    });
    const entries = Object.entries(prefill).filter(([, v]) => v !== undefined && v !== "");
    await prisma.$transaction(entries.map(([key, v]) =>
      prisma.intakeAnswer.create({ data: { intakeId: intake.id, key, value: JSON.stringify(v) } })));
    await audit("intake_created", { intakeId: intake.id, userId: user!.id, detail: d.fullName });
    const base = appBaseUrl(req);
    return NextResponse.json({ id: intake.id, clientLink: `${base}/intake/${intake.token}`, linkDays: tokenExpiryDays() });
  } catch (error) {
    console.error("POST /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't create the intake link right now." }, { status: 500 });
  }
}
