import { isValidProviderPacketMappingScore } from "@/lib/packetMappingScore";

export function mappingScoreFromIssues(mappingIssues: string | null | undefined): number | null {
  if (!mappingIssues) return null;
  try {
    const parsed = JSON.parse(mappingIssues) as { score?: unknown };
    return isValidProviderPacketMappingScore(parsed?.score) ? parsed.score : null;
  } catch {
    return null;
  }
}

/** Stored score first, then a score previously written into mappingIssues JSON. */
export function effectiveMappingScore(template: {
  mappingScore?: number | null;
  mappingIssues?: string | null;
} | null | undefined): number | null {
  if (!template) return null;
  if (isValidProviderPacketMappingScore(template.mappingScore)) return template.mappingScore;
  return mappingScoreFromIssues(template.mappingIssues);
}

export function templateWithEffectiveScore<T extends {
  mappingScore?: number | null;
  mappingIssues?: string | null;
}>(template: T, liveScore?: number | null): T {
  const score = isValidProviderPacketMappingScore(liveScore)
    ? liveScore
    : effectiveMappingScore(template);
  return score == null ? template : { ...template, mappingScore: score };
}
