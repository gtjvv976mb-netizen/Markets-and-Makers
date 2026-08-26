import { serverBase } from "./network";
import { sessionToken } from "./wallet";

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
