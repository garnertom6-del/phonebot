export const PROVIDER_SEARCH_MIN_FUZZY_LENGTH = 3;
export const PROVIDER_SEARCH_SCORE_FLOOR = 0.6;
export const PROVIDER_SEARCH_PACKET_MIN_LENGTH = 6;

export type ProviderSearchFields = {
  name: string;
  slug: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  adminEmails?: Array<string | null | undefined>;
  packetFileNames?: Array<string | null | undefined>;
};

export type ProviderSearchMatchField = "name" | "slug" | "contact" | "email" | "phone" | "admin" | "packet";

export type ProviderSearchMatch = {
  score: number;
  field: ProviderSearchMatchField;
  haystack: string;
  start: number;
  length: number;
};

const FIELD_WEIGHT: Record<ProviderSearchMatchField, number> = {
  name: 1,
  slug: 0.95,
  contact: 0.8,
  email: 0.75,
  phone: 0.7,
  admin: 0.7,
  packet: 0.45,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) grid[i][0] = i;
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost,
      );
    }
  }
  return grid[a.length][b.length];
}

function exactOrPrefixHit(haystack: string, query: string): { start: number; length: number; quality: number } | null {
  const q = normalize(query);
  if (!q) return null;
  const lower = haystack.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx >= 0) {
    const atTokenStart = idx === 0 || !/[a-z0-9]/i.test(haystack[idx - 1] || "");
    return { start: idx, length: q.length, quality: atTokenStart ? 1 : 0.84 };
  }

  let cursor = 0;
  for (const token of lower.split(/[^a-z0-9]+/).filter(Boolean)) {
    const tokenStart = lower.indexOf(token, cursor);
    cursor = tokenStart < 0 ? cursor : tokenStart + token.length;
    if (tokenStart >= 0 && token.startsWith(q)) {
      return { start: tokenStart, length: q.length, quality: 0.96 };
    }
  }
  return null;
}

function fuzzyTokenHit(haystack: string, query: string): { start: number; length: number; quality: number } | null {
  const q = normalize(query);
  if (q.length < PROVIDER_SEARCH_MIN_FUZZY_LENGTH) return null;
  const lower = haystack.toLowerCase();
  let best: { start: number; length: number; quality: number } | null = null;
  let cursor = 0;
  for (const token of lower.split(/[^a-z0-9]+/).filter((token) => token.length >= q.length - 1)) {
    const tokenStart = lower.indexOf(token, cursor);
    cursor = tokenStart < 0 ? cursor : tokenStart + token.length;
    if (tokenStart < 0) continue;
    if (Math.abs(token.length - q.length) > 2) continue;
    const distance = levenshtein(token, q);
    const allowed = q.length >= 6 ? 2 : 1;
    if (distance <= 0 || distance > allowed) continue;
    const quality = 1 - distance / Math.max(token.length, q.length);
    if (quality >= PROVIDER_SEARCH_SCORE_FLOOR && (!best || quality > best.quality)) {
      best = { start: tokenStart, length: token.length, quality };
    }
  }
  return best;
}

export function providerSearchFieldsFromRow(provider: {
  name: string;
  slug: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  memberships?: Array<{ active: boolean; role: string; user: { email: string } }>;
  pdfTemplates?: Array<{ originalFileName?: string | null }>;
}): ProviderSearchFields {
  return {
    name: provider.name,
    slug: provider.slug,
    contactName: provider.contactName,
    email: provider.email,
    phone: provider.phone,
    adminEmails: (provider.memberships || [])
      .filter((membership) => membership.active && membership.role === "PROVIDER_ADMIN")
      .map((membership) => membership.user.email),
    packetFileNames: (provider.pdfTemplates || []).map((template) => template.originalFileName),
  };
}

export function scoreProviderSearch(
  provider: ProviderSearchFields,
  query: string,
): ProviderSearchMatch | null {
  const q = query.trim();
  if (!q) return { score: 1, field: "name", haystack: provider.name, start: 0, length: 0 };

  const fields: Array<{ field: ProviderSearchMatchField; value: string }> = [
    { field: "name", value: provider.name },
    { field: "slug", value: provider.slug },
    { field: "contact", value: provider.contactName || "" },
    { field: "email", value: provider.email || "" },
    { field: "phone", value: provider.phone || "" },
  ];
  for (const email of provider.adminEmails || []) {
    if (email) fields.push({ field: "admin", value: email });
  }
  for (const name of provider.packetFileNames || []) {
    if (name) fields.push({ field: "packet", value: name });
  }
  const searchableFields = fields.filter((item) => item.value);

  let best: ProviderSearchMatch | null = null;
  for (const item of searchableFields) {
    if (item.field === "packet" && q.length < PROVIDER_SEARCH_PACKET_MIN_LENGTH) continue;
    const exact = exactOrPrefixHit(item.value, q);
    const fuzzy = exact ? null : fuzzyTokenHit(item.value, q);
    const hit = exact || fuzzy;
    if (!hit) continue;
    if (hit.quality < PROVIDER_SEARCH_SCORE_FLOOR) continue;
    const score = FIELD_WEIGHT[item.field] * hit.quality;
    if (!best || score > best.score) {
      best = {
        score,
        field: item.field,
        haystack: item.value,
        start: hit.start,
        length: hit.length,
      };
    }
  }
  return best;
}

export function filterProvidersBySearch<T extends ProviderSearchFields>(
  providers: T[],
  query: string,
): Array<T & { searchMatch: ProviderSearchMatch | null }> {
  const q = query.trim();
  if (!q) return providers.map((provider) => ({ ...provider, searchMatch: null }));
  return providers
    .map((provider) => ({ ...provider, searchMatch: scoreProviderSearch(provider, q) }))
    .filter((provider) => !!provider.searchMatch)
    .sort((left, right) => {
      const scoreDelta = (right.searchMatch?.score || 0) - (left.searchMatch?.score || 0);
      return scoreDelta || left.name.localeCompare(right.name);
    });
}
