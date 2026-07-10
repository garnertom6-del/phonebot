import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { answersSchema, missingRequired, missingOptional, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      // never ship signature image blobs or server file paths to the browser
      signatures: { select: { role: true, printedName: true, signedDate: true } },
      uploadedDocuments: { select: { id: true, docType: true, fileName: true, createdAt: true } },
      generatedPdfs: { orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, sha256: true } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, event: true, detail: true, createdAt: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const signed = intake.signatures.some((s) => s.role === "client" || s.role === "guardian");
  const base = appBaseUrl(_req);
  return NextResponse.json({
    intake,
    answers,
    clientLink: `${base}/intake/${intake.token}`,
    percentComplete: percentComplete(answers),
    missingRequired: missingRequired(answers, signed),
    missingOptional: missingOptional(answers),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const body = await req.json();
  const intake = await prisma.intake.findUnique({ where: { id: params.id } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (body.answers) {
    const parsed = answersSchema.safeParse(body.answers);
    if (!parsed.success) return NextResponse.json({ error: "Invalid answers" }, { status: 400 });
    const answers = applyOperationalDefaults(parsed.data);
    await saveAnswers(intake.id, answers);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
    await audit("answers_updated", { intakeId: intake.id, userId: user!.id, detail: "staff edit" });
    await audit("staff_reviewed", { intakeId: intake.id, userId: user!.id });
  }
  if (body.status) {
    const allowed = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"];
    if (!allowed.includes(body.status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
    await prisma.intake.update({ where: { id: intake.id }, data: { status: body.status } });
  }
  if (body.extendToken) {
    const days = parseInt(process.env.CLIENT_LINK_EXPIRY_DAYS || "7", 10);
    await prisma.intake.update({
      where: { id: intake.id },
      data: { tokenExpiresAt: new Date(Date.now() + days * 86400000) },
    });
  }
  if (body.archive !== undefined) {
    // real archiving: hide from the dashboard list without changing status
    await prisma.intake.update({ where: { id: intake.id }, data: { archived: !!body.archive } });
  }
  return NextResponse.json({ ok: true });
}
