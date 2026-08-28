// Two holes the launch audit found, and the shape of the fixes.
//
// Both are about the difference between "who are you" and "may you". Authentication was
// standing in for authorisation on the policy kill switch, and the rate limiter was
// counting an address that identified Render's proxy rather than any player.

import { describe, expect, it } from "vitest";
import { clientAddress, secretMatches, upgradeAllowed, MAX_SOCKETS_PER_ADDRESS } from "../src/index.js";

const req = (headers: Record<string, string | string[]>, socket = "10.0.0.1") =>
  ({ headers, socket: { remoteAddress: socket } }) as never;

describe("the limiter counts the client, not the proxy", () => {
  it("falls back to the socket when nothing was forwarded", () => {
    expect(clientAddress(req({}, "203.0.113.9"))).toBe("203.0.113.9");
  });

  it("takes the address the trusted proxy appended", () => {
    // Render appends the real client last. Earlier hops are whatever the caller sent.
    expect(clientAddress(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" })))
      .toBe("203.0.113.9");
  });

  it("cannot be given a fresh bucket by a spoofed header", () => {
    // Taking the FIRST hop would let anyone mint a new bucket per request. Two requests
    // with different spoofed prefixes must still land on the same real address.
    const a = clientAddress(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }));
    const b = clientAddress(req({ "x-forwarded-for": "8.8.8.8, 203.0.113.9" }));
    expect(a).toBe(b);
  });

  it("separates two genuinely different clients", () => {
    // The bug: both of these used to key on the proxy and share one bucket.
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.9" })))
      .not.toBe(clientAddress(req({ "x-forwarded-for": "198.51.100.4" })));
  });

  it("handles a repeated header without crashing", () => {
    expect(clientAddress(req({ "x-forwarded-for": ["1.1.1.1", "203.0.113.9"] }))).toBe("203.0.113.9");
  });
});

describe("an operator route is closed unless a key is configured", () => {
  it("refuses when no admin key is set", () => {
    // The property that matters: an unconfigured secret must read as CLOSED, never as
    // "no check required". A deploy that forgets the key must not open the kill switch.
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches(undefined, "")).toBe(false);
  });

  it("refuses a wrong key and accepts the right one", () => {
    expect(secretMatches("wrong-key-here", "the-real-admin-key")).toBe(false);
    expect(secretMatches("the-real-admin-key", "the-real-admin-key")).toBe(true);
  });

  it("does not leak length through an early return", () => {
    // Lengths differ, so it must answer false without comparing byte by byte.
    expect(secretMatches("short", "a-much-longer-admin-key")).toBe(false);
  });
});

describe("the room does not admit everyone", () => {
  // The realtime socket was the one entry point with no authentication AND no throttle:
  // Node stops emitting `request` for an upgrade once an `upgrade` listener exists, so it
  // never reached the HTTP rate limiter at all.
  const ours = new Set(["https://www.markets-makers.com"]);
  const ask = (over: Partial<Parameters<typeof upgradeAllowed>[0]> = {}) => upgradeAllowed({
    pathname: "/room", origin: "https://www.markets-makers.com", allowedOrigins: ours,
    withinRate: true, openForAddress: 0, ...over,
  });

  it("admits a browser from our own origin", () => {
    expect(ask()).toBe(true);
  });

  it("refuses a caller that sends NO origin", () => {
    // The hole: `origin && !allowed.has(origin)` passed anything without the header.
    // Browsers always send one, so only non-browsers benefited.
    expect(ask({ origin: undefined })).toBe(false);
  });

  it("refuses another site's origin", () => {
    expect(ask({ origin: "https://not-us.example" })).toBe(false);
  });

  it("refuses any path but the room", () => {
    expect(ask({ pathname: "/" })).toBe(false);
    expect(ask({ pathname: "/room/../admin" })).toBe(false);
  });

  it("refuses a caller over the rate limit", () => {
    expect(ask({ withinRate: false })).toBe(false);
  });

  it("caps how many sockets one address may hold open", () => {
    expect(ask({ openForAddress: MAX_SOCKETS_PER_ADDRESS - 1 })).toBe(true);
    expect(ask({ openForAddress: MAX_SOCKETS_PER_ADDRESS })).toBe(false);
    expect(ask({ openForAddress: 5_000 })).toBe(false);
  });
});
