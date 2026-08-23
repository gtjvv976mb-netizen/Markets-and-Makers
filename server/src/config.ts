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
  // The market commands trust the playerId in the request body. That is only safe once
  // sessions are bound to a verified wallet, so they stay OFF until that exists.
  MM_MARKET_ROUTES: z.coerce.number().int().min(0).max(1).default(0)
});

const env = schema.parse(process.env);

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  clientOrigins: new Set(env.CLIENT_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)),
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
