import { afterEach, beforeEach, describe, expect, it } from "vitest";

// RealmConnection talks to browser globals, so the test supplies them and drives the
// clock by hand. That is the only way to reproduce the failure this guards: a handshake
// that never completes and never raises an event.
interface Timer { id: number; at: number; fn: () => void }

class Clock {
  now = 0;
  private next = 1;
  private timers: Timer[] = [];
  set = (fn: () => void, delay: number): number => {
    const id = this.next++;
    this.timers.push({ id, at: this.now + delay, fn });
    return id;
  };
  clear = (id: number): void => { this.timers = this.timers.filter((t) => t.id !== id); };
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }
}

/** A socket that does exactly nothing — the stalled handshake seen in production. */
class StalledSocket {
  static readonly instances: StalledSocket[] = [];
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { StalledSocket.instances.push(this); }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; this.readyState = 3; }
  /** Complete the handshake the way a healthy server does. */
  succeed(): void {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "welcome", sessionId: "s", tickRate: 10 }) });
  }
}

let clock: Clock;
const statuses: Array<{ status: string; detail: string }> = [];

const load = async () => {
  const module = await import("../src/network.ts?network-test");
  return module;
};

beforeEach(() => {
  clock = new Clock();
  statuses.length = 0;
  StalledSocket.instances.length = 0;
  (globalThis as Record<string, unknown>).window = { setTimeout: clock.set, clearTimeout: clock.clear };
  (globalThis as Record<string, unknown>).location = { hostname: "www.markets-makers.com" };
  (globalThis as Record<string, unknown>).WebSocket = StalledSocket;
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).location;
  delete (globalThis as Record<string, unknown>).WebSocket;
  delete (globalThis as Record<string, unknown>).localStorage;
});

const connect = async () => {
  const { RealmConnection } = await load();
  const realm = new RealmConnection({
    onStatus: (status: string, detail: string) => statuses.push({ status, detail }),
    position: () => ({ x: 0, z: 0 }),
    onPeers: () => {},
  } as never, "hearth");
  realm.connect();
  return realm;
};

describe("realm connection", () => {
  it("dials the room path over a websocket scheme", async () => {
    // The path is /room. A probe against /realtime looks exactly like an outage,
    // which cost real time to work out once already.
    await connect();
    expect(StalledSocket.instances).toHaveLength(1);
    const url = StalledSocket.instances[0]!.url;
    expect(url.endsWith("/room")).toBe(true);
    expect(url.startsWith("ws://") || url.startsWith("wss://")).toBe(true);
  });

  // The bug: retries were driven only by onclose and onerror. A browser can sit in
  // CONNECTING for minutes without firing either — measured at over ten seconds against
  // the live server — so one stalled attempt pinned the client on "Connecting…" forever.
  it("abandons a handshake that never completes, and tries again", async () => {
    await connect();
    const first = StalledSocket.instances[0]!;
    expect(first.closed).toBe(false);

    clock.advance(7_000);
    expect(first.closed).toBe(false);
    expect(StalledSocket.instances).toHaveLength(1);

    clock.advance(2_000);
    expect(first.closed).toBe(true);

    // The retry is scheduled with backoff, so let that elapse too.
    clock.advance(20_000);
    expect(StalledSocket.instances.length).toBeGreaterThanOrEqual(2);
    expect(statuses.some((s) => s.detail === "Reconnecting…" || s.detail === "Offline fallback")).toBe(true);
  });

  it("keeps retrying rather than giving up after one stall", async () => {
    await connect();
    for (let i = 0; i < 4; i += 1) clock.advance(30_000);
    expect(StalledSocket.instances.length).toBeGreaterThanOrEqual(4);
  });

  it("leaves a healthy connection alone once the welcome lands", async () => {
    await connect();
    const socket = StalledSocket.instances[0]!;
    socket.succeed();
    expect(statuses.some((s) => s.detail === "Render authority")).toBe(true);

    // Well past the deadline: a live socket must not be torn down by the watchdog.
    clock.advance(60_000);
    expect(socket.closed).toBe(false);
    expect(StalledSocket.instances).toHaveLength(1);
  });

  it("sends its hello as soon as the socket opens", async () => {
    await connect();
    const socket = StalledSocket.instances[0]!;
    socket.succeed();
    expect(socket.sent).toHaveLength(1);
    const hello = JSON.parse(socket.sent[0]!);
    expect(hello.type).toBe("hello");
    expect(hello.islandId).toBe("hearth");
  });
});
