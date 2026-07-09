import Anthropic from "@anthropic-ai/sdk";
import type { NcTracksLookupResult } from "./ncTracksLookup";

export function ncTracksDocumentConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function buildSchema() {
  return {
    type: "object",
    properties: {
      mid_number: { type: "string" },
      pcp_name: { type: "string" },
      pcp_phone: { type: "string" },
      pcp_address: { type: "string" },
      preferred_emergency_facility: { type: "string" },
      mco: { type: "string" },
      medicaid_effective_date: { type: "string" },
      has_medicaid: { type: "string" },
      has_nchc: { type: "string" },
      nchc_policy: { type: "string" },
    },
    additionalProperties: false,
  } as const;
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeYesNo(v: string): string {
  if (/^(yes|y|true|active|current)$/i.test(v)) return "Yes";
  if (/^(no|n|false|inactive|none)$/i.test(v)) return "No";
  return v;
}

function normalizeResult(input: Record<string, unknown>): NcTracksLookupResult {
  const out: NcTracksLookupResult = {};
  for (const [key, value] of Object.entries(input)) {
    const text = clean(value);
    if (!text) continue;
    if (key === "has_medicaid" || key === "has_nchc") {
      out[key as keyof NcTracksLookupResult] = normalizeYesNo(text);
    } else {
      out[key as keyof NcTracksLookupResult] = text;
    }
  }
  return out;
}

export async function extractFromNcTracksDocument(
  fileBuffer: Buffer, mimeType: string,
): Promise<{ extracted: NcTracksLookupResult; fieldCount: number }> {
  if (!ncTracksDocumentConfigured()) {
    throw new Error("Automatic NC Tracks document reading is not set up yet.");
  }

  const client = new Anthropic();
  const base64 = fileBuffer.toString("base64");
  const doc =
    mimeType === "application/pdf"
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
        }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (mimeType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: base64,
          },
        };

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4000,
    system:
      "You read NC Tracks cards, screenshots, member summaries, or portal printouts and pull only staff-helper facts " +
      "that belong in a behavioral-health intake packet. Return only values actually shown in the document. Never guess. " +
      "Keep PCP address and practice name together if they appear together. Normalize yes/no fields to Yes or No. " +
      "Use the emergency-facility field only if the document explicitly names a hospital or emergency facility. " +
      "If Medicaid or NC Health Choice is not mentioned, omit it. Dates may stay as shown on the document.",
    messages: [{
      role: "user",
      content: [
        doc,
        {
          type: "text",
          text:
            "Extract any of these fields that are present and return JSON only: " +
            "mid_number, pcp_name, pcp_phone, pcp_address, preferred_emergency_facility, " +
            "mco, medicaid_effective_date, has_medicaid, has_nchc, nchc_policy.",
        },
      ],
    }],
    output_config: { format: { type: "json_schema", schema: buildSchema() } },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The NC Tracks document could not be processed. Please check the file and try again.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No NC Tracks extraction result returned.");
  const raw = JSON.parse(text.text) as Record<string, unknown>;
  const extracted = normalizeResult(raw);
  return { extracted, fieldCount: Object.keys(extracted).length };
}
