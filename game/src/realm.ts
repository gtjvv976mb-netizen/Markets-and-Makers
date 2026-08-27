import { serverBase } from "./network";
import { sessionToken } from "./wallet";
import { isDemo } from "./state";

/**
 * The client half of the shared economy.
 *
 * When a player is signed in, buying and selling settle on the SERVER: the district
 * prices the trade, the ledger moves the value, and every other player in that district
 * feels it. When they are not, the game falls back to its local simulation so a
 * single-player session still works.
 */

export interface RealmSale {
  itemKey: string; quantity: number; gross: number; tax: number; net: number;
  firstUnit: number; lastUnit: number; contribution: number;
}
export interface RealmPurchase { itemKey: string; quantity: number; cost: number; unitPrice: number }

export type RealmOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "offline" }
  | { status: "refused"; code: string; message: string };

const uuid = (): string => crypto.randomUUID();

function authHeaders(): Record<string, string> | null {
  // Sealed in a demo. Everything that settles in the shared world goes through here, so
  // one check closes the whole layer: no trades, no listings, no registration, no
  // contribution. A demo runs its own private simulation and reaches nothing real.
  if (isDemo()) return null;
  const token = sessionToken();
  if (!serverBase() || !token) return null;
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** True when this client's trades will settle in the shared world rather than locally. */
export const isSynced = (): boolean => authHeaders() !== null;

/**
 * Who is running the district.
 *
 * "server" means the authority is ticking businesses itself — producing goods and
 * selling to Mercedonians on its own schedule — and this client must NOT also settle
 * footfall, or the same customer pays the same shopkeeper twice. "client" means the
 * old behaviour: each browser runs its own crowd.
 *
 * Cached after the first read and defaulted to "client", because the failure that
 * matters is asymmetric. Believing the server owns the world when it does not means a
 * player earns nothing; believing this client owns it when the server also does means
 * the realm mints money. When in doubt, be the one that can be checked against a ledger.
 */
let worldOwner: "server" | "client" | null = null;
let worldOwnerAsked: Promise<void> | null = null;

export function worldRunsOnServer(): boolean {
  return worldOwner === "server";
}

export async function refreshWorldOwner(): Promise<"server" | "client"> {
  const base = serverBase();
  if (!base) { worldOwner = "client"; return "client"; }
  if (!worldOwnerAsked) {
    worldOwnerAsked = (async () => {
      try {
        const response = await fetch(`${base}/api/public-config`, { signal: AbortSignal.timeout(6000) });
        if (!response.ok) { worldOwner = "client"; return; }
        const payload = await response.json() as { worldTick?: string };
        worldOwner = payload.worldTick === "server" ? "server" : "client";
      } catch {
        worldOwner = "client";
      }
    })();
  }
  await worldOwnerAsked;
  return worldOwner ?? "client";
}

/** Re-ask, for when the flag is flipped while a session is open. */
export function forgetWorldOwner(): void {
  worldOwner = null;
  worldOwnerAsked = null;
}

async function command<T>(path: string, body: unknown): Promise<RealmOutcome<T>> {
  const headers = authHeaders();
  const base = serverBase();
  if (!headers || !base) return { status: "offline" };
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      // One key per attempt: a retry after a dropped connection settles once, not twice.
      headers: { ...headers, "Idempotency-Key": uuid() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return { status: "offline" };
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return { status: "refused", code: String(payload.error ?? "refused"),
               message: String(payload.message ?? "The district refused that trade.") };
    }
    return { status: "ok", value: payload as T };
  } catch {
    return { status: "offline" };
  }
}

export function sellToDistrict(islandId: string, itemKey: string, quantity: number): Promise<RealmOutcome<RealmSale>> {
  return command<RealmSale>("/api/economy/sell", { islandId, itemKey, quantity });
}

export function buyFromCivic(islandId: string, itemKey: string, quantity: number): Promise<RealmOutcome<RealmPurchase>> {
  return command<RealmPurchase>("/api/economy/buy", { islandId, itemKey, quantity });
}

