import Anthropic from "@anthropic-ai/sdk";
import { questionByKey } from "@/config/mooreDivineQuestions";
import { replaceRawFieldKeys, staffFacingFieldLabel, textContainsRawFieldKey } from "@/lib/staffFieldLabels";
import type { Answers } from "./fillPdf";
import type { MissingField } from "./validation";
import { normalizeDateInput } from "./normalizeDateInput";
import { normalizeDate, normalizeIdentityName } from "./recordIntegrity";

export type PreflightSeverity = "error" | "warning" | "info";

export type PreflightCorrectionUpdate = {
  key: string;
  fieldLabel: string;
  sourceKey: string;
  sourceLabel: string;
  expectedCurrent: string;
  proposedValue: string;
};

export type PreflightCorrectionOption = {
  id: string;
  label: string;
  detail: string;
  updates: PreflightCorrectionUpdate[];
};

export type PreflightFinding = {
  key: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
  fieldKeys?: string[];
  fieldLabels?: string[];
  source: "rules" | "ai";
  correctionOptions?: PreflightCorrectionOption[];
};

const authoritativeRuleKeys = new Set(["identity_name", "identity_dob", "assessment_dates", "active_services"]);

type IntakeIdentity = { fullName: string; dob: string };

type RuleInput = {
  answers: Answers;
  client: IntakeIdentity;
  missingRequired: MissingField[];
  missingOptional: MissingField[];
  hasClientSignature: boolean;
  hasCca: boolean;
  expectCca: boolean;
};

