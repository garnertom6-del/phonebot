import Anthropic from "@anthropic-ai/sdk";
import { extractPdfLayout, layoutPrompt } from "./pdfLayout";
import type { FieldType, FieldMapping } from "@/config/mooreDivinePacketMap";
import {
  mappingCatalog,
  mappingFieldGuide,
  sourceBase,
  type MappingProviderContext,
} from "./mappingCatalog";

export function mappingAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export const DEFAULT_MAPPING_AI_MODEL = "claude-sonnet-5";

function mappingAiModel(): string {
  return process.env.ANTHROPIC_MAPPING_MODEL?.trim() || DEFAULT_MAPPING_AI_MODEL;
}

function mappingAiMaxTokens(): number {
  const configured = Number(process.env.ANTHROPIC_MAPPING_MAX_TOKENS);
  return Number.isFinite(configured) && configured > 0 ? configured : 32000;
}

function mappingAiTimeoutMs(): number {
  const configured = Number(process.env.ANTHROPIC_MAPPING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 300000;
}

const SPECIAL_SOURCES = [
  "signature", "guardian_signature", "staff_signature", "clinician_signature",
  "medical_director_signature", "sign_date", "staff_sign_date", "clinician_sign_date",
  "medical_director_sign_date", "initials", "signer_name", "screening_date",
];

function knownSources(ctx?: MappingProviderContext): Set<string> {
  const keys = new Set<string>(SPECIAL_SOURCES);
  for (const section of mappingCatalog(ctx)) {
    for (const entry of section.entries) keys.add(entry.key);
  }
  return keys;
}

function fieldGuide(ctx?: MappingProviderContext): string {
  const required = mappingCatalog(ctx)
    .flatMap((section) => section.entries)
    .filter((entry) => entry.required)
    .map((entry) => entry.key);
  return [
    "Do not map intake_mode; it is app-only and is not printed on the packet.",
    "Consent, yes/no, and radio questions are checkbox (or initials) fields. Place the printed mark; do not treat a nearby signature name/date as covering that key.",
    required.length ? `Required source keys for this provider: ${required.join(", ")}.` : "",
    mappingFieldGuide(ctx),
  ].filter(Boolean).join("\n");
}

function suggestionSchema() {
  return {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fieldKey: { type: "string" },
            source: { type: "string" },
            page: { type: "integer" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            type: { type: "string", enum: ["text", "checkbox", "date", "signature", "signature_small", "initials"] },
            role: { type: "string", enum: ["client", "guardian", "staff", "clinician", "medicalDirector", "witness", "auto"] },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["fieldKey", "source", "page", "x", "y", "width", "height", "type", "role", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  } as const;
}

function sourceKey(source: string): string {
  return sourceBase(source);
}

function normalizeSuggestions(
  raw: unknown,
  pageSizes: Map<number, { width: number; height: number }>,
  ctx?: MappingProviderContext,
): FieldMapping[] {
  const items = raw && typeof raw === "object" && "suggestions" in raw && Array.isArray(raw.suggestions)
    ? raw.suggestions
    : [];
  const used = new Set<string>();
  const output: FieldMapping[] = [];
  const known = knownSources(ctx);
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const source = typeof value.source === "string" ? value.source.trim() : "";
    const page = Number(value.page);
    const size = pageSizes.get(page);
    const confidence = Number(value.confidence);
    const x = Number(value.x);
    const y = Number(value.y);
    const width = Number(value.width);
    const height = Number(value.height);
    if (!source || !size || !Number.isFinite(confidence) || confidence < 0.55 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (x < 0 || y < 0 || width <= 4 || height <= 4 || x + width > size.width || y + height > size.height) continue;
    const base = sourceKey(source);
    if (!base || (!known.has(base) && !base.startsWith("c_") && !base.startsWith("poc_"))) continue;
    const rawKey = typeof value.fieldKey === "string" ? value.fieldKey.replace(/[^a-zA-Z0-9_-]+/g, "_") : `${base}_p${page}`;
    let fieldKey = `ai_${rawKey || `${base}_p${page}`}`.slice(0, 120);
    let suffix = 2;
    while (used.has(fieldKey)) fieldKey = `${fieldKey}_${suffix++}`;
    used.add(fieldKey);
    const type = ["text", "checkbox", "date", "signature", "signature_small", "initials"].includes(String(value.type))
      ? String(value.type) as FieldType
      : "text";
    const role = ["client", "guardian", "staff", "clinician", "medicalDirector", "witness", "auto"].includes(String(value.role))
      ? String(value.role) as FieldMapping["role"]
      : "client";
    output.push({
      page, fieldKey, source, type, x, y, width, height,
      fontSize: 9, lines: 1, lineHeight: 11.6, required: false, role,
      consentKey: null,
      notes: `AI suggestion (${Math.round(confidence * 100)}%): ${String(value.reason || "matched nearby packet label").slice(0, 220)}`,
      confidence,
      aiStatus: "pending",
    });
  }
  return output;
}

export async function suggestPacketMappings(
  bytes: Buffer,
  signal?: AbortSignal,
  ctx?: MappingProviderContext,
): Promise<{ suggestions: FieldMapping[]; pageCount: number }> {
  if (!mappingAiConfigured()) throw new Error("ANTHROPIC_API_KEY is not configured for AI mapping.");
  const pages = await extractPdfLayout(bytes);
  const pageSizes = new Map(pages.map((page) => [page.page, { width: page.width, height: page.height }]));
  const client = new Anthropic();
  const base64 = bytes.toString("base64");
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, mappingAiTimeoutMs());
  const abortRequest = () => requestController.abort();
  signal?.addEventListener("abort", abortRequest, { once: true });
  if (signal?.aborted) requestController.abort();
  try {
    const response = await client.messages.stream({
      model: mappingAiModel(),
      max_tokens: mappingAiMaxTokens(),
      thinking: { type: "disabled" },
      system:
        "You are a cautious PDF intake-form mapping assistant. Suggest coordinate mappings only; never claim that a suggestion is approved. " +
        "Use only labels and blank areas visibly supported by the packet. Never invent a field that is not present or obvious. " +
        "Coordinates use PDF points with origin at the bottom-left. A text field's rectangle must cover the blank answer line or box, not the printed label. " +
        "A checkbox rectangle must cover the printed checkbox or yes/no mark. Initials cover a printed initial line. A signature rectangle must cover the printed signature line. " +
        "Consent acknowledgments are checkbox or initials fields. Do not skip them just because a signature name/date is nearby. " +
        "Return only suggestions with confidence at least 0.55. Prefer fewer accurate suggestions over guessing. Do not map consent decisions or client signatures to staff roles. " +
        "The human reviewer will inspect every suggestion before saving.",
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          {
            type: "text",
            text:
              "Suggest mappings for this blank provider intake packet in one pass across every page. Use the extracted page text and coordinates below. " +
              "Return at most 400 suggestions covering the whole packet, not just page 1. Use exact source keys from the field guide. For a checkbox use source key=value when the printed option is identifiable. " +
              "For dates use type date. For signatures use source signature/guardian_signature/staff_signature/clinician_signature/medical_director_signature and the appropriate role. Include a confidence between 0 and 1.\n\n" +
              `FIELD GUIDE:\n${fieldGuide(ctx)}\n\nPACKET LAYOUT:\n${layoutPrompt(pages)}`,
          },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: suggestionSchema() } },
    }, { signal: requestController.signal }).finalMessage();
    if (response.stop_reason === "refusal") throw new Error("AI could not review this packet.");
    if (response.stop_reason === "max_tokens") {
      throw new Error("AI mapping reached its output limit before returning a complete field map. Increase ANTHROPIC_MAPPING_MAX_TOKENS and try again.");
    }
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      const contentTypes = response.content.map((block) => block.type).join(", ") || "none";
      throw new Error(`AI returned no usable mapping fields (stop reason: ${response.stop_reason ?? "unknown"}; content: ${contentTypes}).`);
    }
    const raw = JSON.parse(text.text) as unknown;
    return { suggestions: normalizeSuggestions(raw, pageSizes, ctx), pageCount: pages.length };
  } catch (error) {
    if (timedOut) throw new Error(`AI mapping timed out after ${Math.round(mappingAiTimeoutMs() / 60000)} minutes.`);
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
  }
}
