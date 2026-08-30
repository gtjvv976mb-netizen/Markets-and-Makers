import { serverBase } from "./network";

const TOKEN_KEY = "markets-makers-session";
/**
 * The signed-in wallet, remembered so the save key can be scoped to it SYNCHRONOUSLY.
 *
 * `currentPrincipal()` asks the server, and loadState() runs long before any request comes
 * back — so without this the first save of a session is written to whatever key was last
 * used. That is how two wallets in one browser came to share one city.
 */
const WALLET_KEY = "markets-makers-wallet";

/** The wallet this browser is signed in as, or null. Never a promise: the loader needs it now. */
export function linkedWallet(): string | null {
  return sessionToken() ? localStorage.getItem(WALLET_KEY) : null;
}

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
  /** Phantom and every compatible wallet: sign a transaction AND submit it. */
  signAndSendTransaction?(transaction: unknown): Promise<{ signature: string }>;
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

  // A rejected prompt throws with the wallet's own wording — fine. But a wallet that never
  // answers AT ALL — locked, wedged, or its popup lost behind a window — used to hang this
  // promise forever, and the button above it sat disabled on "Waking Mercedonia…" for good:
  // the exact "I press connect and nothing shows up" report, with no error to show because
  // nothing ever failed. Ninety seconds is long enough to unlock a wallet and find a popup;
  // after that the player gets words and a live button instead of silence.
  const withDeadline = async <T>(work: Promise<T>, what: string): Promise<T> => {
    let timer = 0;
    const deadline = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(
        `Your wallet did not respond to the ${what} request. If it is locked, unlock it and try again — its popup may also be behind another window.`)), 90_000);
    });
    try { return await Promise.race([work, deadline]); }
    finally { window.clearTimeout(timer); }
  };
  const connection = await withDeadline(wallet.connect(), "connection").catch((error: { message?: string }) => {
    throw new Error(error?.message
      ? `Your wallet did not complete the connection: ${error.message}`
      : "Your wallet did not complete the connection.");
  });
  const publicKey = connection?.publicKey;
  if (!publicKey) throw new Error("Your wallet connected without returning an address.");
  const walletAddress = publicKey.toString();

  // A generous timeout, deliberately: the authority sleeps when idle and its FIRST request
  // after a quiet spell measured 15.2 seconds against the live origin. The other calls in this
  // file use 6s, which would abort a cold start every time and report it as a refusal — so
  // this one waits, and the caller shows that it is waiting rather than looking dead.
  const challengeResponse = await fetch(`${base}/api/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
    signal: AbortSignal.timeout(45_000),
  }).catch((error: Error) => {
    throw new Error(error.name === "TimeoutError"
      ? "Mercedonia did not answer in time. It may be waking up — try once more in a moment."
      : "Could not reach Mercedonia. Check your connection and try again.");
  });
  if (!challengeResponse.ok) throw new Error("The server would not issue a sign-in request.");
  const challenge = await challengeResponse.json() as { nonce: string; message: string };

  // Same deadline on the signature: this is the second popup, and the likelier one to be
  // missed — the player already clicked once and looked away.
  const signed = await withDeadline(
    wallet.signMessage(new TextEncoder().encode(challenge.message), "utf8"), "signature");

  const verifyResponse = await fetch(`${base}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, nonce: challenge.nonce, signature: base58(signed.signature) }),
    signal: AbortSignal.timeout(45_000),
  }).catch((error: Error) => {
    // The signature is already spent at this point, so say so plainly rather than leaving a
    // player wondering whether they are half signed-in.
    throw new Error(error.name === "TimeoutError"
      ? "Mercedonia did not confirm the signature in time. Nothing was linked — try again."
      : "Lost contact while confirming the signature. Nothing was linked — try again.");
  });
  if (!verifyResponse.ok) {
    const detail = await verifyResponse.json().catch(() => ({})) as { message?: string };
    throw new Error(detail.message ?? "The server rejected that signature.");
  }
  const session = await verifyResponse.json() as { token: string; playerId: string; walletAddress: string };
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(WALLET_KEY, session.walletAddress);
  return { playerId: session.playerId, walletAddress: session.walletAddress };
}

