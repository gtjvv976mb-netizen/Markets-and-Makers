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
  MM_MARKET_ROUTES: z.coerce.number().int().min(0).max(1).default(1)
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
  marketRoutes: env.MM_MARKET_ROUTES === 1
};

export function heliusRpcUrl(): string {
  const host = config.solanaNetwork === "mainnet" ? "mainnet" : "devnet";
  return `https://${host}.helius-rpc.com/?api-key=${encodeURIComponent(config.heliusApiKey)}`;
}
