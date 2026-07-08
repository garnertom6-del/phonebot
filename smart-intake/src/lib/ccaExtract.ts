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
  const skipSections = new Set(["welcome", "survey", "referrals"]);
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
    if (g.group.startsWith("Clinical")) out.push(...g.fields); // SNAP, severity, diagnoses, evals
  }
  return out;
}

function buildSchema(questions: Question[]) {
  const properties: Record<string, object> = {};
  for (const q of questions) {
    if (q.type === "chips") {
      properties[q.key] = { type: "array", items: q.options ? { type: "string", enum: q.options } : { type: "string" } };
    } else if ((q.type === "radio" || q.type === "yesno") && q.options) {
      properties[q.key] = { type: "string", enum: q.options };
    } else {
      properties[q.key] = { type: "string" };
    }
  }
  return { type: "object", properties, required: [], additionalProperties: false } as const;
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
      "the legal name in client_full_name, and staff should honor it in free-text summaries.",
    messages: [{
      role: "user",
      content: [
        doc,
        {
          type: "text",
          text:
            "Extract everything this CCA contains for the following intake fields. " +
            "Return a JSON object using exactly these keys (omit keys the document does not answer):\n\n" +
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
  const raw = JSON.parse(text.text) as Record<string, unknown>;

  // keep only known keys with non-empty values
  const allowed = new Set(questions.map((q) => q.key));
  const extracted: Answers = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k)) continue;
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    extracted[k] = v as Answers[string];
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