export async function currentPrincipal(): Promise<Principal | null> {
  const base = serverBase();
  if (!base || !sessionToken()) return null;
  try {
    const response = await fetch(`${base}/api/auth/me`, { headers: authHeaders(), signal: AbortSignal.timeout(6000) });
    if (!response.ok) {
      if (response.status === 401) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(WALLET_KEY); }
      return null;
    }
    const principal = await response.json() as Principal;
    // Trust the server's answer over the remembered one: a token that resolves to a
    // different wallet must not keep writing to the previous wallet's city.
    localStorage.setItem(WALLET_KEY, principal.walletAddress);
    return principal;
  } catch { return null; }
}

/**
 * Placed after currentPrincipal on purpose: walletgate.test.ts slices this file from signIn
 * to currentPrincipal and asserts the sign-in path bounds exactly two requests, none under
 * 20s. A purchase has nothing to do with signing in and must not land inside that slice.
 */
/**
 * Buy $MM into the game: the wallet signs and sends, in one approval.
 *
 * The authority builds the transfer (it knows the mint, the decimals and the treasury's
 * token account, and deriving the destination there means the browser cannot point it
 * somewhere else). The wallet shows the player exactly what it does and they approve or
 * reject. Nothing here can move tokens without that approval — this code holds no key.
 *
 * @solana/web3.js is imported DYNAMICALLY, so a couple of hundred kilobytes of Solana
 * library never touches the first load of a game most players will never buy $MM in.
 *
 * Returns the signature; crediting is a separate call, because the transfer is real the
 * moment the chain accepts it and must be claimable even if this tab dies here.
 */
export async function purchaseMM(units: number): Promise<{ signature: string }> {
  const wallet = provider();
  if (!wallet) throw new Error("No Solana wallet is connected.");
  if (!wallet.signAndSendTransaction) {
    throw new Error("This wallet cannot sign transactions in the page. Open the game in your wallet's browser.");
  }
  const base = serverBase();
  const token = sessionToken();
  if (!base || !token) throw new Error("Sign in before bringing $MM in.");

  const prepared = await fetch(`${base}/api/chain/deposit/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ units }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await prepared.json().catch(() => ({})) as { transaction?: string; message?: string };
  if (!prepared.ok || !payload.transaction) {
    throw new Error(payload.message ?? "Mercedonia could not prepare that purchase.");
  }

  const { Transaction } = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(payload.transaction), (c) => c.charCodeAt(0));
  const transaction = Transaction.from(bytes);
  const { signature } = await wallet.signAndSendTransaction(transaction);
  if (!signature) throw new Error("The wallet did not return a signature.");
  return { signature };
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

export interface WithdrawalDesk {
  enabled: boolean;
  network: string;
  minimum: number;
  withdrawable: number;
  payouts: Array<{
    id: string; units: number; state: string; signature: string | null;
    error: string | null; createdAt: string; confirmedAt: string | null;
  }>;
}

export async function fetchWithdrawals(): Promise<WithdrawalDesk | null> {
  const base = serverBase();
  const headers = authHeaders();
  if (!base || !headers) return null;
  try {
    const response = await fetch(`${base}/api/economy/withdrawals`, { headers, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return await response.json() as WithdrawalDesk;
  } catch { return null; }
}

/**
 * Ask the authority to queue a withdrawal to the SESSION's wallet. The server decides
 * everything else; a failure comes back as {error, message} with a 409.
 */
export async function requestWithdrawal(units: number, idempotencyKey: string): Promise<{ ok: boolean; message: string }> {
  const base = serverBase();
  const headers = authHeaders();
  if (!base || !headers) return { ok: false, message: "Sign in with your wallet to withdraw." };
  try {
    const response = await fetch(`${base}/api/economy/withdraw`, {
      method: "POST", headers,
      body: JSON.stringify({ units, idempotencyKey }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json() as { message?: string; units?: number };
    if (!response.ok) return { ok: false, message: payload.message ?? "The authority refused the withdrawal." };
    return { ok: true, message: `Withdrawal of ${payload.units} $MM queued. It lands on-chain within a minute.` };
  } catch { return { ok: false, message: "The authority could not be reached." }; }
}

export async function signOut(): Promise<void> {
  const base = serverBase();
  const token = sessionToken();
  localStorage.removeItem(TOKEN_KEY);
  // The city stays in this browser under its own wallet's key, so signing back in finds
  // it — but the NEXT player to sign in here must not inherit it, which is exactly what
  // happened while one unscoped key held whoever had played last.
  localStorage.removeItem(WALLET_KEY);
  if (base && token) {
    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
}