function clean(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ").trim();
  return String(value).trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function fieldLabel(key: string): string {
  return staffFacingFieldLabel(key);
}

function correctionUpdate(
  input: Pick<RuleInput, "answers" | "client">,
  key: string,
  sourceKey: string,
): PreflightCorrectionUpdate | null {
  const expectedCurrent = clean(input.answers[key]);
  let proposedValue = "";
  let sourceLabel = "";
  if (sourceKey === "@client.fullName") {
    proposedValue = clean(input.client.fullName);
    sourceLabel = "intake record name";
  } else if (sourceKey === "@client.dob") {
    proposedValue = clean(input.client.dob);
    sourceLabel = "intake record date of birth";
  } else if (sourceKey === "@clear") {
    sourceLabel = "clear this field";
  } else {
    proposedValue = clean(input.answers[sourceKey]);
    sourceLabel = fieldLabel(sourceKey);
  }
  if (proposedValue === expectedCurrent || (sourceKey !== "@clear" && !proposedValue)) return null;
  return {
    key,
    fieldLabel: fieldLabel(key),
    sourceKey,
    sourceLabel,
    expectedCurrent,
    proposedValue,
  };
}

function correctionOption(
  input: Pick<RuleInput, "answers" | "client">,
  id: string,
  label: string,
  detail: string,
  updates: Array<{ key: string; sourceKey: string }>,
): PreflightCorrectionOption | null {
  const resolved = updates
    .map((update) => correctionUpdate(input, update.key, update.sourceKey))
    .filter((update): update is PreflightCorrectionUpdate => !!update);
  return resolved.length ? { id, label, detail, updates: resolved } : null;
}

function missingFinding(key: string, fields: MissingField[], severity: PreflightSeverity, title: string): PreflightFinding | null {
  if (!fields.length) return null;
  const fieldLabels = fields.map((field) => {
    const raw = String(field.label || "").trim();
    return !raw || textContainsRawFieldKey(raw) ? staffFacingFieldLabel(field.key) : raw;
  });
  const labels = fieldLabels.slice(0, 5).join(", ");
  const remainder = fields.length > 5 ? ` and ${fields.length - 5} more` : "";
  return {
    key,
    severity,
    title,
    detail: replaceRawFieldKeys(`${fields.length} item${fields.length === 1 ? " is" : "s are"} still missing: ${labels}${remainder}.`),
    fieldKeys: fields.map((field) => field.key),
    fieldLabels,
    source: "rules",
  };
}

/** Checks that do not require an AI call and should remain reliable offline. */
export function buildRulePreflight(input: RuleInput): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const required = missingFinding("required_items", input.missingRequired, "error", "Required intake items need attention");
  if (required) findings.push(required);

  const optional = missingFinding("staff_review_items", input.missingOptional, "warning", "Staff review items are still blank");
  if (optional) findings.push(optional);

  if (!input.hasClientSignature) {
    findings.push({
      key: "client_signature",
      severity: "error",
      title: "Client or guardian signature is missing",
      detail: "Do not treat the packet as final until the appropriate client or guardian signature is captured.",
      fieldKeys: ["signature"],
      source: "rules",
    });
  }

  if (input.expectCca && !input.hasCca) {
    findings.push({
      key: "cca_upload",
      severity: "warning",
      title: "CCA has not been uploaded",
      detail: "Upload the clinician assessment or confirm that this intake does not require a CCA before generating the packet.",
      fieldKeys: ["cca"],
      source: "rules",
    });
  }

  const answerName = clean(input.answers.client_full_name);
  // Compare like the readiness gate does: ignore case and a "(preferred)" suffix,
  // so the exact legal-name(preferred) shape the CCA extractor produces does not
  // raise a spurious identity error that pushes staff to a signature-invalidating fix.
  if (answerName && input.client.fullName && normalizeIdentityName(answerName) !== normalizeIdentityName(input.client.fullName)) {
    const useRecordName = correctionOption(
      input,
      "use_intake_record_name",
      `Use intake record name: ${input.client.fullName}`,
      "Replace the packet answer with the name already stored on the intake record. Confirm the record is correct before applying.",
      [{ key: "client_full_name", sourceKey: "@client.fullName" }],
    );
    findings.push({
      key: "identity_name",
      severity: "error",
      title: "Client name does not match the intake record",
      detail: `The answer says “${answerName},” while the intake record says “${input.client.fullName}.” Review the identity before generating the packet.`,
      fieldKeys: ["client_full_name"],
      source: "rules",
      correctionOptions: useRecordName ? [useRecordName] : [],
    });
  }

  const answerDob = clean(input.answers.dob);
  // Same calendar day in two formats (2026-10-21 vs 10/21/2026) is not a mismatch.
  if (answerDob && input.client.dob && normalizeDate(answerDob) !== normalizeDate(input.client.dob)) {
    const useRecordDob = correctionOption(
      input,
      "use_intake_record_dob",
      `Use intake record DOB: ${input.client.dob}`,
      "Replace the packet answer with the date of birth already stored on the intake record. Confirm the record is correct before applying.",
      [{ key: "dob", sourceKey: "@client.dob" }],
    );
    findings.push({
      key: "identity_dob",
      severity: "error",
      title: "Date of birth does not match the intake record",
      detail: "The DOB in the answers differs from the DOB on the client record. Review the identity fields before proceeding.",
      fieldKeys: ["dob"],
      source: "rules",
      correctionOptions: useRecordDob ? [useRecordDob] : [],
    });
  }

  const dateKeys = ["intake_date", "screening_date", "initial_assessment_date", "cca_assessment_date"];
  // compare calendar dates, not spellings: 2026-10-21 and 10/21/2026 are the same day
  const dateValues = unique(dateKeys.map((key) => {
    const raw = clean(input.answers[key]);
    return raw ? (normalizeDateInput(raw) || raw) : "";
  }));
  if (dateValues.length > 1) {
    const intakeDate = clean(input.answers.intake_date);
    const alignIntakeDates = intakeDate
      ? correctionOption(
        input,
        "align_screening_and_initial_assessment_to_intake",
        `Use intake date (${intakeDate}) for screening and initial assessment`,
        "Apply only when screening and the initial assessment actually occurred on the intake date. The CCA assessment date remains unchanged.",
        [
          { key: "screening_date", sourceKey: "intake_date" },
          { key: "initial_assessment_date", sourceKey: "intake_date" },
        ],
      )
      : null;
    findings.push({
      key: "assessment_dates",
      severity: "warning",
      title: "Assessment dates should be reviewed",
      detail: "The intake, screening, assessment, or CCA dates are not all the same. Confirm that each date reflects the actual event.",
      fieldKeys: dateKeys.filter((key) => clean(input.answers[key])),
      source: "rules",
      correctionOptions: alignIntakeDates ? [alignIntakeDates] : [],
    });
  }

  const services = clean(input.answers.services_requested).toLowerCase();
  const otherServices = clean(input.answers.mh_services_desc).toLowerCase();
  if (services && otherServices && services.includes(otherServices)) {
    findings.push({
      key: "service_overlap",
      severity: "info",
      title: "Current services may duplicate requested services",
      detail: "Confirm whether the client is already receiving one of the services being requested, and document coordination needs if so.",
      fieldKeys: ["services_requested", "mh_services_desc"],
      source: "rules",
    });
  }

  if (!findings.length) {
    findings.push({
      key: "basic_checks_clear",
      severity: "info",
      title: "Basic preflight checks passed",
      detail: "No missing required items or identity conflicts were found by the automatic checks. Complete the clinical and signature review before generating.",
      source: "rules",
    });
  }
  return findings;
}

