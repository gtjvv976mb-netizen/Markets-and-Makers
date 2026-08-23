import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { config, heliusRpcUrl } from "./config.js";
import { closeDatabase, databaseHealth, recordHeliusEvents } from "./database.js";
import { clientMessageSchema, validateMove, type PositionSample } from "./protocol.js";

interface Presence {
  sessionId: string;
  playerId: string;
  islandId: string;
  position: PositionSample;
  socket: WebSocket;
}

const presence = new Map<WebSocket, Presence>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && config.clientOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function rateAllowed(req: IncomingMessage): boolean {
  const key = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 120;
}

async function body(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error("request-too-large");
  }
  return text ? JSON.parse(text) : null;
}

function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function tokenBalance(owner: string): Promise<{ rawAmount: string; decimals: number; uiAmount: number }> {
  const response = await fetch(heliusRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: config.tokenMint }, { encoding: "jsonParsed", commitment: "confirmed" }]
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`helius-${response.status}`);
  const payload = await response.json() as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } } }> } };
  let raw = 0n;
  let decimals = 0;
  for (const entry of payload.result?.value ?? []) {
    const amount = entry.account?.data?.parsed?.info?.tokenAmount;
    if (amount?.amount) raw += BigInt(amount.amount);
    if (typeof amount?.decimals === "number") decimals = amount.decimals;
  }
  return { rawAmount: raw.toString(), decimals, uiAmount: Number(raw) / 10 ** decimals };
}

const server = createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (!rateAllowed(req)) { json(res, 429, { error: "rate-limit" }); return; }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const database = await databaseHealth();
      json(res, database === "unavailable" ? 503 : 200, {
        status: database === "unavailable" ? "degraded" : "ok",
        service: "markets-and-makers-authority",
        database,
        realtime: "ready",
        chain: config.heliusApiKey && config.tokenMint ? "read-only-ready" : "not-configured"
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/public-config") {
      json(res, 200, {
        realm: "sunwoven-1",
        tickRate: 10,
        chainNetwork: config.solanaNetwork,
        tokenMint: config.tokenMint || null,
        tokenMode: "read-only"
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/chain/balance") {
      const owner = url.searchParams.get("owner") ?? "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) { json(res, 400, { error: "invalid-owner" }); return; }
      if (!config.heliusApiKey || !config.tokenMint) { json(res, 503, { error: "chain-not-configured" }); return; }
      json(res, 200, await tokenBalance(owner));
      return;
    }
    if (req.method === "POST" && url.pathname === "/webhooks/helius") {
      if (!secretMatches(req.headers.authorization, config.heliusWebhookSecret)) { json(res, 401, { error: "unauthorized" }); return; }
      const payload = await body(req);
      if (!Array.isArray(payload)) { json(res, 400, { error: "expected-event-array" }); return; }
      const accepted = await recordHeliusEvents(payload);
      json(res, 202, { received: payload.length, accepted, creditsGranted: 0, reviewRequired: true });
      return;
    }
    json(res, 404, { error: "not-found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "internal-error" });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const origin = req.headers.origin;
  if (url.pathname !== "/room" || (origin && !config.clientOrigins.has(origin))) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (socket) => {
  const helloTimeout = setTimeout(() => socket.close(1008, "hello-required"), 5000);
  socket.on("message", (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); } catch { socket.close(1003, "invalid-json"); return; }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) { socket.send(JSON.stringify({ type: "error", code: "invalid-message" })); return; }
    const message = result.data;
    if (message.type === "hello") {
      clearTimeout(helloTimeout);
      const sessionId = randomUUID();
      presence.set(socket, {
        sessionId,
        playerId: message.playerId,
        islandId: message.islandId,
        position: { x: message.x ?? 0, z: message.z ?? 0, at: Date.now(), sequence: 0 },
        socket
      });
      socket.send(JSON.stringify({ type: "welcome", sessionId, tickRate: 10, authority: "render-zone" }));
      return;
    }
    if (message.type === "ping") { socket.send(JSON.stringify({ type: "pong", sentAt: message.sentAt, serverAt: Date.now() })); return; }
    const player = presence.get(socket);
    if (!player) { socket.close(1008, "hello-required"); return; }
    const next = { x: message.x, z: message.z, at: Date.now(), sequence: message.sequence };
    if (!validateMove(player.position, next)) { socket.send(JSON.stringify({ type: "correction", ...player.position })); return; }
    player.position = next;
  });
  socket.on("close", () => { clearTimeout(helloTimeout); presence.delete(socket); });
});

const broadcast = setInterval(() => {
  const byIsland = new Map<string, Array<{ playerId: string; x: number; z: number; sequence: number }>>();
  for (const player of presence.values()) {
    const list = byIsland.get(player.islandId) ?? [];
    list.push({ playerId: player.playerId, x: player.position.x, z: player.position.z, sequence: player.position.sequence });
    byIsland.set(player.islandId, list);
  }
  for (const player of presence.values()) {
    if (player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify({ type: "snapshot", serverAt: Date.now(), players: byIsland.get(player.islandId) ?? [] }));
    }
  }
}, 100);

server.listen(config.port, "0.0.0.0", () => console.log(`Markets & Makers authority listening on ${config.port}`));

async function shutdown(): Promise<void> {
  clearInterval(broadcast);
  for (const socket of presence.keys()) socket.close(1012, "server-restart");
  wss.close();
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
