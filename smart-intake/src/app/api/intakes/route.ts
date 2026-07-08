import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { newIntakeSchema } from "@/lib/validation";
import { newIntakeToken, tokenExpiry } from "@/lib/tokens";
import { audit } from "@/lib/auditLog";
import { loadAnswers, loadSignatures } from "@/lib/intakeData";
import { missingRequired, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

export async function GET() {
  const { deny } = await requireStaff();
  if (deny) return deny;
  const intakes = await prisma.intake.findMany({
    include: { client: true, signatures: true, generatedPdfs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  const rows = await Promise.all(intakes.map(async (i) => {
    const answers = applyOperationalDefaults(await loadAnswers(i.id));
    const sigs = await loadSignatures(i.id);
    return {
      id: i.id, status: i.status, token: i.token, tokenExpiresAt: i.tokenExpiresAt,
      client: i.client, linkSentAt: i.linkSentAt, lastActivityAt: i.lastActivityAt,
      submittedAt: i.submittedAt, createdAt: i.createdAt,
      percentComplete: percentComplete(answers),
      missingRequired: missingRequired(answers, !!(sigs.client || sigs.guardian)),
      hasPdf: i.generatedPdfs.length > 0,
    };
  }));
  return NextResponse.json({ intakes: rows });
}

export async function POST(req: NextRequest) {
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
  const base = appBaseUrl();
  return NextResponse.json({ id: intake.id, clientLink: `${base}/intake/${intake.token}` });
}
