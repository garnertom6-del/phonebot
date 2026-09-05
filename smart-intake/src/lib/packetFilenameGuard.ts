const KNOWN_PROVIDER_TOKENS: Array<{ token: string; names: string[] }> = [
  { token: "gso", names: ["gso", "greensboro", "aliyah"] },
  { token: "welliance", names: ["welliance"] },
  { token: "ewc", names: ["ewc", "essential wellness"] },
  { token: "ecc", names: ["ecc", "essential community", "empower community"] },
  { token: "prayers", names: ["prayer", "poc"] },
  { token: "moore", names: ["moore divine", "mdc"] },
];

const CLIENT_NAME_RE = /\b([A-Z][A-Za-z.'-]{1,20})[-_ ]([A-Z][A-Za-z.'-]{1,20})\b/;
const BLANK_PACKET_HINTS = /\b(blank|template|intake[-_ ]?(form|packet)|packet)\b/i;
const GENERIC_NAME_WORDS = new Set([
  "intake", "packet", "form", "client", "blank", "template", "care", "inc", "llc",
  "health", "wellness", "services", "clinic", "package", "document", "page", "copy",
  "test", "only", "working", "use", "this", "one",
]);

export type PacketFilenameWarning = {
  level: "block" | "warn";
  code: "other_provider" | "client_name";
  message: string;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function providerTokens(providerName: string): Set<string> {
  const normalized = normalize(providerName);
  // Shared form/business words and dates do not identify a provider.
  const tokens = new Set(normalized.split(" ").filter((part) => (
    part.length > 1 && !GENERIC_NAME_WORDS.has(part) && !/^\d+$/.test(part)
  )));
  for (const group of KNOWN_PROVIDER_TOKENS) {
    if (group.names.some((name) => normalized.includes(name))) {
      tokens.add(group.token);
      for (const name of group.names) tokens.add(name);
    }
  }
  return tokens;
}

function filenameLooksLikeClientPacket(fileName: string, own: Set<string>): boolean {
  const stem = fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ");
  const words = normalize(stem).split(" ").filter(Boolean);
  if (words.every((word) => own.has(word) || GENERIC_NAME_WORDS.has(word) || /^\d+$/.test(word))) return false;
  const match = CLIENT_NAME_RE.exec(stem);
  if (!match) return false;
  if (GENERIC_NAME_WORDS.has(match[1].toLowerCase()) || GENERIC_NAME_WORDS.has(match[2].toLowerCase())) return false;
  if (/\b(inc|llc|care|wellness|health|services|clinic)\b/i.test(stem)) return false;
  if ([...own].some((token) => token.length > 3 && normalize(fileName).includes(token))) return false;
  return !BLANK_PACKET_HINTS.test(stem) || /[-_][A-Z][a-z]+[-_][A-Z][a-z]+/.test(fileName);
}

/**
 * Warn before activating a packet whose filename looks like another
 * organization's form or a filled client copy (the Welliance/GSO-ALIYAH case).
 */
export function packetFilenameWarning(
  fileName: string | null | undefined,
  providerName: string,
  otherProviderNames: string[] = [],
): PacketFilenameWarning | null {
  const raw = (fileName || "").trim();
  if (!raw) return null;
  const fileNorm = normalize(raw);
  const own = providerTokens(providerName);

  for (const other of otherProviderNames) {
    if (!other || normalize(other) === normalize(providerName)) continue;
    const otherTokens = providerTokens(other);
    const hits = [...otherTokens].filter((token) => token.length > 2 && fileNorm.includes(token) && !own.has(token));
    if (hits.length) {
      return {
        level: "warn",
        code: "other_provider",
        message: `This file name looks like ${other}'s packet (${raw}). Confirm it is the blank form for ${providerName} before activating.`,
      };
    }
  }

  for (const group of KNOWN_PROVIDER_TOKENS) {
    const hit = group.names.find((name) => fileNorm.includes(name) && !own.has(name) && !own.has(group.token));
    if (hit) {
      return {
        level: "warn",
        code: "other_provider",
        message: `This file name includes "${hit}", which does not match ${providerName}. Confirm it is the correct blank packet before activating.`,
      };
    }
  }

  if (filenameLooksLikeClientPacket(raw, own)) {
    return {
      level: "warn",
      code: "client_name",
      message: `This file name looks like a client copy (${raw}) rather than a blank template. Upload a blank packet before activating.`,
    };
  }

  return null;
}
