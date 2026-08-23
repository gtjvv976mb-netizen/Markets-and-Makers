export interface DeploymentStatus {
  mode: "local" | "render" | "unavailable";
  label: string;
}

export type RealmStatus = "disabled" | "connecting" | "live" | "reconnecting" | "offline";

export interface RemotePlayer { playerId: string; x: number; z: number; sequence: number }

interface RealmHandlers {
  onStatus: (status: RealmStatus, detail: string) => void;
  onPeers: (peers: RemotePlayer[]) => void;
  /** Where we currently are, so hello can declare a spawn the server will accept. */
  position: () => { x: number; z: number };
}

const PLAYER_ID_KEY = "markets-makers-player-id";

/** A stable per-browser identity. The server's hello schema requires a UUID. */
export function localPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function serverBase(): string | null {
  const base = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.replace(/\/$/, "");
  return base || null;
}

export async function detectDeployment(): Promise<DeploymentStatus> {
  const base = serverBase();
  if (!base) return { mode: "local", label: "Local authority" };
  try {
    const response = await fetch(`${base}/health`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { mode: "unavailable", label: "Server degraded" };
    const health = await response.json() as { status?: string; database?: string };
    return health.status === "ok" && health.database === "ready"
      ? { mode: "render", label: "Render authority" }
      : { mode: "unavailable", label: "Server configuring" };
  } catch {
    return { mode: "unavailable", label: "Offline fallback" };
  }
}

/**
 * Live presence against the Render authority. The server already broadcasts island
 * snapshots at 10 Hz; this is the half that was missing. Movement remains locally
 * simulated and is only *reported* here — the server rejects impossible steps and
 * replies with a correction, which we accept.
 */
export class RealmConnection {
  private socket: WebSocket | null = null;
  private readonly playerId = localPlayerId();
  private islandId: string;
  private sequence = 0;
  private lastSentAt = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private attempts = 0;
  private retryTimer: number | null = null;
  private disposed = false;
  private correction: { x: number; z: number } | null = null;

  constructor(private readonly handlers: RealmHandlers, islandId: string) {
    this.islandId = islandId;
  }

  get id(): string { return this.playerId; }

  /** Position the server last insisted on, consumed once by the caller. */
  takeCorrection(): { x: number; z: number } | null {
    const value = this.correction;
    this.correction = null;
    return value;
  }

  connect(): void {
    const base = serverBase();
    if (!base) { this.handlers.onStatus("disabled", "Local authority"); return; }
    if (this.disposed || this.socket) return;

    const url = base.replace(/^http/, "ws") + "/room";
    this.handlers.onStatus(this.attempts ? "reconnecting" : "connecting", this.attempts ? "Reconnecting…" : "Connecting…");

    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch { this.scheduleRetry(); return; }
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.sequence = 0;
      this.lastX = Number.NaN;
      const at = this.handlers.position();
      socket.send(JSON.stringify({ type: "hello", playerId: this.playerId, islandId: this.islandId, x: at.x, z: at.z }));
    };

    socket.onmessage = (event) => {
      let message: { type?: string; players?: RemotePlayer[]; x?: number; z?: number };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === "welcome") {
        this.handlers.onStatus("live", "Render authority");
        return;
      }
      if (message.type === "snapshot" && Array.isArray(message.players)) {
        this.handlers.onPeers(message.players.filter((peer) => peer.playerId !== this.playerId));
        return;
      }
      if (message.type === "correction" && typeof message.x === "number" && typeof message.z === "number") {
        this.correction = { x: message.x, z: message.z };
      }
    };

    socket.onclose = () => { this.socket = null; this.handlers.onPeers([]); this.scheduleRetry(); };
    socket.onerror = () => { try { socket.close(); } catch { /* closing is best-effort */ } };
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== null) return;
    this.attempts += 1;
    const delay = Math.min(15_000, 900 * 2 ** Math.min(this.attempts, 4));
    this.handlers.onStatus(this.attempts > 3 ? "offline" : "reconnecting", this.attempts > 3 ? "Offline fallback" : "Reconnecting…");
    this.retryTimer = window.setTimeout(() => { this.retryTimer = null; this.connect(); }, delay);
  }

  setIsland(islandId: string): void {
    if (this.islandId === islandId) return;
    this.islandId = islandId;
    this.handlers.onPeers([]);
    if (this.socket?.readyState === WebSocket.OPEN) {
      const at = this.handlers.position();
      this.socket.send(JSON.stringify({ type: "hello", playerId: this.playerId, islandId, x: at.x, z: at.z }));
    }
  }

  /** Rate-limited to the server's 10 Hz tick, and only when the avatar actually moved. */
  sendMove(x: number, z: number, now = Date.now()): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (now - this.lastSentAt < 100) return;
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 0.05) return;
    this.lastSentAt = now;
    this.lastX = x;
    this.lastZ = z;
    this.sequence += 1;
    this.socket.send(JSON.stringify({ type: "move", sequence: this.sequence, x, z, sentAt: now }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try { this.socket?.close(); } catch { /* already gone */ }
    this.socket = null;
  }
}
