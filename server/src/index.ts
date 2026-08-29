import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { config, heliusRpcUrl } from "./config.js";
import { parseTokenBalance } from "./chain.js";
import { closeDatabase, databaseHealth, recordHeliusEvents } from "./database.js";
import { clientMessageSchema, validateMove, type PositionSample } from "./protocol.js";
import { districtBusinesses, makerHoldings, registerBusiness, releaseBusiness, seedPlots, WorldError } from "./world.js";
import { runWorldTick } from "./tick.js";
import { governmentBriefing, runMinds } from "./minds.js";
import { cabinetAvailable, convene, readDirective, recentDirectives, CABINET_INTERVAL_HOURS, WAGE_FACTOR, WORKS_FACTOR } from "./cabinet.js";
import { STATE_INDUSTRIES } from "./minds.js";
import { dispatchAvailable, readEconomy, recentDispatches, writeDispatch } from "./bulletin.js";
import { advisorAvailable, consultAdvisor, recentProposals, REQUIRED_HISTORY } from "./advisor.js";
import { DIALS, readPolicy, resetPolicy } from "./policy.js";
import { buyListing, cancelListing, listItem, readBook, MarketError } from "./market.js";
import { claimEpoch, epochStanding, islandBoard, EconomyError } from "./economy.js";
import { PayoutError, payoutsOf, requestPayout, runPayoutWorker, withdrawableOf } from "./payout.js";
import { redact } from "./treasury.js";
import { pool } from "./database.js";
import { buyFromCivic, sellToDistrict } from "./settlement.js";
import { authenticate, bearerFrom, createChallenge, revokeSession, verifyChallenge, AuthError, type Principal } from "./auth.js";
import { CITIZEN_NAME, CURRENCY_CODE, CURRENCY_NAME, REALM_NAME } from "./catalogue.js";

/** When this process came up. Paired with `commit`, tells you if a deploy landed. */
const STARTED_AT = new Date().toISOString();

const REALM_ID = "sunwoven-1";

function withMercCurrency<T extends object>(value: T): T & { currencyCode: typeof CURRENCY_CODE; currencyName: typeof CURRENCY_NAME } {
  return { ...value, currencyCode: CURRENCY_CODE, currencyName: CURRENCY_NAME };
}

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

/**
 * The client's own address, not the proxy's.
 *
 * Render terminates TLS and forwards, so req.socket.remoteAddress is the PROXY for every
 * request — which put every player on Earth in one shared bucket. The limiter either
 * throttled the whole game at once or, with the bucket reset by whichever request came
 * first, throttled nobody. Neither is a rate limit.
 *
 * The LAST entry in X-Forwarded-For is the one the trusted proxy appended; earlier
 * entries are client-supplied and trivially spoofed, so taking the first would let anyone
 * mint a fresh bucket per request by sending a header.
 */
export function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "";
  const hops = chain.split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1]! : (req.socket.remoteAddress ?? "unknown");
}

