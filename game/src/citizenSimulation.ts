import {
  APPEAL_SHARE_WEIGHT, MERCEDONIANS_BASE, MERCEDONIANS_PER_BUSINESS,
  QUALITY_SHARE_WEIGHT, REPUTATION_SHARE_WEIGHT, SPONSORSHIP_APPEAL,
  STAFF_APPEAL, type LicenseKey, type ResourceKey, type SpecializationKey,
} from "./data";

export type CitizenPurpose = "home" | "work" | "essential" | "meal" | "wellness" | "leisure" | "civic";
export type CitizenDestinationKind = "home" | "business" | "civic" | "district";

export interface CitizenProfile {
  id: string;
  essentialBias: number;
  wellnessBias: number;
  leisureBias: number;
  priceSensitivity: number;
  walkingSpeedMps: number;
}

export interface CitizenDestination {
  id: string;
  island: string;
  kind: CitizenDestinationKind;
  purpose: CitizenPurpose;
  x: number;
  z: number;
  operational: boolean;
  appeal: number;
  capacity: number;
  priceIndex: number;
  plotId?: string;
  license?: LicenseKey;
}

/** A settled household purchase that the visible population can reenact. */
export interface CitizenEconomyActivity {
  id: number;
  at: number;
  island: string;
  plotId: string;
  license: LicenseKey;
  kind: "service" | "retail";
  visitors: number;
  gross: number;
  resource?: ResourceKey;
}

export interface CustomerAppealInputs {
  staff: number;
  appealLevel: number;
  qualityLevel: number;
  reputation: number;
  specialization: SpecializationKey | null;
  sponsored: boolean;
}

const BUSINESS_PURPOSE: Readonly<Record<LicenseKey, CitizenPurpose>> = {
  aquaworks: "work",
  sungrid: "work",
  greenhouse: "essential",
  mine: "work",
  timberworks: "work",
  cratemill: "work",
  workshop: "work",
  factory: "work",
  construction: "work",
  freight: "work",
  shop: "essential",
  restaurant: "meal",
  gym: "wellness",
  cinema: "leisure",
  recycler: "work",
};

export function purposeForBusiness(license: LicenseKey): CitizenPurpose {
  return BUSINESS_PURPOSE[license];
}

