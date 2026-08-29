export type PdfPreviewFailure = {
  title: string;
  detail: string;
  backHref: string;
};

export function messageForPdfPreviewFailure(
  status: number,
  body: { code?: string; error?: string } | null,
  intakeId: string,
): PdfPreviewFailure {
  const backHref = `/intakes/${intakeId}`;
  const serverMessage = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : "";
  if (status === 401) {
    return {
      title: "Sign in required",
      detail: serverMessage || "Sign in to preview this packet.",
      backHref,
    };
  }
  if (status === 404) {
    return {
      title: "Packet not found",
      detail: serverMessage && serverMessage !== "Not found"
        ? serverMessage
        : "This intake was not found, or you do not have access to it.",
      backHref: "/dashboard",
    };
  }
  if (status === 409 || body?.code === "PACKET_NOT_CURRENT") {
    return {
      title: "Generate the packet first",
      detail: serverMessage || "Generate the completed packet before downloading the final version.",
      backHref,
    };
  }
  if (status >= 500) {
    return {
      title: "Packet preview failed",
      detail: serverMessage || "The packet preview could not be generated. Go back to the intake and try again, or generate a new packet.",
      backHref,
    };
  }
  return {
    title: "Packet preview unavailable",
    detail: serverMessage || `The packet preview could not be opened (${status}).`,
    backHref,
  };
}

export function parsePdfPreviewErrorBody(text: string): { code?: string; error?: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; error?: unknown };
    return {
      code: typeof parsed.code === "string" ? parsed.code : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return { error: trimmed.slice(0, 300) };
  }
}
