/**
 * Reads a completed Comprehensive Clinical Assessment (CCA) document (PDF or
 * photo) with Claude and maps its contents onto the intake packet's answer
 * keys — so one upload auto-fills the majority of the Client Intake Package
 * and the client never has to re-answer what the clinician already collected.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SECTIONS, STAFF_FIELDS, type Question } from "@/config/mooreDivineQuestions";
import type { Answers } from "./fillPdf";

export function ccaConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Keys the CCA is allowed to fill. Consents, signatures, surveys and intake
 *  logistics are excluded — those must come from the client or staff. */
function extractableQuestions(): Question[] {
  // mood_check (PHQ-9/GAD-7) is a client self-report - never filled from a CCA
  const skipSections = new Set(["welcome", "survey", "referrals", "mood_check"]);
  const out: Question[] = [];
  for (const s of SECTIONS) {
    if (skipSections.has(s.key)) continue;
    for (const q of s.questions) {
      if (q.type === "consent" || q.type === "info" || q.type === "heading") continue;
      if (q.key.startsWith("roi") || q.key.startsWith("consent_")) continue;
      if (q.key === "hipaa_understood" || q.key === "hipaa_copy" || q.key === "welcome_letter_ack") continue;
      out.push(q);
    }
  }
  for (const g of STAFF_FIELDS) {
    // clinical fields (SNAP, severity, diagnoses, evals) + the CCA-details group
    if (g.group.startsWith("Clinical")) out.push(...g.fields);
  }
  return out;
}

function buildSchema(questions: Question[]) {
  return {
    type: "object",
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: questions.map((q) => q.key) },
            value: {
              anyOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
            },
          },
          required: ["key", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["answers"],
    additionalProperties: false,
  } as const;
}

function fieldGuide(questions: Question[]): string {
  return questions
    .map((q) => `- ${q.key}: ${q.label}${q.options ? ` [one of: ${q.options.join(" | ")}]` : ""}`)
    .join("\n");
}

export interface CcaExtractionResult {
  extracted: Answers;
  fieldCount: number;
}

/** Match a model-produced value to the question's fixed options, tolerating
 *  case differences and common phrasings, instead of silently dropping it. */
function matchOption(text: string, options: string[]): string | undefined {
  if (options.includes(text)) return text;
  const lc = text.toLowerCase().trim();
  const ci = options.find((o) => o.toLowerCase() === lc);
  if (ci) return ci;
  const ALIASES: Record<string, string> = {
    "some college": "College", "college degree": "College",
    "high school": "High School/GED", "ged": "High School/GED",
    "elementary": "Grade/Elementary", "graduate school": "Graduate",
    "not employed": "Unemployed", "united healthcare": "United Health Care",
    "partners": "Partners Behavioral Health", "trillium": "Sandhills Center/Trillium",
  };
  const alias = ALIASES[lc];
  if (alias && options.includes(alias)) return alias;
  // last resort: an option contained in the value or vice versa ("Some college" ~ "College")
  return options.find((o) => lc.includes(o.toLowerCase()) || o.toLowerCase().includes(lc));
}

function normalizeValue(q: Question, value: unknown): Answers[string] | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (q.type === "chips") {
    const values = Array.isArray(value)
      ? value
      : String(value).split(/[,;|]/);
    const clean = values.map((v) => String(v).trim()).filter(Boolean);
    if (!clean.length) return undefined;
    if (!q.options) return clean;
    const matched = clean
      .map((v) => matchOption(v, q.options!))
      .filter((v): v is string => !!v);
    return [...new Set(matched)];
  }
  if (Array.isArray(value)) {
    value = value.map((v) => String(v).trim()).filter(Boolean).join(", ");
  }
  const text = String(value).trim();
  if (!text) return undefined;
  if ((q.type === "radio" || q.type === "yesno") && q.options) {
    return matchOption(text, q.options);
  }
  return text;
}

/** If the CCA filled a child answer, set the parent that reveals it in the
 *  staff review screen (which hides children whose gate is unanswered). */
function setGatingParents(extracted: Answers) {
  const gates: [string, string, string][] = [
    // [child prefix or key, parent key, parent value]
    ["sub1_name", "sa_status", "Yes"],
    ["diagnosis_list", "has_current_diagnosis", "Yes"],
    ["therapist_name", "has_current_therapist", "Yes"],
    ["mh_services_desc", "receiving_mh_services", "Yes"],
    ["limitations_desc", "has_limitations", "Yes"],
    ["court_case_desc", "pending_court_cases", "Yes"],
  ];
  for (const [child, parent, value] of gates) {
    if (extracted[child] && !extracted[parent]) extracted[parent] = value;
  }
}

