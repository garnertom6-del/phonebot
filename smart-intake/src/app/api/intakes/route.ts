import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireStaff, attachSelectedProviderCookie } from "@/lib/staffGuard";
import { newIntakeSchema } from "@/lib/validation";
import { missingRequired, percentComplete, clientAskedPercentComplete } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { createStaffIntake } from "@/lib/staffIntakes";
import { autoEmailProviderPacketEnabled, autoSendCompletedCopiesEnabled } from "@/lib/completedCopies";
import { insuranceSummary, recordNumberPrefix, resolveCreateRecordNumber, staffInsurancePlanReady } from "@/lib/insurancePlans";
import { buildDashboardReadiness } from "@/lib/dashboardWorkflow";
import {
  evaluatePacketFreshness,
  packetFreshnessIgnoredAnswerKeys,
} from "@/lib/packetFreshness";
import { buildCompletionReadiness } from "@/lib/completionReadiness";
import { fileExists } from "@/lib/storage";
import { providerPacketReadiness } from "@/lib/providerPacketTemplates";
import { buildSignatureStatuses } from "@/lib/signatureStatus";
import { clientCcaAttestationReady } from "@/lib/ccaReview";

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
    const requestedProviderId = req.nextUrl.searchParams.get("providerId");
    const requestedProviderSlug = req.nextUrl.searchParams.get("providerSlug");
    const { user, provider, membership, deny } = await requireStaff({
      providerId: requestedProviderId,
      providerSlug: requestedProviderSlug,
    });
    if (deny) return deny;
    const providerPacket = await providerPacketReadiness(provider!.id);
    // Lean list query: no signature image blobs, no per-row follow-up queries.
    // Active and archived rows are returned together so every count stays accurate.
    const intakes = await prisma.intake.findMany({
      where: { providerId: provider!.id },
      include: {
        client: true,
        signatures: {
          select: {
            role: true,
            printedName: true,
            signedDate: true,
            relationship: true,
            contentRevision: true,
            subjectNameSnapshot: true,
            subjectDobSnapshot: true,
            invalidatedAt: true,
            invalidatedReason: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        uploadedDocuments: {
          where: { docType: "CCA" },
          orderBy: { createdAt: "desc" },
          select: { id: true, reviewJson: true },
          take: 1,
        },
        generatedPdfs: {
          orderBy: { createdAt: "desc" },
          select: { id: true, filePath: true, createdAt: true, contentRevision: true },
          take: 5,
        },
        auditLogs: {
          where: {
            event: {
              in: [
                "cca_imported",
                "copies_link_sent",
                "provider_packet_email_sent",
                "docusign_completed",
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          select: { event: true, detail: true, createdAt: true },
          take: 25,
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const ids = intakes.map((i) => i.id);
    const [answerRows, signatureAuditRows, linkOpenedGroups, reminderGroups] = await Promise.all([
      prisma.intakeAnswer.findMany({
        where: { intakeId: { in: ids } },
        select: { intakeId: true, key: true, value: true, updatedAt: true },
      }),
      prisma.auditLog.findMany({
        where: { intakeId: { in: ids }, event: "signature_captured" },
        orderBy: { createdAt: "desc" },
        select: { intakeId: true, createdAt: true },
      }),
      prisma.auditLog.groupBy({
        by: ["intakeId"],
        where: { intakeId: { in: ids }, event: "link_opened" },
        _max: { createdAt: true },
      }),
      prisma.auditLog.groupBy({
        by: ["intakeId"],
        where: {
          intakeId: { in: ids },
          event: { in: ["link_reminder_sent", "signature_reminder_sent"] },
          detail: { contains: "sent " },
        },
        _count: { _all: true },
      }),
    ]);
    const answersByIntake = new Map<string, Record<string, unknown>>();
    const latestPacketAnswerAt = new Map<string, Date>();
    const ignoredFreshnessKeys = new Set(packetFreshnessIgnoredAnswerKeys());
    for (const r of answerRows) {
      let bucket = answersByIntake.get(r.intakeId);
      if (!bucket) { bucket = {}; answersByIntake.set(r.intakeId, bucket); }
      try { bucket[r.key] = JSON.parse(r.value); } catch { bucket[r.key] = r.value; }
      if (!ignoredFreshnessKeys.has(r.key)) {
        const current = latestPacketAnswerAt.get(r.intakeId);
        if (!current || r.updatedAt > current) latestPacketAnswerAt.set(r.intakeId, r.updatedAt);
      }
    }
    const latestSignatureAt = new Map<string, Date>();
    for (const row of signatureAuditRows) {
      if (row.intakeId && !latestSignatureAt.has(row.intakeId)) {
        latestSignatureAt.set(row.intakeId, row.createdAt);
      }
    }
    const lastLinkOpenedAt = new Map(
      linkOpenedGroups
        .filter((row): row is typeof row & { intakeId: string } => !!row.intakeId)
        .map((row) => [row.intakeId, row._max.createdAt || null] as const),
    );
    const reminderCountByIntake = new Map(
      reminderGroups
        .filter((row): row is typeof row & { intakeId: string } => !!row.intakeId)
        .map((row) => [row.intakeId, row._count._all] as const),
    );
    const rows = intakes.map((i) => {
      const answers = applyOperationalDefaults(answersByIntake.get(i.id) || {});
      const signatureStatuses = buildSignatureStatuses(i.signatures, {
        client: i.client,
        currentContentRevision: i.contentRevision,
        latestMaterialUpdatedAt: latestPacketAnswerAt.get(i.id),
      });
      const docusignCompletedAt = i.auditLogs.find((a) => a.event === "docusign_completed")?.createdAt;
      const signed = signatureStatuses.some((status) => status.key === "client_guardian" && status.state === "captured")
        || !!(docusignCompletedAt && (!latestPacketAnswerAt.get(i.id) || docusignCompletedAt >= latestPacketAnswerAt.get(i.id)!));
      const hasStaffSignature = signatureStatuses.some((status) => status.key === "staff_qp" && status.state === "captured");
      const ccaLog = i.auditLogs.find((a) => a.event === "cca_imported");
      const copiesLog = i.auditLogs.find((a) => a.event === "copies_link_sent");
      const providerPacketLog = i.auditLogs.find((a) => a.event === "provider_packet_email_sent");
      const hasCca = i.uploadedDocuments.length > 0;
      const required = missingRequired(answers, signed, provider, {
        skipClinicalAssessmentAttestation: !clientCcaAttestationReady(i.uploadedDocuments[0]?.reviewJson),
      });
      const storedPdf = i.generatedPdfs.find((pdf) => fileExists(pdf.filePath)) || null;
      const packet = evaluatePacketFreshness({
        latestPdf: storedPdf,
        latestAnswerUpdatedAt: latestPacketAnswerAt.get(i.id),
        latestSignatureUpdatedAt: latestSignatureAt.get(i.id),
        packetTemplateUpdatedAt: providerPacket.ready && providerPacket.templateUpdatedAt
          ? new Date(providerPacket.templateUpdatedAt)
          : null,
        currentContentRevision: i.contentRevision,
      });
      const completion = buildCompletionReadiness({
        archived: i.archived,
        submittedAt: i.submittedAt,
        missingRequired: required,
        expectCca: i.expectCca,
        hasCca,
        hasStaffSignature,
        providerPacketReady: providerPacket.ready,
        providerPacketMessage: providerPacket.message,
        packetState: packet.state,
      });
      return {
        id: i.id, status: i.status, archived: i.archived, token: i.token, tokenExpiresAt: i.tokenExpiresAt,
        client: i.client, linkSentAt: i.linkSentAt, lastActivityAt: i.lastActivityAt,
        lastLinkOpenedAt: lastLinkOpenedAt.get(i.id) || null,
        reminderCount: reminderCountByIntake.get(i.id) || 0,
        submittedAt: i.submittedAt, createdAt: i.createdAt,
        percentComplete: clientAskedPercentComplete(answers, { quick: true }),
        packetFieldComplete: percentComplete(answers),
        missingRequired: required,
        hasPdf: packet.state !== "missing",
        packetState: packet.state,
        packetGeneratedAt: packet.generatedAt,
        hasCca,
        ccaDetail: ccaLog?.detail || "",
        copiesSentAt: copiesLog?.createdAt || null,
        autoSendCopies: autoSendCompletedCopiesEnabled(answers),
        autoEmailProviderPacket: autoEmailProviderPacketEnabled(answers),
        providerPacketEmailedAt: providerPacketLog?.createdAt || null,
        readiness: buildDashboardReadiness({
          status: i.status,
          missingRequiredCount: required.length,
          packetState: packet.state,
          hasCca,
          expectCca: i.expectCca,
          hasStaffSignature,
          providerPacketReady: providerPacket.ready,
        }),
        completionReady: completion.ready,
        completionBlockers: completion.blockers,
        docusignEnvelopeId: i.docusignEnvelopeId,
        insuranceSummary: insuranceSummary(answers),
        insurancePlanReady: staffInsurancePlanReady(answers),
        presentingProblem: stringValue(answers.presenting_problem) || stringValue(answers.mh_history) || "No main concern recorded yet.",
      };
    });
    const response = NextResponse.json({
      intakes: rows,
      provider: { id: provider!.id, name: provider!.name, slug: provider!.slug },
      providerPacketReadiness: providerPacket,
      isMaster: isMasterUser(user!),
      canManageProvider: isMasterUser(user!) || membership?.role === "PROVIDER_ADMIN",
      readOnly: membership?.role === "REVIEWER",
    });
    return attachSelectedProviderCookie(response, provider!.id);
  } catch (error) {
    console.error("GET /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't load the intake list right now." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    // The Create page sends the provider it was opened for. Scoping the guard to
    // it (instead of only the selected-provider cookie) stops a master admin who
    // switched providers in another tab from saving this client under the wrong
    // agency. requireStaff still checks the user may write to that provider.
    const pageProviderId = typeof raw?.providerId === "string" ? raw.providerId.trim() : "";
    const { user, provider, deny } = await requireStaff({ write: true, providerId: pageProviderId || null });
    if (deny) return deny;
    let recordNumber = typeof raw?.recordNumber === "string" ? raw.recordNumber.trim() : "";
    const resolvedRecord = resolveCreateRecordNumber(recordNumber, raw?.providerChoicePlan || "");
    if (resolvedRecord.error) {
      return NextResponse.json({ error: resolvedRecord.error }, { status: 400 });
    }
    if (resolvedRecord.shouldGenerate) {
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
    } else {
      recordNumber = resolvedRecord.recordNumber;
    }
    if (!recordNumber) {
      return NextResponse.json({
        error: "Couldn't generate a Record#. Enter one in Advanced and try again.",
      }, { status: 400 });
    }
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
    const response = NextResponse.json(await createStaffIntake(parsed.data, user!.id, provider!.id, req));
    // Keep the dashboard on the same provider that received the new intake.
    // Without this, a master user's stale provider cookie can make a correctly
    // saved intake appear to vanish immediately after creation.
    return attachSelectedProviderCookie(response, provider!.id);
  } catch (error) {
    console.error("POST /api/intakes failed", error);
    return NextResponse.json({ error: "Couldn't create the intake link right now." }, { status: 500 });
  }
}