export function aiPreflightConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function answerSnapshot(answers: Answers): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(answers)
      .filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0))
      .map(([key, value]) => [key, {
        label: staffFacingFieldLabel(key),
        value: clean(value).slice(0, 300),
      }]),
  ));
}

function aiSchema() {
  return {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["error", "warning", "info"] },
            key: { type: "string" },
            title: { type: "string" },
            detail: { type: "string" },
            fieldKeys: { type: "array", items: { type: "string" } },
            correctionOptions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  detail: { type: "string" },
                  updates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        sourceKey: { type: "string" },
                      },
                      required: ["key", "sourceKey"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["id", "label", "detail", "updates"],
                additionalProperties: false,
              },
            },
          },
          required: ["severity", "key", "title", "detail", "fieldKeys", "correctionOptions"],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  } as const;
}

function correctionTargetAllowed(key: string, answers: Answers): boolean {
  if (!key || (!questionByKey(key) && !(key in answers))) return false;
  return !(
    /^consent_/i.test(key)
    || /_agreed$/i.test(key)
    || /signature|(^|_)sig($|_)/i.test(key)
  );
}

export function groundedCorrectionOptionsFromAi(
  rawOptions: unknown,
  input: Pick<RuleInput, "answers" | "client">,
): PreflightCorrectionOption[] {
  if (!Array.isArray(rawOptions)) return [];
  const options: PreflightCorrectionOption[] = [];
  for (const raw of rawOptions.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = clean(item.id).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);
    const label = clean(item.label).slice(0, 140);
    const detail = clean(item.detail).slice(0, 280);
    if (!id || !label || !detail || !Array.isArray(item.updates) || !item.updates.length) continue;
    const updateSpecs: Array<{ key: string; sourceKey: string }> = [];
    const targetKeys = new Set<string>();
    let invalid = false;
    for (const rawUpdate of item.updates.slice(0, 8)) {
      if (!rawUpdate || typeof rawUpdate !== "object") {
        invalid = true;
        break;
      }
      const update = rawUpdate as Record<string, unknown>;
      const key = clean(update.key);
      const sourceKey = clean(update.sourceKey);
      const specialSource = sourceKey === "@client.fullName" || sourceKey === "@client.dob" || sourceKey === "@clear";
      if (
        !correctionTargetAllowed(key, input.answers)
        || targetKeys.has(key)
        || (!specialSource && (!(sourceKey in input.answers) || !clean(input.answers[sourceKey])))
      ) {
        invalid = true;
        break;
      }
      targetKeys.add(key);
      updateSpecs.push({ key, sourceKey });
    }
    if (invalid) continue;
    const option = correctionOption(input, id, label, detail, updateSpecs);
    if (option) options.push(option);
  }
  return options;
}