export async function extractFromCca(
  fileBuffer: Buffer, mimeType: string,
): Promise<CcaExtractionResult> {
  if (!ccaConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not set - add it in your host's environment to enable CCA reading.");
  }
  const client = new Anthropic();
  const questions = extractableQuestions();
  const base64 = fileBuffer.toString("base64");

  const doc =
    mimeType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: (mimeType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 } };

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    system:
      "You extract information from a completed Comprehensive Clinical Assessment (CCA) - a " +
      "North Carolina behavioral-health clinical document - to pre-fill a client intake packet. " +
      "Read the whole document carefully. Return ONLY fields whose answers are actually present " +
      "in the document; omit anything not stated. Never guess or invent values. For fields with " +
      "a fixed option list, choose the single closest matching option; if nothing matches, omit " +
      "the field. Dates as MM/DD/YYYY (or YYYY-MM-DD for date-typed fields). Free-text fields " +
      "should be concise summaries in plain language, quoting the document's substance faithfully. " +
      "Answers are written onto the short ruled lines of a paper form, so keep each free-text " +
      "answer under about 200 characters. Additional rules: " +
      "(1) diagnosis fields: include DSM/ICD codes when the document lists them (e.g. 'PTSD - F43.10'); " +
      "put the principal diagnosis first. " +
      "(2) Substance rows sub1..sub5: one substance per row starting with the most significant; " +
      "age_first is the age at first use; last_used is when the client last used it. " +
      "(3) is_minor_or_incompetent and the guardian fields describe the client's CURRENT legal " +
      "status - never fill them from a guardian the client had in the past (e.g. as a child). " +
      "(4) A preferred/chosen name that differs from the legal name belongs in parentheses after " +
      "the legal name in client_full_name, and staff should honor it in free-text summaries. " +
      "(5) mh_services_desc and mh_service_provider are only for current behavioral-health " +
      "providers/services (therapy, CST, peer support, OPT, medication management provider, etc.); " +
      "do not put medication names there.",
    messages: [{
      role: "user",
      content: [
        doc,
        {
          type: "text",
          text:
            "Extract everything this CCA contains for the following intake fields. " +
            "Return JSON with an answers array, where each item has key and value. " +
            "Use exactly these keys and omit fields the document does not answer. " +
            "For checkbox/chip fields, return value as an array of option strings:\n\n" +
            fieldGuide(questions),
        },
      ],
    }],
    output_config: { format: { type: "json_schema", schema: buildSchema(questions) } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The document could not be processed. Please check the file and try again.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No extraction result returned.");
  const raw = JSON.parse(text.text) as { answers?: Array<{ key?: string; value?: unknown }> };

  // keep only known keys with non-empty values
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const extracted: Answers = {};
  for (const item of raw.answers || []) {
    if (!item.key) continue;
    const q = byKey.get(item.key);
    if (!q) continue;
    const normalized = normalizeValue(q, item.value);
    if (normalized === undefined || (Array.isArray(normalized) && normalized.length === 0)) continue;
    extracted[item.key] = normalized;
  }
  setGatingParents(extracted);
  // the CCA's own assessment date beats "today" for the assessment blanks
  if (extracted.cca_assessment_date) {
    for (const k of ["assess_date", "initial_assessment_date"]) {
      if (!extracted[k]) extracted[k] = extracted.cca_assessment_date;
    }
  }
  return { extracted, fieldCount: Object.keys(extracted).length };
}

/**
 * Merge CCA-extracted values into existing answers.
 * By default only blank answers are filled (client/staff input wins);
 * pass overwrite=true to let the CCA replace existing values.
 */
export function mergeCcaAnswers(
  current: Answers, extracted: Answers, overwrite: boolean,
): { merged: Answers; filled: string[]; skipped: string[] } {
  const merged: Answers = {};
  const filled: string[] = [];
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(extracted)) {
    const existing = current[k];
    const isEmpty = existing === undefined || existing === null || existing === "" ||
      (Array.isArray(existing) && existing.length === 0);
    if (isEmpty || overwrite) {
      merged[k] = v;
      filled.push(k);
    } else {
      skipped.push(k);
    }
  }
  return { merged, filled, skipped };
}