function mixedSeed(value: number): number {
  let seed = value >>> 0;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

export function deterministicUnit(seed: number): number {
  return mixedSeed(seed) / 0x1_0000_0000;
}

export function createCitizenProfile(index: number): CitizenProfile {
  const seed = mixedSeed(index * 2_654_435_761 + 1_013_904_223);
  return {
    id: `mercedonian-${String(index + 1).padStart(2, "0")}`,
    essentialBias: .82 + deterministicUnit(seed + 11) * .42,
    wellnessBias: .7 + deterministicUnit(seed + 23) * .62,
    leisureBias: .68 + deterministicUnit(seed + 37) * .7,
    priceSensitivity: .72 + deterministicUnit(seed + 41) * .75,
    walkingSpeedMps: 1.18 + deterministicUnit(seed + 53) * .3,
  };
}

/** A compressed 24-hour routine with a small per-citizen offset. */
export function citizenPurposeAtHour(hour: number, profileIndex: number): CitizenPurpose {
  const shifted = ((hour + ((profileIndex % 7) - 3) * .18) % 24 + 24) % 24;
  if (shifted < 6.5 || shifted >= 22.5) return "home";
  if (shifted < 8) return profileIndex % 3 === 0 ? "wellness" : "essential";
  if (shifted < 11.5) return profileIndex % 5 === 0 ? "civic" : "work";
  if (shifted < 13.5) return profileIndex % 4 === 0 ? "essential" : "meal";
  if (shifted < 17.25) return profileIndex % 6 === 0 ? "civic" : "work";
  if (shifted < 19.5) return profileIndex % 3 === 0 ? "wellness" : "meal";
  if (shifted < 21.75) return profileIndex % 4 === 0 ? "essential" : "leisure";
  return "home";
}

export function destinationWeight(
  destination: CitizenDestination,
  requestedPurpose: CitizenPurpose,
  profile: CitizenProfile,
  distanceM: number,
): number {
  if (!destination.operational || destination.capacity <= 0) return 0;
  const exactPurpose = destination.purpose === requestedPurpose;
  const usefulFallback = requestedPurpose === "work"
    ? destination.purpose === "civic"
    : requestedPurpose === "civic"
      ? destination.purpose === "work"
      : destination.kind === "district";
  if (!exactPurpose && !usefulFallback) return 0;
  const preference = destination.purpose === "essential"
    ? profile.essentialBias
    : destination.purpose === "wellness"
      ? profile.wellnessBias
      : destination.purpose === "leisure"
        ? profile.leisureBias
        : 1;
  const distanceDecay = 1 / (1 + Math.max(0, distanceM) / 42);
  const priceResponse = Math.pow(1 / Math.max(.65, destination.priceIndex), profile.priceSensitivity);
  const capacityResponse = Math.min(1.7, .55 + Math.sqrt(destination.capacity) * .16);
  return (exactPurpose ? 1 : .22)
    * Math.max(.05, destination.appeal)
    * preference
    * priceResponse
    * distanceDecay
    * capacityResponse;
}

export function chooseCitizenDestination(
  destinations: readonly CitizenDestination[],
  requestedPurpose: CitizenPurpose,
  profile: CitizenProfile,
  origin: { x: number; z: number },
  seed: number,
): CitizenDestination | null {
  const weighted = destinations.map((destination) => ({
    destination,
    weight: destinationWeight(
      destination,
      requestedPurpose,
      profile,
      Math.hypot(destination.x - origin.x, destination.z - origin.z),
    ),
  })).filter((entry) => entry.weight > 0);
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = deterministicUnit(seed) * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.destination;
  }
  return weighted.at(-1)?.destination ?? null;
}

/** Visible actors represent cohorts; population changes party size, never model scale. */
export function representedPartySize(population: number, visibleActors: number, actorIndex: number): number {
  if (population <= 0 || visibleActors <= 0) return 1;
  const base = Math.floor(population / visibleActors);
  const remainder = Math.max(0, Math.floor(population) - base * visibleActors);
  return Math.max(1, base + (actorIndex < remainder ? 1 : 0));
}

/** One population formula shared by the economy and the visible representative crowd. */
export function citizenPopulation(buildingCount: number, reputation: number, visitorsServed: number): number {
  return MERCEDONIANS_BASE
    + Math.max(1, Math.floor(buildingCount)) * MERCEDONIANS_PER_BUSINESS
    + Math.floor(Math.max(0, reputation) / 8)
    + Math.floor(Math.max(0, visitorsServed) / 40);
}

/** The same demand appeal used for money settlement and visible destination choice. */
export function customerAppeal(input: CustomerAppealInputs): number {
  return 1
    + (input.sponsored ? SPONSORSHIP_APPEAL : 0)
    + Math.min(1, Math.max(0, input.staff) * STAFF_APPEAL)
    + Math.max(0, input.appealLevel) * APPEAL_SHARE_WEIGHT
    + Math.max(0, input.qualityLevel) * QUALITY_SHARE_WEIGHT
    + Math.min(1.2, Math.max(0, input.reputation) * REPUTATION_SHARE_WEIGHT)
    + (input.specialization === "premium" ? .3 : input.specialization === "community" ? .2 : 0);
}

export function navigationSurfaceCost(surface: string): number {
  if (surface === "road" || surface === "path" || surface === "bridge") return 1;
  if (surface === "empty_plot") return 2.4;
  if (/^land_l\d+$/.test(surface)) return 3.2;
  return Number.POSITIVE_INFINITY;
}
