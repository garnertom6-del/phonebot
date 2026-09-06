import { NextRequest, NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { loadPreflightSnapshot, recordPreflightReview } from "@/lib/preflightSnapshot";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import {
  buildRulePreflight,
  aiPreflightConfigured,
  mergePreflightFindings,
  runAiPreflight,
  type PreflightFinding,
} from "@/lib/intakePreflight";
import { missingRequired, missingOptional } from "@/lib/validation";
import { clientCcaAttestationReady } from "@/lib/ccaReview";

export const maxDuration = 90;

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const snapshot = await loadPreflightSnapshot(params.id, provider!.id);
  if (!snapshot) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { intake } = snapshot;

  const answers = applyOperationalDefaults(snapshot.answers);
  const hasClientSignature = intake.signatures.some((signature) => signature.role === "client" || signature.role === "guardian");
  const missingOptions = {
    skipClinicalAssessmentAttestation: !clientCcaAttestationReady(intake.uploadedDocuments[0]?.reviewJson),
  };
  const missing = {
    required: missingRequired(answers, hasClientSignature, provider, missingOptions),
    optional: missingOptional(answers, missingOptions),
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
  const ruleFindings: PreflightFinding[] = buildRulePreflight(input);
  let findings = ruleFindings;
  let aiUsed = false;
  let aiMessage = aiPreflightConfigured()
    ? "AI review completed alongside the automatic checks."
    : "Automatic checks completed. AI review is not configured on the server yet.";
  if (aiPreflightConfigured()) {
    try {
      findings = mergePreflightFindings(ruleFindings, await runAiPreflight(input));
      aiUsed = true;
    } catch (error) {
      aiMessage = error instanceof Error ? `Automatic checks completed; AI review was unavailable: ${error.message}` : "Automatic checks completed; AI review was unavailable.";
    }
  }
  const recorded = await recordPreflightReview(snapshot, provider!.id, user!.id,
    `${findings.length} preflight finding${findings.length === 1 ? "" : "s"}; AI ${aiUsed ? "used" : "not used"}`);
  if (!recorded) return NextResponse.json({
    code: "PREFLIGHT_SOURCE_CHANGED",
    error: "The intake changed while preflight was running. Refresh the intake and run preflight again.",
  }, { status: 409 });
  return NextResponse.json({
    ok: true,
    aiUsed,
    aiConfigured: aiPreflightConfigured(),
    message: aiMessage,
    findings,
    generatedAt: new Date().toISOString(),
  });
}
