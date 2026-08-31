/** Default US state for NC providers. Location city is never hard-coded. */
export const DEFAULT_INTAKE_STATE = "NC";

export type CreateIntakeHousingInput = {
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  livingArrangement?: string;
  homelessSelected?: boolean;
};

export type CreateIntakeHousing = {
  homeless: boolean;
  livingArrangement: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
};

/**
 * Housing status is a recorded fact, so absence of a street address must stay
 * unknown. Only an explicit staff/client selection may mark someone homeless.
 * An explicit homeless selection drops a typed street so a made-up or stale
 * address is not saved.
 */
export function resolveCreateIntakeHousing(input: CreateIntakeHousingInput): CreateIntakeHousing {
  const street = (input.addressStreet || "").trim();
  const city = (input.addressCity || "").trim();
  const state = (input.addressState || "").trim();
  const living = (input.livingArrangement || "").trim();
  const explicitHomeless = !!input.homelessSelected || living.toLowerCase() === "homeless";
  return {
    homeless: explicitHomeless,
    livingArrangement: explicitHomeless ? "Homeless" : living,
    addressStreet: explicitHomeless ? "" : street,
    addressCity: city,
    addressState: state,
  };
}

/** Use a stored provider default when one exists. Never invent a city. */
export function defaultIntakeLocation(stored?: string | null): string {
  return (stored || "").trim();
}

export function canOfferCompletedPacketEmail(input: {
  packetContextLoaded: boolean;
  packetReady: boolean;
  packetContextError?: boolean;
}): boolean {
  return input.packetContextLoaded && input.packetReady && !input.packetContextError;
}
