export function isValidProviderPacketMappingScore(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= 100;
}