export function mergePreflightFindings(
  ruleFindings: PreflightFinding[],
  aiFindings: PreflightFinding[],
): PreflightFinding[] {
  const authoritativeFields = new Set(
    ruleFindings
      .filter((finding) => authoritativeRuleKeys.has(finding.key))
      .flatMap((finding) => finding.fieldKeys || []),
  );
  return [
    ...ruleFindings,
    ...aiFindings.filter((finding) => !(finding.fieldKeys || []).some((key) => authoritativeFields.has(key))),
  ];
}

export async function runAiPreflight(input: RuleInput): Promise<PreflightFinding[]> {
  if (!aiPreflightConfigured()) return [];
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 5000,
    system:
      "You are a behavioral-health intake documentation quality reviewer. " +
      "Review only for documentation completeness, identity/date conflicts, duplicate or contradictory service information, and items staff should verify. " +
      "You are not a clinician and must not diagnose, determine eligibility, recommend a level of care, create an answer, or say that a packet is legally or clinically compliant. " +
      "Do not flag transition/discharge fields (dis_*), future treatment-plan signature rows (otp_*), or other information that is only completed when a client leaves the program. " +
      "Return only concerns supported by the supplied data. If a field is not present, say it is missing or leave it to the rule checks. " +
      "Give each concern a short stable key using lowercase letters and underscores so staff can override that exact concern. " +
      "Every finding must be a short, actionable suggestion for a human reviewer. Keep each detail under 280 characters. " +
      "For correctionOptions, suggest only changes that copy or move an exact value already present in another answer, copy @client.fullName or @client.dob, or clear a field with @clear. " +
      "Each update must contain the target key and one sourceKey. Never type a proposed value yourself. Never invent, infer, calculate, reformat, or supply a new diagnosis, date, contact, height, weight, treatment, provider, or clinical fact. " +
      "Use an empty correctionOptions array when no grounded correction is possible. Staff must explicitly choose and apply every option.",
    messages: [{
      role: "user",
      content:
        "Review this intake before staff generates the packet. Existing rule findings are included for context; do not repeat them unless you add a useful detail. " +
        "Return JSON only.\n\n" +
        JSON.stringify({
          clientRecord: input.client,
          expectCca: input.expectCca,
          hasCca: input.hasCca,
          hasClientSignature: input.hasClientSignature,
          missingRequired: input.missingRequired.map((field) => ({ key: field.key, label: field.label })),
          missingOptional: input.missingOptional.slice(0, 30).map((field) => ({ key: field.key, label: field.label })),
          answers: JSON.parse(answerSnapshot(input.answers)),
        }),
    }],
    output_config: { format: { type: "json_schema", schema: aiSchema() } },
  });

  if (response.stop_reason === "refusal") throw new Error("The AI preflight review was not completed.");
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("No AI preflight result returned.");
  const parsed = JSON.parse(text.text) as { findings?: Array<Record<string, unknown>> };
  const knownKeys = new Set(Object.keys(input.answers));
  return (parsed.findings || []).slice(0, 12).flatMap((item): PreflightFinding[] => {
    const severity = item.severity === "error" || item.severity === "warning" || item.severity === "info"
      ? item.severity : null;
    const rawKey = clean(item.key).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70);
    const title = clean(item.title).slice(0, 100);
    const detail = clean(item.detail).slice(0, 320);
    if (!severity || !rawKey || !title || !detail) return [];
    const fieldKeys = Array.isArray(item.fieldKeys)
      ? item.fieldKeys.map(String).filter((key) => knownKeys.has(key)).slice(0, 8)
      : [];
    const correctionOptions = groundedCorrectionOptionsFromAi(item.correctionOptions, input);
    return [{
      key: `ai_${rawKey}`,
      severity,
      title: replaceRawFieldKeys(title),
      detail: replaceRawFieldKeys(detail),
      fieldKeys,
      fieldLabels: fieldKeys.map(staffFacingFieldLabel),
      source: "ai",
      correctionOptions,
    }];
  });
}
