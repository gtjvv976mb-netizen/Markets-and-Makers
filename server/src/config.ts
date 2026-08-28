import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(10000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLIENT_ORIGINS: z.string().default("http://127.0.0.1:4173,http://localhost:4173"),
  DATABASE_URL: z.string().optional().default(""),
  SOLANA_NETWORK: z.enum(["devnet", "mainnet"]).default("devnet"),
  HELIUS_API_KEY: z.string().optional().default(""),
  HELIUS_WEBHOOK_SECRET: z.string().optional().default(""),
  MM_TOKEN_MINT: z.string().optional().default(""),
  // Market and settlement commands now derive the player from a wallet-signed session,
  // so they are safe to serve. The flag remains as an operational circuit breaker.
  MM_MARKET_ROUTES: z.coerce.number().int().min(0).max(1).default(1),
  MM_WORLD_TICK: z.coerce.number().int().min(0).max(1).default(0),
  MM_WORLD_TICK_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  // On-chain payouts. Two flags, both required for mainnet, because "the payout code is
  // deployed" and "the payout code may move the real token" must be separate decisions.
  MM_PAYOUTS: z.coerce.number().int().min(0).max(1).default(0),
  MM_PAYOUTS_MAINNET: z.coerce.number().int().min(0).max(1).default(0),
  // The treasury signing key, base58 or a JSON byte array. Lives in the host's env and
  // nowhere else; the code that reads it never logs it and never sends it anywhere.
  PAYOUT_TREASURY_SECRET: z.string().optional().default(""),
  MM_PAYOUT_MIN: z.coerce.number().int().min(1).default(100),
  MM_PAYOUT_DAILY_CAP: z.coerce.number().int().min(1).default(50_000),
  MM_PAYOUT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30)
});

const env = schema.parse(process.env);

const configuredClientOrigins = env.CLIENT_ORIGINS
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Keep the official production clients reachable even if an existing Render service
// still carries the pre-launch CLIENT_ORIGINS value from its blueprint. The custom
// domain is what players actually load; the workers.dev origin is the deploy fallback.
// Both are listed because a missing origin fails as an opaque CORS error in the
// browser rather than as anything the server can report.
const productionClientOrigins = env.NODE_ENV === "production"
  ? [
      "https://www.markets-makers.com",
      "https://markets-makers.com",
      "https://markets-and-makers-game.gtjvv976mb.workers.dev",
    ]
  : [];

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  clientOrigins: new Set([...configuredClientOrigins, ...productionClientOrigins]),
  databaseUrl: env.DATABASE_URL,
  solanaNetwork: env.SOLANA_NETWORK,
  heliusApiKey: env.HELIUS_API_KEY,
  heliusWebhookSecret: env.HELIUS_WEBHOOK_SECRET,
  tokenMint: env.MM_TOKEN_MINT,
  marketRoutes: env.MM_MARKET_ROUTES === 1,
  // The world tick runs the district itself. Off by default so a deploy has to opt in:
  // it is the one loop that moves money without a player asking it to.
  worldTick: env.MM_WORLD_TICK === 1,
  worldTickSeconds: env.MM_WORLD_TICK_SECONDS,
  // Payouts are OFF by default everywhere, and on mainnet they additionally demand the
  // second flag. Devnet rehearsals therefore cannot be repurposed into a live drain by
  // copying an env block: the mainnet flag would still be missing.
  payoutsEnabled: env.MM_PAYOUTS === 1
    && (env.SOLANA_NETWORK !== "mainnet" || env.MM_PAYOUTS_MAINNET === 1),
  payoutTreasurySecret: env.PAYOUT_TREASURY_SECRET,
  payoutMin: env.MM_PAYOUT_MIN,
  payoutDailyCap: env.MM_PAYOUT_DAILY_CAP,
  payoutIntervalSeconds: env.MM_PAYOUT_INTERVAL_SECONDS
};

export function heliusRpcUrl(): string {
  const host = config.solanaNetwork === "mainnet" ? "mainnet" : "devnet";
  return `https://${host}.helius-rpc.com/?api-key=${encodeURIComponent(config.heliusApiKey)}`;
}