export interface RealmQuote {
  itemKey: string; islandId: string; pressure: number; buy: number; sell: number;
  soldToday: number; districtQuota: number; nextUnit: number;
}

/** The district board is public, so it works signed in or not. */
export async function fetchBoard(islandId: string): Promise<RealmQuote[] | null> {
  if (isDemo()) return null;
  const base = serverBase();
  if (!base) return null;
  try {
    const response = await fetch(`${base}/api/economy/board?island=${encodeURIComponent(islandId)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return ((await response.json()) as { quotes?: RealmQuote[] }).quotes ?? null;
  } catch {
    return null;
  }
}

export interface RegisteredBusiness {
  plotId: string; island: string; license: string; condition: number;
  upgrades: { yield: number; capacity: number; speed: number; appeal: number };
  footfall: number; owner: string; mine: boolean; updatedAt: string;
}

/**
 * Tell the authority what has been built here.
 *
 * Without this the server has no idea the business exists, so it cannot tick it and no
 * other player can see it. Sent on lease, licence, build and upgrade — cheap, idempotent
 * at the row level, and harmless to repeat.
 */
export async function registerBusiness(input: {
  plotId: string; license: string; condition: number;
  upgrades: { yield: number; capacity: number; speed: number; appeal: number };
}): Promise<RealmOutcome<RegisteredBusiness>> {
  const headers = authHeaders();
  const base = serverBase();
  if (!headers || !base) return { status: "offline" };
  try {
    const response = await fetch(`${base}/api/world/business`, {
      method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return { status: "offline" };
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      return { status: "refused", code: String(payload.error ?? "refused"),
               message: String(payload.message ?? "The registry refused that build.") };
    }
    return { status: "ok", value: payload as unknown as RegisteredBusiness };
  } catch {
    return { status: "offline" };
  }
}

/**
 * Every business built in a district, including other players'.
 *
 * Public on purpose: a shared world you have to log in to LOOK at is not a shared world.
 * Returns null when there is no server to ask, so callers can tell "nobody has built
 * anything" from "we are playing alone".
 */
export async function fetchDistrict(islandId: string): Promise<RegisteredBusiness[] | null> {
  if (isDemo()) return null;
  const base = serverBase();
  if (!base) return null;
  try {
    const token = sessionToken();
    const response = await fetch(`${base}/api/world/district?island=${encodeURIComponent(islandId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { businesses?: RegisteredBusiness[] };
    return payload.businesses ?? [];
  } catch {
    return null;
  }
}

// --- The maker-to-maker market -------------------------------------------------------
//
// The authority has carried a full order book since the world went server-side — escrowed
// listings, an atomic settle that two buyers cannot both win, a treasury fee, and a block
// on buying your own goods — and no client had ever called any of it. Selling to the
// district (a civic buyer at a published price) was the only trade in the game, which
// makes an economy but not a market: nobody could ever set a price, undercut anyone, or
// buy from another player.

export interface MarketListing {
  id: string;
  islandId: string;
  sellerPlayerId: string;
  itemKey: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
}

export interface MarketListed { listingId: string; escrowed: number }
export interface MarketCancelled { listingId: string; returned: number }
export interface MarketBought { listingId: string; itemKey: string; quantity: number; paid: number; fee: number }

/** Who this client is signed in as. Needed to tell your own listings from everyone else's. */
export async function fetchIdentity(): Promise<{ playerId: string; walletAddress: string } | null> {
  const headers = authHeaders();
  const base = serverBase();
  if (!headers || !base) return null;
  try {
    const response = await fetch(`${base}/api/auth/me`, { headers, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return await response.json() as { playerId: string; walletAddress: string };
  } catch {
    return null;
  }
}

/**
 * What the authority says this maker actually holds.
 *
 * The client keeps its own inventory for the offline simulation, but a listing escrows
 * from the SERVER's ledger. Offering to sell something the ledger does not have is
 * refused, so the market offers what the ledger reports rather than what the browser
 * believes.
 */
export async function fetchHoldings(): Promise<{ wallet: number; inventory: Record<string, number> } | null> {
  const headers = authHeaders();
  const base = serverBase();
  if (!headers || !base) return null;
  try {
    const response = await fetch(`${base}/api/world/me`, { headers, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const payload = await response.json() as { wallet?: number; inventory?: Record<string, number> };
    return { wallet: Number(payload.wallet ?? 0), inventory: payload.inventory ?? {} };
  } catch {
    return null;
  }
}

/** The island's open listings, cheapest first. Public: readable before you sign in. */
export async function fetchMarketBook(islandId: string, itemKey?: string): Promise<MarketListing[] | null> {
  if (isDemo()) return null;
  const base = serverBase();
  if (!base) return null;
  const query = new URLSearchParams({ island: islandId });
  if (itemKey) query.set("item", itemKey);
  try {
    const response = await fetch(`${base}/api/market/book?${query.toString()}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return ((await response.json()) as { listings?: MarketListing[] }).listings ?? [];
  } catch {
    return null;
  }
}

export function listOnMarket(
  islandId: string, itemKey: string, quantity: number, unitPrice: number,
): Promise<RealmOutcome<MarketListed>> {
  return command<MarketListed>("/api/market/list", { islandId, itemKey, quantity, unitPrice });
}

export function buyMarketListing(listingId: string): Promise<RealmOutcome<MarketBought>> {
  return command<MarketBought>("/api/market/buy", { listingId });
}

export function cancelMarketListing(listingId: string): Promise<RealmOutcome<MarketCancelled>> {
  return command<MarketCancelled>("/api/market/cancel", { listingId });
}

// --- The city's books ------------------------------------------------------------------
//
// The treasury was a number in three stat grids. It is the engine of the whole economy —
// it pays the wages that become every shop's customers — and a player could not see
// whether it was healthy, what it was spending, or what the AI government had decided to
// do about it.

export interface CityBooks {
  treasury: number;
  citizensPurse: number;
  makersHolding: number;
  wagesPaidToday: number;
  businesses: number;
  districts: string[];
  busiestTrade: string | null;
  quietestShelf: string | null;
  measuredAt: string;
}

export interface CityPolicy {
  advisorAvailable: boolean;
  requiredHistoryDays: number;
  current: Record<string, number>;
  dials: Array<{ key: string; meaning: string; range: [number, number] }>;
  proposals: Array<{
    proposedAt: string; key: string; previous: number; proposed: number;
    applied: number | null; status: string; rationale: string;
  }>;
}

/**
 * The government's own decision for the day, and the record of the ones before it.
 *
 * The advisor turns dials once a week; the cabinet decides what the state actually does
 * today within them. Published for the same reason policy is — a government that governs
 * by judgement rather than by formula owes the people the judgement in writing.
 */
export interface CityCabinet {
  cabinetAvailable: boolean;
  intervalHours: number;
  bounds: { wageFactor: { min: number; max: number }; worksFactor: { min: number; max: number } };
  standing: CabinetDirective;
  directives: CabinetDirective[];
}

export interface CabinetDirective {
  stance: "expand" | "steady" | "restrain";
  wageFactor: number;
  worksFactor: number;
  priority: string[];
  reason: string;
  address: string;
  decidedAt: string | null;
}

/** Public, all of them: the city's accounts are not a secret from the people in it. */
export async function fetchCityBooks(): Promise<{ books: CityBooks | null; policy: CityPolicy | null; cabinet: CityCabinet | null }> {
  const base = serverBase();
  if (!base || isDemo()) return { books: null, policy: null, cabinet: null };
  const get = async <T,>(path: string): Promise<T | null> => {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(6000) });
      return response.ok ? await response.json() as T : null;
    } catch { return null; }
  };
  const [books, policy, cabinet] = await Promise.all([
    get<CityBooks>("/api/world/economy"),
    get<CityPolicy>("/api/world/policy"),
    get<CityCabinet>("/api/world/cabinet"),
  ]);
  return { books, policy, cabinet };
}
