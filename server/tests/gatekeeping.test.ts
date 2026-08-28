// Two holes the launch audit found, and the shape of the fixes.
//
// Both are about the difference between "who are you" and "may you". Authentication was
// standing in for authorisation on the policy kill switch, and the rate limiter was
// counting an address that identified Render's proxy rather than any player.

import { describe, expect, it } from "vitest";
import { clientAddress, secretMatches } from "../src/index.js";

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
