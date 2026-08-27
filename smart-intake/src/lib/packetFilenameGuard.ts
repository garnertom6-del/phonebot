const PACKET_VOCAB = new Set([
  "intake",
  "packet",
  "form",
  "blank",
  "template",
  "pdf",
  "gso",
  "npi",
  "revised",
  "final",
  "new",
  "copy",
  "scan",
  "unsigned",
  "signed",
  "client",
  "care",
  "inc",
  "llc",
  "the",
  "and",
  "for",
  "of",
]);

function splitTokens(value: string): string[] {
  return value
    .replace(/\.pdf$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function providerTokens(providerName: string): string[] {
  return splitTokens(providerName).filter((token) => !PACKET_VOCAB.has(token));
}

function leftoverFileTokens(fileName: string, providerName: string): string[] {
  const owned = new Set(splitTokens(providerName));
  return splitTokens(fileName).filter((token) => !PACKET_VOCAB.has(token) && !owned.has(token) && !/^\d+$/.test(token));
}

/**
 * Warn when an uploaded PDF filename looks like a different provider's form
 * or a filled client packet (for example Aliyah Baldwin on a Welliance row).
 */
export function packetFilenameWarning(
  providerName: string,
  fileName?: string | null,
): string | null {
  const name = providerName.trim();
  const file = fileName?.trim();
  if (!name || !file) return null;

  const ownedTokens = providerTokens(name);
  const fileTokens = splitTokens(file);
  if (!fileTokens.length) return null;

  const matchesProvider = ownedTokens.some((token) => fileTokens.includes(token) || file.toLowerCase().includes(token));
  const leftovers = leftoverFileTokens(file, name);

  if (!matchesProvider && leftovers.length >= 2) {
    return "Wrong packet file: this PDF name looks like a client packet or another provider's form.";
  }
  if (!matchesProvider && leftovers.length === 1 && leftovers[0].length >= 6) {
    return "Wrong packet file: this PDF name does not match this provider.";
  }
  return null;
}