function rateAllowed(req: IncomingMessage): boolean {
  const key = clientAddress(req);
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

export function secretMatches(received: string | undefined, expected: string): boolean {
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
  return parseTokenBalance(await response.json());
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
        chain: config.heliusApiKey && config.tokenMint ? "read-only-ready" : "not-configured",
        // Which build is actually answering. Without this the only way to tell whether a
        // deploy landed was to probe the economy and compare a quota against a number
        // worked out by hand — which is exactly how a launch ships the wrong server and
        // nobody notices. Render sets RENDER_GIT_COMMIT on every deploy.
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local",
        startedAt: STARTED_AT,
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/public-config") {
      json(res, 200, {
        realm: REALM_ID,
        realmName: REALM_NAME,
        citizenName: CITIZEN_NAME,
        currencyName: CURRENCY_NAME,
        currencyCode: CURRENCY_CODE,
        tickRate: 10,
        chainNetwork: config.solanaNetwork,
        tokenMint: config.tokenMint || null,
        tokenMode: "read-only",
        marketRoutes: config.marketRoutes ? "enabled" : "disabled",
        // Whether the authority is running the district itself. The client reads this
        // to decide whether to settle its own footfall or to render what the server has
        // already settled — so the flag can be flipped without shipping a client.
        worldTick: config.worldTick ? "server" : "client"
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/chain/balance") {
      const owner = url.searchParams.get("owner") ?? "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) { json(res, 400, { error: "invalid-owner" }); return; }
      if (!config.heliusApiKey || !config.tokenMint) { json(res, 503, { error: "chain-not-configured" }); return; }
      try {
        json(res, 200, await tokenBalance(owner));
      } catch (error) {
        // Distinguish "the chain read failed" from a bug in this service, so a bad or
        // expired RPC key is diagnosable from the outside. The reason is logged rather
        // than returned, because the upstream message can echo the request URL — which
        // carries the API key.
        console.error("chain-balance failed:", error instanceof Error ? error.message : error);
        json(res, 502, { error: "chain-read-failed" });
      }
      return;
    }
    if (url.pathname.startsWith("/api/auth/")) {
      try {
        if (req.method === "POST" && url.pathname === "/api/auth/challenge") {
          const payload = (await body(req, 2_000)) as { walletAddress?: unknown } | null;
          json(res, 200, await createChallenge(String(payload?.walletAddress ?? "")));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/auth/verify") {
          const payload = (await body(req, 4_000)) as Record<string, unknown> | null;
          const session = await verifyChallenge({
            walletAddress: String(payload?.walletAddress ?? ""),
            nonce: String(payload?.nonce ?? ""),
            signature: String(payload?.signature ?? ""),
            displayName: payload?.displayName ? String(payload.displayName) : undefined,
          });
          json(res, 200, session);
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/auth/me") {
          const who = await authenticate(bearerFrom(req.headers.authorization));
          if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
          json(res, 200, who);
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/auth/logout") {
          const token = bearerFrom(req.headers.authorization);
          if (token) await revokeSession(token);
          json(res, 200, { ok: true });
          return;
        }
        json(res, 404, { error: "not-found" });
      } catch (error) {
        if (error instanceof AuthError) { json(res, 401, { error: error.code, message: error.message }); return; }
        throw error;
      }
      return;
    }

    // Prices are public information: anyone may read the district board.
    if (req.method === "GET" && url.pathname === "/api/economy/board") {
      try {
        json(res, 200, withMercCurrency({ island: url.searchParams.get("island") ?? "hearth",
          realmName: REALM_NAME,
          quotes: await islandBoard(REALM_ID, url.searchParams.get("island") ?? "hearth") }));
      } catch (error) {
        if (error instanceof EconomyError) { json(res, 409, { error: error.code, message: error.message }); return; }
        throw error;
      }
      return;
    }

    // Claiming the epoch. The body carries an idempotency key and nothing else: the
    // amount is computed here from the ledger, because a client that can name its own
    // payout is not a client, it is a mint.
    if (req.method === "POST" && url.pathname === "/api/economy/claim") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      const payload = (await body(req, 2_000)) as { idempotencyKey?: unknown } | null;
      const key = typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : null;
      if (!key) { json(res, 400, { error: "idempotencyKey required" }); return; }
      json(res, 200, await claimEpoch(REALM_ID, who.playerId, key));
      return;
    }

    // Withdrawals. The destination is the SESSION's wallet — the one the player proved
    // with a signature at sign-in — and never anything from the request body. The body
    // carries the amount and an idempotency key, nothing else.
    if (req.method === "POST" && url.pathname === "/api/economy/withdraw") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      const payload = (await body(req, 2_000)) as { units?: unknown; idempotencyKey?: unknown } | null;
      const key = typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : null;
      const units = typeof payload?.units === "number" ? payload.units : NaN;
      if (!key) { json(res, 400, { error: "idempotencyKey required" }); return; }
      try {
        json(res, 200, await requestPayout(REALM_ID, who.playerId, who.walletAddress, units, key));
      } catch (error) {
        if (error instanceof PayoutError) { json(res, 409, { error: error.code, message: error.message }); return; }
        throw error;
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/economy/withdrawals") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      json(res, 200, {
        enabled: config.payoutsEnabled,
        network: config.solanaNetwork,
        minimum: config.payoutMin,
        withdrawable: pool ? await withdrawableOf(pool, REALM_ID, who.playerId) : 0,
        payouts: await payoutsOf(REALM_ID, who.playerId),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/economy/standing") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      json(res, 200, await epochStanding(REALM_ID, who.playerId));
      return;
    }

    // Settlement: the district prices the trade and the ledger moves the value.
    if (req.method === "POST" && (url.pathname === "/api/economy/sell" || url.pathname === "/api/economy/buy")) {
      if (!config.marketRoutes) { json(res, 404, { error: "market-disabled" }); return; }
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key)) { json(res, 400, { error: "idempotency-key-required" }); return; }
      const payload = (await body(req, 2_000)) as Record<string, unknown> | null;
      if (!payload) { json(res, 400, { error: "body-required" }); return; }
      const args = {
        idempotencyKey: key, playerId: who.playerId,
        islandId: String(payload.islandId ?? "hearth"),
        itemKey: String(payload.itemKey ?? ""),
        quantity: Number(payload.quantity),
      };
      try {
        const settled = url.pathname.endsWith("/sell") ? await sellToDistrict(args) : await buyFromCivic(args);
        json(res, 200, withMercCurrency(settled));
      } catch (error) {
        if (error instanceof EconomyError || error instanceof MarketError) {
          json(res, 409, { error: error.code, message: error.message }); return;
        }
        throw error;
      }
      return;
    }

    // --- the world registry -------------------------------------------------
    // What is built, and where. Reading a district is public: a shared world that you
    // must log in to look at is not a shared world. Building in it is not.
    if (req.method === "GET" && url.pathname === "/api/world/district") {
      const island = url.searchParams.get("island") ?? "hearth";
      const who = await authenticate(bearerFrom(req.headers.authorization));
      json(res, 200, {
        island,
        realmName: REALM_NAME,
        businesses: await districtBusinesses(REALM_ID, island, who?.playerId),
      });
      return;
    }

    // The Dispatch is public: it is a newspaper, and the whole point is that anyone can
    // read what the district did today without an account.
    if (req.method === "GET" && url.pathname === "/api/world/dispatch") {
      json(res, 200, {
        realmName: REALM_NAME,
        available: dispatchAvailable(),
        dispatches: await recentDispatches(Number(url.searchParams.get("limit") ?? 7)),
      });
      return;
    }

    // Policy is public too: players are entitled to see the rules they are playing under
    // and every change ever made to them, with its reasoning.
    // The state of the realm, in numbers, to anyone who asks.
    //
    // readEconomy is what the Dispatch is written from; publishing it directly means the
    // figures are visible whether or not anyone has paid for a language model to describe
    // them, and it is the only way to see from outside that the world tick is running at
    // all — wages leaving the treasury and arriving in Mercedonian pockets is the pulse.
    if (req.method === "GET" && url.pathname === "/api/world/economy") {
      json(res, 200, withMercCurrency({
        realmName: REALM_NAME,
        worldTick: config.worldTick ? "server" : "client",
        measuredAt: new Date().toISOString(),
        ...(await readEconomy()),
      }));
      return;
    }

    // The cabinet's record. Public for the same reason policy is: a government that
    // decides by judgement rather than by formula owes players the judgement in writing.
    if (req.method === "GET" && url.pathname === "/api/world/cabinet") {
      json(res, 200, {
        realmName: REALM_NAME,
        cabinetAvailable: cabinetAvailable(),
        intervalHours: CABINET_INTERVAL_HOURS,
        bounds: { wageFactor: WAGE_FACTOR, worksFactor: WORKS_FACTOR },
        standing: await readDirective(undefined, Object.keys(STATE_INDUSTRIES)),
        directives: await recentDirectives(Number(url.searchParams.get("limit") ?? 14)),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/world/policy") {
      json(res, 200, {
        realmName: REALM_NAME,
        advisorAvailable: advisorAvailable(),
        requiredHistoryDays: REQUIRED_HISTORY,
        dials: Object.values(DIALS).map((dial) => ({
          key: dial.key, meaning: dial.meaning,
          range: [dial.min, dial.max], maxStepShare: dial.maxStep,
        })),
        current: await readPolicy(REALM_ID),
        proposals: await recentProposals(Number(url.searchParams.get("limit") ?? 20)),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/world/me") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      json(res, 200, withMercCurrency(await makerHoldings(REALM_ID, who.playerId)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/world/policy/reset") {
      // The kill switch: every dial back to the value shipped in the code.
      //
      // This used to require only that you were SIGNED IN — and signing in needs nothing
      // but a wallet and an off-chain signature, both free. Any player could reset the
      // whole realm's economic policy: the civic wage, the payroll cap, the spend rate,
      // wiping every change the advisor had reasoned its way to. Authentication answers
      // "who are you"; it was standing in for "may you", which is a different question.
      //
      // secretMatches returns false on an empty expected value, so an unconfigured
      // MM_ADMIN_KEY leaves this route closed rather than open to everyone.
      if (!secretMatches(req.headers["x-admin-key"] as string | undefined, config.adminKey)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      await resetPolicy(REALM_ID);
      json(res, 200, { reset: true, current: await readPolicy(REALM_ID) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/world/business") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      const payload = (await body(req, 2_000)) as Record<string, unknown> | null;
      if (!payload) { json(res, 400, { error: "body-required" }); return; }
      try {
        const saved = await registerBusiness({
          realmId: REALM_ID,
          playerId: who.playerId,
          plotId: String(payload.plotId ?? ""),
          license: String(payload.license ?? ""),
          condition: Number(payload.condition ?? 100),
          upgrades: payload.upgrades as never,
          // Without this line the whole floor feature is inert AND every upsert wipes the
          // column: registerBusiness would sanitise `undefined` to an empty layout and write
          // it over whatever was there. Both ends were built and the route between them was
          // never checked.
          floor: payload.floor,
        });
        json(res, 200, saved);
      } catch (error) {
        if (error instanceof WorldError) { json(res, 409, { error: error.code, message: error.message }); return; }
        throw error;
      }
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/world/business") {
      const who = await authenticate(bearerFrom(req.headers.authorization));
      if (!who) { json(res, 401, { error: "unauthenticated" }); return; }
      const plotId = url.searchParams.get("plot") ?? "";
      json(res, 200, { released: await releaseBusiness(who.playerId, plotId) });
      return;
    }

    if (url.pathname.startsWith("/api/market/")) {
      if (!config.marketRoutes) { json(res, 404, { error: "market-disabled" }); return; }
      try {
        if (req.method === "GET" && url.pathname === "/api/market/book") {
          const island = url.searchParams.get("island") ?? "hearth";
          const item = url.searchParams.get("item") ?? undefined;
          json(res, 200, withMercCurrency({ listings: await readBook(REALM_ID, island, item) }));
          return;
        }
        if (req.method === "POST") {
          const key = req.headers["idempotency-key"];
          if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key)) {
            json(res, 400, { error: "idempotency-key-required" }); return;
          }
          const payload = (await body(req, 4_000)) as Record<string, unknown> | null;
          if (!payload) { json(res, 400, { error: "body-required" }); return; }
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          // Identity comes from the signed session. A client cannot assert who it is.
          const principal: Principal | null = await authenticate(bearerFrom(req.headers.authorization));
          if (!principal) { json(res, 401, { error: "unauthenticated" }); return; }
          const player = principal.playerId;
          if (url.pathname !== "/api/market/list") {
            const listing = String(payload.listingId ?? "");
            if (!uuid.test(listing)) { json(res, 400, { error: "invalid-listing" }); return; }
          }

          if (url.pathname === "/api/market/list") {
            json(res, 200, withMercCurrency(await listItem({
              idempotencyKey: key, realmId: REALM_ID,
              islandId: String(payload.islandId ?? "hearth"), sellerPlayerId: player,
              itemKey: String(payload.itemKey ?? ""), quantity: Number(payload.quantity),
              unitPrice: Number(payload.unitPrice),
            })));
            return;
          }
          if (url.pathname === "/api/market/cancel") {
            json(res, 200, await cancelListing({
              idempotencyKey: key, listingId: String(payload.listingId ?? ""), sellerPlayerId: player }));
            return;
          }
          if (url.pathname === "/api/market/buy") {
            json(res, 200, withMercCurrency(await buyListing({
              idempotencyKey: key, listingId: String(payload.listingId ?? ""), buyerPlayerId: player })));
            return;
          }
        }
        json(res, 404, { error: "not-found" });
      } catch (error) {
        if (error instanceof MarketError) { json(res, 409, { error: error.code, message: error.message }); return; }
        throw error;
      }
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

/** Open sockets per client address, so one machine cannot hold the room open a thousand times. */
const socketsPerAddress = new Map<string, number>();
export const MAX_SOCKETS_PER_ADDRESS = 8;

/**
 * Whether a socket upgrade may proceed. Exported so the decision can be tested without
 * standing up a real WebSocket: every clause here is a hole the audit found open.
 */
export function upgradeAllowed(input: {
  pathname: string; origin: string | undefined; allowedOrigins: Set<string>;
  withinRate: boolean; openForAddress: number;
}): boolean {
  if (input.pathname !== "/room") return false;
  // An ABSENT origin used to pass. Browsers always send one, so the only callers that
  // benefit are the ones that are not browsers — the population this guard exists for.
  if (!input.origin || !input.allowedOrigins.has(input.origin)) return false;
  if (!input.withinRate) return false;
  if (input.openForAddress >= MAX_SOCKETS_PER_ADDRESS) return false;
  return true;
}

/**
 * Refuse an upgrade with an answer rather than a slammed door.
 *
 * A bare socket.destroy() reaches the client — and Render's edge — as a connection that
 * died mid-handshake, which is reported as a 500. That reads as "the authority broke"
 * when what happened is "you were not allowed in", and it would send someone hunting a
 * server fault that does not exist.
 */
function refuseUpgrade(socket: import("node:stream").Duplex): void {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const origin = req.headers.origin;
  const address = clientAddress(req);
  // Node does not emit `request` for an upgrade once an `upgrade` listener is registered,
  // so this path never reached the HTTP rate limiter at all: the one entry point with no
  // authentication was also the one with no throttle.
  if (!upgradeAllowed({
    pathname: url.pathname, origin, allowedOrigins: config.clientOrigins,
    withinRate: rateAllowed(req), openForAddress: socketsPerAddress.get(address) ?? 0,
  })) { refuseUpgrade(socket); return; }

  wss.handleUpgrade(req, socket, head, (ws) => {
    socketsPerAddress.set(address, (socketsPerAddress.get(address) ?? 0) + 1);
    ws.once("close", () => {
      const left = (socketsPerAddress.get(address) ?? 1) - 1;
      if (left > 0) socketsPerAddress.set(address, left);
      else socketsPerAddress.delete(address);
    });
    wss.emit("connection", ws, req);
  });
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

server.listen(config.port, "0.0.0.0", async () => {
  console.log(`Markets & Makers authority listening on ${config.port}`);
  // The registry is useless without the plots it references, and the layout is generated
  // from the client's own world, so this is safe to run every boot. A database that is
  // not configured yet is not an error — the realm simply runs without persistence.
  try {
    const seeded = await seedPlots(REALM_ID);
    if (seeded > 0) console.log(`world: ${seeded} plots registered across the realm`);
  } catch (error) {
    console.error("world: could not seed plots", error);
  }

  // The district runs itself from here. Passes never overlap: a slow one delays the next
  // rather than stacking on top of it, because two concurrent passes over the same
  // business would both read the same elapsed window.
  if (config.payoutsEnabled && config.databaseUrl) {
    // The payout worker: settle in-flight transfers, then sign new ones. Guarded by its
    // own running flag — a pass that waits on a slow RPC must not be joined by a second
    // pass signing the same rows (SKIP LOCKED protects correctness; this protects load).
    console.log(`payouts: enabled on ${config.solanaNetwork}, every ${config.payoutIntervalSeconds}s`);
    let paying = false;
    payoutTimer = setInterval(() => {
      if (paying) return;
      paying = true;
      void runPayoutWorker()
        .then((report) => {
          if (report.starved) console.warn("payouts: treasury SOL below the fee floor — signing paused");
          const moved = [...report.submitted, ...report.confirmed, ...report.requeued, ...report.failed];
          if (moved.length) {
            console.log(`payouts: ${report.submitted.length} submitted, ${report.confirmed.length} confirmed, `
              + `${report.requeued.length} requeued, ${report.failed.length} failed`);
          }
        })
        // redact: the RPC URL carries ?api-key=… and web3.js quotes the endpoint in its
        // network errors, so an unredacted log would print the Helius key every tick.
        .catch((error) => console.error("payout worker failed", redact((error as Error).message)))
        .finally(() => { paying = false; });
    }, config.payoutIntervalSeconds * 1_000);
  }

  if (config.worldTick && config.databaseUrl) {
    console.log(`world: ticking every ${config.worldTickSeconds}s`);
    let running = false;
    worldTickTimer = setInterval(() => {
      if (running) return;
      running = true;
      // The minds run first: wages are what the Mercedonians spend in the shops the tick
      // is about to open, and the state's works are where those shops restock from.
      // The cabinet sits first, so today's directive governs today's payroll rather than
      // tomorrow's. Safe to offer every minute: it refuses on its own until a day has
      // passed, and every failure path returns a usable directive — the standing one, or
      // the neutral one that reproduces the original formula. The government pays wages
      // whether or not a model answered.
      void (async () => {
        const briefing = await governmentBriefing();
        if (!briefing) return;
        const seated = await convene(briefing, Object.keys(STATE_INDUSTRIES));
        if (seated.status === "decided") {
          console.log(`cabinet: ${seated.directive.stance} — wages x${seated.directive.wageFactor}, `
            + `works x${seated.directive.worksFactor}. ${seated.directive.reason}`);
        }
      })()
        .catch((error) => console.warn("cabinet failed to sit", (error as Error).message))
        .then(() => runMinds())
        .then((minds) => {
          if (minds.government.wagesPaid > 0 || minds.government.productionCost > 0) {
            const made = Object.entries(minds.government.produced).map(([k, v]) => `${v} ${k}`).join(", ");
            console.log(`government: paid ${minds.government.wagesPaid} in wages to ${minds.government.population} households`
              + (made ? `, works made ${made}` : "")
              + (minds.government.austerity ? " (austerity: the cap bound)" : "")
              + (minds.government.restraint ? ` (restraint: ${minds.government.directive.stance})` : ""));
          }
          return runWorldTick();
        })
        .then((report) => {
          if (report.businesses > 0 && (report.sold > 0 || report.produced > 0)) {
            console.log(`world tick: ${report.businesses} businesses, ${report.produced} cycles, ${report.sold} sold for ${report.gross}`);
          }
        })
        .then(() => writeDispatch())
        .then((dispatch) => {
          // A missing dispatch is unremarkable: no key, or the last one is still recent.
          if (dispatch) console.log(`dispatch: "${dispatch.headline}" (${dispatch.mood})`);
        })
        // The advisor was imported and never called, so the one mind allowed to CHANGE
        // how the city behaves only ever ran if a human hit an HTTP route. It belongs on
        // the same clock as everything else.
        //
        // Safe to offer every minute: it refuses on its own until a week has passed, and
        // refuses again below five days of recorded history — an advisor asked about a
        // realm it has barely seen will answer fluently and from nothing. Every proposal
        // still passes the clamps in policy.ts before it reaches the economy.
        .then(() => consultAdvisor())
        .then((advice) => {
          if (advice.status !== "advised") return;
          const applied = advice.applied.filter((change) => change.status === "applied");
          console.log(`advisor: ${advice.assessment}`);
          for (const change of applied) {
            console.log(`  ${change.key}: ${change.previous} -> ${change.applied} (${change.reason})`);
          }
          for (const change of advice.applied.filter((entry) => entry.status !== "applied")) {
            console.log(`  ${change.key}: ${change.status} (asked for ${change.proposed})`);
          }
        })
        .catch((error) => console.error("world tick failed", error))
        .finally(() => { running = false; });
    }, config.worldTickSeconds * 1_000);
  }
});

let worldTickTimer: NodeJS.Timeout | null = null;
let payoutTimer: NodeJS.Timeout | null = null;

async function shutdown(): Promise<void> {
  clearInterval(broadcast);
  if (worldTickTimer) clearInterval(worldTickTimer);
  if (payoutTimer) clearInterval(payoutTimer);
  for (const socket of presence.keys()) socket.close(1012, "server-restart");
  wss.close();
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
