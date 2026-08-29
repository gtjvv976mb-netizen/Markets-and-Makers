// "I press connect wallet and nothing shows up."
//
// Two independent causes, both of which look identical to a player:
//
//   renderBootGate() ran ONCE, read walletAvailable() at that instant, and never looked
//   again. Wallet extensions inject window.solana asynchronously, so a player who HAS a
//   wallet could be shown "Get a Solana wallet" — an <a target="_blank"> to a download page.
//   Behind a popup blocker, clicking it does visibly nothing.
//
//   signIn()'s two fetches had no timeout and the button had no pending state, while the
//   authority sleeps when idle: its first request after a quiet spell measured 15.2s against
//   the live origin. A dead-looking button for fifteen seconds reads as broken.

import { describe, expect, it } from "vitest";
import main from "../src/main.ts?raw";
import wallet from "../src/wallet.ts?raw";

describe("the boot gate notices a wallet that arrives late", () => {
  it("has real source to inspect", () => {
    expect(main.length, "main.ts?raw came back empty").toBeGreaterThan(10_000);
    expect(wallet.length, "wallet.ts?raw came back empty").toBeGreaterThan(1_000);
  });

  it("re-renders the gate instead of reading walletAvailable() once", () => {
    expect(main).toContain("function watchForWallet");
    // It must actually redraw — a watcher that only logs would leave the bug in place.
    const watcher = main.slice(main.indexOf("function watchForWallet"), main.indexOf("function renderBootGate"));
    expect(watcher.length, "watcher slice must be real").toBeGreaterThan(200);
    expect(watcher, "must redraw the gate when a wallet appears").toContain("renderBootGate()");
    expect(watcher, "must poll, because injection has no guaranteed event").toContain("setInterval");
    expect(watcher, "and must honour the Wallet Standard announcement")
      .toContain("wallet-standard:register-wallet");
    expect(watcher, "must stop watching eventually").toContain("clearInterval");
  });

  it("starts watching from the no-wallet branch", () => {
    const gate = main.slice(main.indexOf("function renderBootGate"), main.indexOf("function openBootGate"));
    expect(gate.length).toBeGreaterThan(200);
    expect(gate).toContain("watchForWallet()");
  });
});

describe("connecting says that it is working", () => {
  it("puts the button into a pending state and restores it", () => {
    const handler = main.slice(main.indexOf('action === "gate-connect"'), main.indexOf('action === "wallet-disconnect"'));
    expect(handler.length, "handler slice must be real").toBeGreaterThan(300);
    expect(handler, "the button must show progress").toContain("Waking Mercedonia");
    expect(handler, "and must be re-enabled however it ends").toContain("finally");
    expect((handler.match(/disabled = true/g) ?? []).length,
      "both connect paths need a pending state").toBeGreaterThanOrEqual(2);
  });
});

describe("sign-in cannot hang forever", () => {
  // Bounded to signIn ITSELF. Slicing to end-of-file swept in the six-second timeouts the
  // later functions use and made the count read 7 — a slice that is wrong in the permissive
  // direction is worse than no test.
  const start = wallet.indexOf("export async function signIn");
  const end = wallet.indexOf("export async function currentPrincipal");
  const signIn = wallet.slice(start, end);

  it("is a real, bounded slice", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end, "signIn must end before currentPrincipal").toBeGreaterThan(start);
    expect(signIn).toContain("/api/auth/verify");
    expect(signIn, "the slice must NOT run past signIn").not.toContain("currentPrincipal");
  });

  it("bounds both auth requests", () => {
    expect((signIn.match(/AbortSignal\.timeout/g) ?? []).length,
      "challenge AND verify must both be bounded").toBe(2);
  });

  it("allows for a cold start rather than aborting one", () => {
    // 6s is the timeout the rest of this file uses; it would abort the measured 15.2s cold
    // start every single time and report a working server as a refusal.
    for (const match of signIn.matchAll(/AbortSignal\.timeout\(([0-9_]+)\)/g)) {
      expect(Number(match[1]!.replace(/_/g, "")), "too short for a cold start").toBeGreaterThan(20_000);
    }
  });

  it("names every failure instead of throwing a bare network error", () => {
    expect(signIn).toContain("may be waking up");
    expect(signIn, "a refused wallet prompt must be reported").toContain("did not complete the connection");
    expect(signIn, "a failed verify must say nothing was linked").toContain("Nothing was linked");
  });
});
