import { z } from "zod";

export const ADOBE_OPERATIONS = [
  { id: "ocr", label: "Make scans searchable (OCR)", group: "Prepare", description: "Adds searchable English text while preserving the scanned page image." },
  { id: "compress", label: "Compress PDF", group: "Prepare", description: "Reduces file size. Check small text and scanned details in the result." },
  { id: "linearize", label: "Optimize for web viewing", group: "Prepare", description: "Prepares a PDF for faster page-by-page loading." },
  { id: "create", label: "Convert a document or image to PDF", group: "Convert", description: "Accepts blank DOCX, XLSX, PPTX, TXT, PNG or JPEG files." },
  { id: "word", label: "Export to Word", group: "Convert", description: "Creates an editable DOCX copy for template corrections." },
  { id: "excel", label: "Export to Excel", group: "Convert", description: "Extracts a spreadsheet copy. Review converted tables." },
  { id: "powerpoint", label: "Export to PowerPoint", group: "Convert", description: "Creates an editable presentation copy." },
  { id: "rtf", label: "Export to rich text", group: "Convert", description: "Creates an RTF copy." },
  { id: "png", label: "Export pages as PNG", group: "Convert", description: "Downloads page images in a ZIP file." },
  { id: "jpeg", label: "Export pages as JPEG", group: "Convert", description: "Downloads page images in a ZIP file." },
  { id: "combine", label: "Combine PDFs", group: "Organize", description: "Combines the selected files in the displayed order." },
  { id: "split", label: "Split PDF", group: "Organize", description: "Creates a separate PDF for each chosen number of pages." },
  { id: "rotate", label: "Rotate pages", group: "Organize", description: "Rotates selected pages clockwise." },
  { id: "reorder", label: "Reorder pages", group: "Organize", description: "Creates a copy with every page in your chosen order." },
  { id: "delete", label: "Remove selected pages from a copy", group: "Organize", description: "Preserves the original file and removes pages only in a new copy." },
  { id: "insert", label: "Insert pages from another PDF", group: "Organize", description: "Inserts a second PDF before the chosen page of the first." },
  { id: "replace", label: "Replace pages from another PDF", group: "Organize", description: "Replaces pages starting at the chosen page with the second PDF." },
  { id: "watermark", label: "Apply PDF watermark", group: "Organize", description: "Uses the first page of the second PDF as a watermark." },
  { id: "extract", label: "Extract text and tables", group: "Inspect", description: "Creates structured text and table data in a ZIP file." },
  { id: "properties", label: "Inspect PDF properties", group: "Inspect", description: "Reports document, page, font and security information." },
  { id: "accessibility", label: "Check accessibility", group: "Accessibility", description: "Produces an accessibility report. A report is not a compliance certification." },
  { id: "autotag", label: "Add accessibility tags", group: "Accessibility", description: "Adds reading structure and a report. Requires manual reading-order review; uses 10 transactions per page." },
  { id: "protect", label: "Password-protect a copy", group: "Security", description: "Encrypts a copy using AES-256. Keep the password; Smart Intake does not save it." },
  { id: "unprotect", label: "Remove password with owner permission", group: "Security", description: "Requires the document password. Creates a separate unprotected copy." },
] as const;
export type AdobeOperation = typeof ADOBE_OPERATIONS[number]["id"];
export const operationSchema = z.enum(ADOBE_OPERATIONS.map(v => v.id) as [AdobeOperation, ...AdobeOperation[]]);
export const preparationOptionsSchema = z.object({
  pages: z.string().max(800).default(""),
  pageSize: z.number().int().min(1).max(100).default(1),
  angle: z.union([z.literal(90), z.literal(180), z.literal(270)]).default(90),
  basePage: z.number().int().min(1).max(101).default(1),
  password: z.string().max(128).optional(),
  compression: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
}).strict();
export type PreparationOptions = z.infer<typeof preparationOptionsSchema>;
export const preparationJobSchema = z.object({
  idempotencyKey: z.string().uuid(), operation: operationSchema,
  inputIds: z.array(z.string().uuid()).min(1).max(5),
  options: preparationOptionsSchema.default({}),
  confirmedNoClientData: z.literal(true),
  acknowledgedUnits: z.number().int().min(1).max(1000),
}).strict();
export function parsePageSelection(value: string, pageCount: number): number[] {
  if (!value.trim()) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages: number[] = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("Enter page numbers or ranges, such as 1,3-5.");
    const from = Number(match[1]), to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to > pageCount) throw new Error(`Page numbers must be between 1 and ${pageCount}.`);
    for (let n = from; n <= to; n++) pages.push(n);
  }
  if (new Set(pages).size !== pages.length) throw new Error("Each page can be selected only once.");
  return pages;
}
export function estimatedAdobeUnits(operation: AdobeOperation, pages: number) {
  return operation === "autotag" ? Math.max(1, pages) * 10 : Math.max(1, Math.ceil(pages / (operation === "extract" ? 5 : 50)));
}
export type PreparationFile = {
  id: string; name: string; mimeType: string; sha256: string; byteCount: number; pageCount: number | null;
  inspection: { encrypted?: boolean; signed?: boolean; fieldCount?: number; fields?: string[]; warnings?: string[] };
  sourceFileId: string | null; jobId: string | null; promotedTemplateId: string | null; createdAt: string; createdByName: string;
};
export type PreparationJob = {
  id: string; operation: AdobeOperation; status: string; estimatedUnits: number; inputIds: string[];
  message: string | null; cleanupPending: boolean; createdAt: string; createdByName: string; nextPollAt: string | null;
};
export type PreparationData = {
  providerId: string; providerName: string; canWrite: boolean; isMaster: boolean;
  configured: boolean; adobeClientId: string | null; files: PreparationFile[]; jobs: PreparationJob[];
  monthlyEstimatedUnits: number; monthlyBudget: number;
};
