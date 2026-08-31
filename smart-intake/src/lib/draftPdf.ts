export function fileSafePdfName(value: string) {
  return value.replace(/\W+/g, "-").replace(/^-+|-+$/g, "") || "Intake";
}

export function packetDownloadFileName(input: {
  providerName: string;
  clientName: string;
  documentState: "DRAFT_PREVIEW" | "CURRENT_FINAL";
}): string {
  const base = `${fileSafePdfName(input.providerName)}-Intake-${fileSafePdfName(input.clientName)}`;
  return input.documentState === "DRAFT_PREVIEW" ? `${base}-DRAFT.pdf` : `${base}.pdf`;
}
