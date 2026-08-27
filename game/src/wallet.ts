import { serverBase } from "./network";

const TOKEN_KEY = "markets-makers-session";

export interface Principal { playerId: string; walletAddress: string }
export interface EpochClaimResult {
  epochId: number;
  paid: number;
  owed: number;
  reason: "paid" | "already-claimed" | "no-contribution" | "budget-exhausted" | "pool-exhausted";
  lifetime: number;
}

export interface EpochStanding {
  epochId: number; mine: number; cohort: number; total: number;
  share: number; projected: number; budget: number; contributors: number;
}

/** Phantom and compatible wallets expose the same small surface. */
interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
}

function provider(): SolanaProvider | null {
  const injected = (window as unknown as { phantom?: { solana?: SolanaProvider }; solana?: SolanaProvider });
  return injected.phantom?.solana ?? injected.solana ?? null;
}

export const walletAvailable = (): boolean => provider() !== null;

export const sessionToken = (): string | null => localStorage.getItem(TOKEN_KEY);

function authHeaders(): Record<string, string> {
  const token = sessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** base58 without a dependency — signatures are 64 bytes, so this stays cheap. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (const byte of bytes) { if (byte !== 0) break; out += ALPHABET[0]; }
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]!];
  return out;
}

/**
 * Sign in by proving control of a Solana address. The signed message authorises no
 * transfer and costs no fee; it only tells the server which player is calling.
 */
export async function signIn(): Promise<Principal> {
  const base = serverBase();
  if (!base) throw new Error("This build has no authority server configured.");
  const wallet = provider();
  if (!wallet) throw new Error("No Solana wallet found. Install Phantom to link an account.");

  const { publicKey } = await wallet.connect();
  const walletAddress = publicKey.toString();

  const challengeResponse = await fetch(`${base}/api/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  if (!challengeResponse.ok) throw new Error("The server would not issue a sign-in request.");
  const challenge = await challengeResponse.json() as { nonce: string; message: string };

  const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), "utf8");

  const verifyResponse = await fetch(`${base}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, nonce: challenge.nonce, signature: base58(signed.signature) }),
  });
  if (!verifyResponse.ok) {
    const detail = await verifyResponse.json().catch(() => ({})) as { message?: string };
    throw new Error(detail.message ?? "The server rejected that signature.");
  }
  const session = await verifyResponse.json() as { token: string; playerId: string; walletAddress: string };
  localStorage.setItem(TOKEN_KEY, session.token);
  return { playerId: session.playerId, walletAddress: session.walletAddress };
}

export async function currentPrincipal(): Promise<Principal | null> {
  const base = serverBase();
  if (!base || !sessionToken()) return null;
  try {
    const response = await fetch(`${base}/api/auth/me`, { headers: authHeaders(), signal: AbortSignal.timeout(6000) });
    if (!response.ok) { if (response.status === 401) localStorage.removeItem(TOKEN_KEY); return null; }
    return await response.json() as Principal;
  } catch { return null; }
}

/** The real epoch standing: your contribution against everyone else's, from the server. */
export async function fetchStanding(): Promise<EpochStanding | null> {
  const base = serverBase();
  if (!base || !sessionToken()) return null;
  try {
    const response = await fetch(`${base}/api/economy/standing`, { headers: authHeaders(), signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return await response.json() as EpochStanding;
  } catch { return null; }
}

/**
 * Claim this epoch from the authority.
 *
 * The request carries an idempotency key and nothing else — the amount is computed on the
 * server from the ledger, because a client that can name its own payout is a mint. The key
 * is generated once per attempt and reused on retry, so a dropped response replays the
 * same payment rather than making a second one.
 *
 * Returns null when the authority cannot be reached, and the caller falls back to the
 * local estimate. That fallback is still browser-side money; it is marked as an estimate
 * on the face of the button for exactly that reason.
 */
export async function claimEpochOnServer(idempotencyKey: string): Promise<EpochClaimResult | null> {
  const base = serverBase();
  const headers = authHeaders();
  if (!base || !headers) return null;
  try {
    const response = await fetch(`${base}/api/economy/claim`, {
      method: "POST", headers,
      body: JSON.stringify({ idempotencyKey }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return await response.json() as EpochClaimResult;
  } catch { return null; }
}

export async function signOut(): Promise<void> {
  const base = serverBase();
  const token = sessionToken();
  localStorage.removeItem(TOKEN_KEY);
  if (base && token) {
    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
}
