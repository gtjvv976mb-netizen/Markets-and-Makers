// Reading the on-chain $MM balance.

export interface TokenBalance { rawAmount: string; decimals: number; uiAmount: number }

interface TokenAccountsResponse {
  error?: { code?: number; message?: string };
  result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } } }> };
}

/**
 * Reads a getTokenAccountsByOwner reply.
 *
 * JSON-RPC reports failure with HTTP 200 and an `error` member, so a response must be
 * inspected rather than trusted. Treating one as "no accounts" would report every
 * failure — a wrong network, a bad key, a rate limit, a mistyped mint — as a balance of
 * zero, which is indistinguishable from a real empty wallet. Devnet answers a mainnet
 * mint with "could not find mint", so a misconfigured SOLANA_NETWORK hits this exactly.
 */
export function parseTokenBalance(payload: unknown): TokenBalance {
  const reply = (payload ?? {}) as TokenAccountsResponse;
  if (reply.error) throw new Error(`rpc-${reply.error.code ?? "error"}: ${reply.error.message ?? "unknown"}`);
  if (!reply.result || !Array.isArray(reply.result.value)) throw new Error("rpc-malformed-response");
  let raw = 0n;
  let decimals = 0;
  for (const entry of reply.result.value) {
    const amount = entry.account?.data?.parsed?.info?.tokenAmount;
    if (amount?.amount) raw += BigInt(amount.amount);
    if (typeof amount?.decimals === "number") decimals = amount.decimals;
  }
  return { rawAmount: raw.toString(), decimals, uiAmount: Number(raw) / 10 ** decimals };
}
