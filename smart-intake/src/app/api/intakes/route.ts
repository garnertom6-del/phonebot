import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireStaff } from "@/lib/staffGuard";
import { newIntakeSchema } from "@/lib/validation";
import { missingRequired, percentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { createStaffIntake } from "@/lib/staffIntakes";
import { autoSendCompletedCopiesEnabled } from "@/lib/completedCopies";
import { insuranceSummary } from "@/lib/insurancePlans";
import { recordNumberPrefix } from "@/lib/insurancePlans";

function generatedRecordNumber(panel?: string): string {
  const prefix = recordNumberPrefix(panel || "") || "TEMP";
  return `${prefix}-${randomInt(10000, 100000)}`;
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(", ");
  return String(value).trim();
}

export async function GET(req: NextRequest) {
  try {
    const { user, provider, deny } = await requireStaff();
    if (deny) return deny;
    const showArchived = new URL(req.url).searchParams.get("archived") === "1";
    // Lean list query: no signature image blobs, no per-row follow-up queries.
    // Everything the dashboard needs comes back in four batched queries total.
    const intakes = await prisma.intake.findMany({
      where: { archived: showArchived, providerId: provider!.id },
      include: {
        client: true,
        signatures: { select: { role: true } },
        uploadedDocuments: { where: { docType: "CCA" }, select: { id: true }, take: 1 },
        generatedPdfs: { select: { id: true }, take: 1 },
        auditLogs: {
          where: { event: { in: ["cca_imported", "copies_link_sent"] } },
          orderBy: { createdAt: "desc" },
          select: { event: true, detail: true, createdAt: true },
          take: 10,
        },
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
      const ccaLog = i.auditLogs.find((a) => a.event === "cca_imported");
      const copiesLog = i.auditLogs.find((a) => a.event === "copies_link_sent");
      return {
        id: i.id, status: i.status, archived: i.archived, token: i.token, tokenExpiresAt: i.tokenExpiresAt,
        client: i.client, linkSentAt: i.linkSentAt, lastActivityAt: i.lastActivityAt,
        submittedAt: i.submittedAt, createdAt: i.createdAt,
        percentComplete: percentComplete(answers),
        missingRequired: missingRequired(answers, signed),
        hasPdf: i.generatedPdfs.length > 0,
        hasCca: i.uploadedDocuments.length > 0,
        ccaDetail: ccaLog?.detail || "",
        copiesSentAt: copiesLog?.createdAt || null,
        autoSendCopies: autoSendCompletedCopiesEnabled(answers),
        docusignEnvelopeId: i.docusignEnvelopeId,
        insuranceSummary: insuranceSummary(answers),
        presentingProblem: stringValue(answers.presenting_problem) || stringValue(answers.mh_history) || "No main concern recorded yet.",
      };
    });
    return NextResponse.json({
      intakes: rows,
      provider: { id: provider!.id, name: provider!.name, slug: provider!.slug },
      isMaster: isMasterUser(user!),
    });
  } catch (error) {
    console.error("GET /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't load the intake list right now." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, provider, deny } = await requireStaff();
    if (deny) return deny;
    const raw = await req.json();
    let recordNumber = typeof raw?.recordNumber === "string" ? raw.recordNumber.trim() : "";
    if (!recordNumber) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = generatedRecordNumber(raw?.providerChoicePlan);
        const used = await prisma.client.findFirst({
          where: { providerId: provider!.id, recordNumber: candidate },
          select: { id: true },
        });
        if (!used) {
          recordNumber = candidate;
          break;
        }
      }
    }
    if (!recordNumber) return NextResponse.json({ error: "Could not generate a unique Record#" }, { status: 409 });
    const parsed = newIntakeSchema.safeParse({
      ...raw,
      recordNumber,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }
    const existing = await prisma.client.findFirst({
      where: { providerId: provider!.id, recordNumber: parsed.data.recordNumber },
      select: { fullName: true },
    });
    if (existing) {
      return NextResponse.json({ error: `Record# ${parsed.data.recordNumber} already belongs to ${existing.fullName}` }, { status: 409 });
    }
    return NextResponse.json(await createStaffIntake(parsed.data, user!.id, provider!.id, req));
  } catch (error) {
    console.error("POST /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't create the intake link right now." }, { status: 500 });
  }
}
