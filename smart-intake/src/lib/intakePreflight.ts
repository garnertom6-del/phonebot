import Anthropic from "@anthropic-ai/sdk";
import { questionByKey } from "@/config/mooreDivineQuestions";
import type { Answers } from "./fillPdf";
import type { MissingField } from "./validation";

export type PreflightSeverity = "error" | "warning" | "info";

export type PreflightFinding = {
  severity: PreflightSeverity;
  title: string;
  detail: string;
  fieldKeys?: string[];
  source: "rules" | "ai";
};

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

function missingFinding(fields: MissingField[], severity: PreflightSeverity, title: string): PreflightFinding | null {
  if (!fields.length) return null;
  const labels = fields.slice(0, 5).map((field) => field.label).join(", ");
  const remainder = fields.length > 5 ? ` and ${fields.length - 5} more` : "";
  return {
    severity,
    title,
    detail: `${fields.length} item${fields.length === 1 ? " is" : "s are"} still missing: ${labels}${remainder}.`,
    fieldKeys: fields.map((field) => field.key),
    source: "rules",
  };
}

/** Checks that do not require an AI call and should remain reliable offline. */
export function buildRulePreflight(input: RuleInput): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const required = missingFinding(input.missingRequired, "error", "Required intake items need attention");
  if (required) findings.push(required);

  const optional = missingFinding(input.missingOptional, "warning", "Staff review items are still blank");
  if (optional) findings.push(optional);

  if (!input.hasClientSignature) {
    findings.push({
      severity: "error",
      title: "Client or guardian signature is missing",
      detail: "Do not treat the packet as final until the appropriate client or guardian signature is captured.",
      fieldKeys: ["signature"],
      source: "rules",
    });
  }

  if (input.expectCca && !input.hasCca) {
    findings.push({
      severity: "warning",
      title: "CCA has not been uploaded",
      detail: "Upload the clinician assessment or confirm that this intake does not require a CCA before generating the packet.",
      fieldKeys: ["cca"],
      source: "rules",
    });
  }

  const answerName = clean(input.answers.client_full_name);
  if (answerName && input.client.fullName && answerName.toLowerCase() !== input.client.fullName.toLowerCase()) {
    findings.push({
      severity: "error",
      title: "Client name does not match the intake record",
      detail: `The answer says “${answerName},” while the intake record says “${input.client.fullName}.” Review the identity before generating the packet.`,
      fieldKeys: ["client_full_name"],
      source: "rules",
    });
  }

  const answerDob = clean(input.answers.dob);
  if (answerDob && input.client.dob && answerDob !== input.client.dob) {
    findings.push({
      severity: "error",
      title: "Date of birth does not match the intake record",
      detail: "The DOB in the answers differs from the DOB on the client record. Review the identity fields before proceeding.",
      fieldKeys: ["dob"],
      source: "rules",
    });
  }

  const dateKeys = ["intake_date", "screening_date", "initial_assessment_date", "cca_assessment_date"];
  const dateValues = unique(dateKeys.map((key) => clean(input.answers[key])));
  if (dateValues.length > 1) {
    findings.push({
      severity: "warning",
      title: "Assessment dates should be reviewed",
      detail: "The intake, screening, assessment, or CCA dates are not all the same. Confirm that each date reflects the actual event.",
      fieldKeys: dateKeys.filter((key) => clean(input.answers[key])),
      source: "rules",
    });
  }

  const services = clean(input.answers.services_requested).toLowerCase();
  const otherServices = clean(input.answers.mh_services_desc).toLowerCase();
  if (services && otherServices && services.includes(otherServices)) {
    findings.push({
      severity: "info",
      title: "Current services may duplicate requested services",
      detail: "Confirm whether the client is already receiving one of the services being requested, and document coordination needs if so.",
      fieldKeys: ["services_requested", "mh_services_desc"],
      source: "rules",
    });
  }

  if (!findings.length) {
    findings.push({
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
        label: questionByKey(key)?.label || key,
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
            title: { type: "string" },
            detail: { type: "string" },
            fieldKeys: { type: "array", items: { type: "string" } },
          },
          required: ["severity", "title", "detail", "fieldKeys"],
          additionalProperties: false,
        },
      },
    },
    required: ["findings"],
    additionalProperties: false,
  } as const;
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
      "Return only concerns supported by the supplied data. If a field is not present, say it is missing or leave it to the rule checks. " +
      "Every finding must be a short, actionable suggestion for a human reviewer. Keep each detail under 280 characters.",
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
    const title = clean(item.title).slice(0, 100);
    const detail = clean(item.detail).slice(0, 320);
    if (!severity || !title || !detail) return [];
    const fieldKeys = Array.isArray(item.fieldKeys)
      ? item.fieldKeys.map(String).filter((key) => knownKeys.has(key)).slice(0, 8)
      : [];
    return [{ severity, title, detail, fieldKeys, source: "ai" }];
  });
}
