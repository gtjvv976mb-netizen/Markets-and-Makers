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
