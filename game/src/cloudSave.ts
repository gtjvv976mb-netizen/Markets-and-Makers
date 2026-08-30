/**
 * The city, kept somewhere other than this browser.
 *
 * A player's whole game lived in localStorage and nowhere else, and the boot screen said so
 * out loud: clear your site data, change browser, or pick up your phone, and the city is
 * gone. For a game you sign into with a wallet that is the wrong bargain — the wallet is an
 * identity, so it should be able to find your city.
 *
 * The rules here are deliberately boring, because a sync bug loses somebody's game:
 *
 *  - The AUTHORITY stores a blob and never reads it. Money is not in here (see
 *    server/src/save.ts); a save decides what a city looks like, never what it is owed.
 *  - Whichever save has done MORE WORK wins — a counted revision, not a timestamp. Two
 *    devices with disagreeing clocks would otherwise hand the game to whichever was set
 *    fastest.
 *  - A restore NEVER silently discards a bigger local city. When the local save is ahead,
 *    it is pushed instead; when the two are level, local is kept.
 *  - Failure is silent and harmless. No network, no session, a 500 — the game keeps
 *    playing out of localStorage exactly as it did before any of this existed.
 */
import { serverBase } from "./network";
import { linkedWallet, sessionToken } from "./wallet";

export interface CloudSave { revision: number; payload: unknown; updatedAt: string | null }

/** How long a burst of edits is allowed to settle before one push goes out. */
const PUSH_DEBOUNCE_MS = 4_000;
/** A floor between pushes, so a busy minute is a handful of requests and not hundreds. */
const PUSH_MIN_INTERVAL_MS = 15_000;

let pending: unknown = null;
let timer: number | null = null;
let lastPushAt = 0;
let inFlight = false;
/** Set once a pull has happened, so the first push cannot precede the restore it races. */
let hydrated = false;

function ready(): { base: string; token: string } | null {
  const base = serverBase();
  const token = sessionToken();
  if (!base || !token || !linkedWallet()) return null;
  return { base, token };
}

/** The authority's copy, or null when there is nothing stored or nobody to ask. */
export async function pullCloudSave(): Promise<CloudSave | null> {
  const link = ready();
  if (!link) return null;
  try {
    const response = await fetch(`${link.base}/api/world/save`, {
      headers: { Authorization: `Bearer ${link.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as CloudSave;
    hydrated = true;
    return payload.payload ? payload : null;
  } catch {
    return null;
  }
}

/** Send one save now. Resolves false when there was nobody to send it to. */
export async function pushCloudSave(state: unknown): Promise<boolean> {
  const link = ready();
  if (!link) return false;
  const revision = Number((state as { saveRevision?: number } | null)?.saveRevision ?? 0);
  try {
    const response = await fetch(`${link.base}/api/world/save`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ revision, payload: state }),
      signal: AbortSignal.timeout(10_000),
    });
    lastPushAt = Date.now();
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Note that the city changed; a push follows once the edits stop.
 *
 * Every commit() calls this, which is several times a second while a player is building —
 * hence the debounce and the interval floor. Nothing is queued until a pull has happened,
 * so a fresh tab cannot overwrite the stored city with the empty one it booted with before
 * the restore arrived.
 */
export function queueCloudSave(state: unknown): void {
  if (!ready() || !hydrated) return;
  pending = state;
  if (timer !== null) return;
  const since = Date.now() - lastPushAt;
  const wait = Math.max(PUSH_DEBOUNCE_MS, PUSH_MIN_INTERVAL_MS - since);
  timer = window.setTimeout(() => {
    timer = null;
    void flushCloudSave();
  }, wait);
}

/** Push whatever is pending. Safe to call at any time; overlapping calls collapse. */
export async function flushCloudSave(): Promise<void> {
  if (inFlight || pending === null) return;
  inFlight = true;
  const sending = pending;
  pending = null;
  try {
    await pushCloudSave(sending);
  } finally {
    inFlight = false;
  }
}

/**
 * Allow queued pushes, and record what the authority already holds.
 *
 * Called by the restore path once it has decided which city wins, so the two can never
 * race: before this, a push is dropped rather than sent.
 */
export function markHydrated(): void { hydrated = true; }

/** For tests and for signing out: forget everything this module is holding. */
export function resetCloudSave(): void {
  pending = null;
  hydrated = false;
  lastPushAt = 0;
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
}
