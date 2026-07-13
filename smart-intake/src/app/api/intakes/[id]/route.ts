import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { answersSchema, missingRequired, missingOptional, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { autoSendCompletedCopiesIfEnabled } from "@/lib/sendCompletedCopies";
import { clientUpdateFromAnswers } from "@/lib/clientAnswerSync";
import { buildSignatureStatuses } from "@/lib/signatureStatus";
import { parseCcaReview } from "@/lib/ccaReview";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      provider: { select: { name: true, phone: true } },
      client: true,
      // never ship signature image blobs or server file paths to the browser
      signatures: { select: { role: true, printedName: true, signedDate: true } },
      uploadedDocuments: { select: { id: true, docType: true, fileName: true, createdAt: true, reviewJson: true } },
      generatedPdfs: { orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, sha256: true } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, event: true, detail: true, createdAt: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const signed = intake.signatures.some((s) => s.role === "client" || s.role === "guardian");
  const base = appBaseUrl(_req);
  const uploadedDocuments = intake.uploadedDocuments.map((document) => ({
    id: document.id,
    docType: document.docType,
    fileName: document.fileName,
    createdAt: document.createdAt,
    ccaReview: parseCcaReview(document.reviewJson),
  }));
  return NextResponse.json({
    intake: { ...intake, uploadedDocuments },
    answers,
    clientLink: `${base}/intake/${intake.token}`,
    percentComplete: percentComplete(answers),
    missingRequired: missingRequired(answers, signed),
    missingOptional: missingOptional(answers),
    signatureStatuses: buildSignatureStatuses(intake.signatures),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const body = await req.json();
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (body.answers) {
    // Older intakes may contain JSON nulls for untouched fields. Treat those
    // as blanks while keeping the strict value validation for real answers.
    const answerPayload = typeof body.answers === "object" && body.answers !== null
      ? Object.fromEntries(Object.entries(body.answers).filter(([, value]) => value !== null && value !== undefined))
      : body.answers;
    const parsed = answersSchema.safeParse(answerPayload);
    if (!parsed.success) {
      const fields = parsed.error.issues
        .slice(0, 6)
        .map((issue) => issue.path.join(".") || "answers")
        .join(", ");
      return NextResponse.json({ error: `Some answers could not be saved. Review: ${fields}.` }, { status: 400 });
    }
    const answers = applyOperationalDefaults(parsed.data);
    await saveAnswers(intake.id, answers);
    await syncStructuredRows(intake.id, await loadAnswers(intake.id));
    await prisma.client.update({
      where: { id: intake.clientId },
      data: clientUpdateFromAnswers(intake.client, answers),
    });
    await audit("answers_updated", { providerId: provider!.id, intakeId: intake.id, userId: user!.id, detail: "staff edit" });
    await audit("staff_reviewed", { providerId: provider!.id, intakeId: intake.id, userId: user!.id });
  }
  if (body.status) {
    const allowed = ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"];
    if (!allowed.includes(body.status)) return NextResponse.json({ error: "Bad status" }, { status: 400 });
    await prisma.intake.update({ where: { id: intake.id }, data: { status: body.status } });
    if (body.status === "COMPLETED") {
      try {
        await autoSendCompletedCopiesIfEnabled({
          intakeId: intake.id,
          providerId: provider!.id,
          userId: user!.id,
          req,
        });
      } catch (e) {
        console.error("auto-send completed copies failed", e);
      }
    }
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
