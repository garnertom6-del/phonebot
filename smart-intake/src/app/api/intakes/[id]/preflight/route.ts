import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { buildRulePreflight, aiPreflightConfigured, runAiPreflight, type PreflightFinding } from "@/lib/intakePreflight";
import { missingRequired, missingOptional } from "@/lib/validation";

export const maxDuration = 90;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      client: { select: { fullName: true, dob: true } },
      signatures: { select: { role: true } },
      uploadedDocuments: { select: { docType: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const answers = applyOperationalDefaults(await loadAnswers(intake.id));
  const hasClientSignature = intake.signatures.some((signature) => signature.role === "client" || signature.role === "guardian");
  const missing = {
    required: missingRequired(answers, hasClientSignature),
    optional: missingOptional(answers),
  };
  const input = {
    answers,
    client: intake.client,
    missingRequired: missing.required,
    missingOptional: missing.optional,
    hasClientSignature,
    hasCca: intake.uploadedDocuments.some((document) => document.docType.toUpperCase() === "CCA"),
    expectCca: intake.expectCca,
  };
  const findings: PreflightFinding[] = buildRulePreflight(input);
  let aiUsed = false;
  let aiMessage = aiPreflightConfigured()
    ? "AI review completed alongside the automatic checks."
    : "Automatic checks completed. AI review is not configured on the server yet.";
  if (aiPreflightConfigured()) {
    try {
      findings.push(...await runAiPreflight(input));
      aiUsed = true;
    } catch (error) {
      aiMessage = error instanceof Error ? `Automatic checks completed; AI review was unavailable: ${error.message}` : "Automatic checks completed; AI review was unavailable.";
    }
  }
  await audit("preflight_reviewed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: `${findings.length} preflight finding${findings.length === 1 ? "" : "s"}; AI ${aiUsed ? "used" : "not used"}`,
  });
  return NextResponse.json({
    ok: true,
    aiUsed,
    aiConfigured: aiPreflightConfigured(),
    message: aiMessage,
    findings,
    generatedAt: new Date().toISOString(),
  });
}
