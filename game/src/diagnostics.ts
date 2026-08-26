/**
 * The frame-rate readout, for turning "still laggy" into something fixable.
 *
 * Three rounds of performance work have now shipped against numbers measured on a machine
 * that was never dropping frames. Every one of them removed real waste, and the players
 * who reported the problem still had it — because renderer.render() returns when the
 * commands are submitted, not when the GPU has finished, so the most likely bottleneck is
 * the one a developer's probe cannot see.
 *
 * This closes that. A tester opens a link, plays, and presses one button; what comes back
 * says which device, which GPU, what frame rate, and — the part that matters — whether the
 * adaptive quality even engaged. "43fps, tier 0, ratio 0.6, Intel Iris" is a fixable
 * sentence. "Still laggy" is not.
 *
 * Off by default and free when off: the loop does nothing but check a boolean.
 */

export interface FrameSource {
  pixelRatio: number;
  qualityTier: number;
  drawCalls: number;
  triangles: number;
  liteScene: boolean;
}

const SAMPLE_SIZE = 120;

export class Diagnostics {
  private enabled = false;
  private readonly samples: number[] = [];
  private node: HTMLElement | null = null;
  private lastPaint = 0;
  private lastFrameAt = 0;
  private worst = 0;
  private gpu = "unknown";

  constructor(private readonly read: () => FrameSource) {
    // A link is the only instruction a tester should need.
    const asked = new URLSearchParams(window.location.search).has("perf");
    window.addEventListener("keydown", (event) => {
      // F3, or the backquote most keyboards put under Escape.
      if (event.code === "F3" || event.code === "Backquote") { event.preventDefault(); this.toggle(); }
    });
    if (asked) this.toggle();
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (!this.enabled) { this.node?.remove(); this.node = null; this.samples.length = 0; this.worst = 0; this.lastFrameAt = 0; return; }
    this.gpu = readGpuName();
    this.node = document.createElement("div");
    this.node.className = "perf-overlay";
    document.body.appendChild(this.node);
  }

  /**
   * Called every frame. Returns immediately unless somebody asked to see it.
   *
   * The frame time is measured HERE rather than taken from the caller, because the game
   * loop clamps its delta (`Math.min(0.05, …)`) to keep physics sane across a stall. That
   * clamp means a device running at 8fps hands over 50ms exactly like one running at 20 —
   * so a readout built on it would have reported "20 fps" to every struggling tester and
   * quietly hidden the worst cases, which are the only ones worth having.
   */
  sample(_loopDeltaMs: number): void {
    if (!this.enabled) return;
    const now = performance.now();
    const frameMs = this.lastFrameAt === 0 ? 0 : now - this.lastFrameAt;
    this.lastFrameAt = now;
    // A tab regaining focus is not a frame; it would poison the worst-case for good.
    if (frameMs > 0 && frameMs < 400) {
      this.samples.push(frameMs);
      if (this.samples.length > SAMPLE_SIZE) this.samples.shift();
      if (frameMs > this.worst) this.worst = frameMs;
    }
    if (now - this.lastPaint < 500) return;   // the readout itself must not cost anything
    this.lastPaint = now;
    this.paint();
  }

  private stats() {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const source = this.read();
    return {
      fps: median > 0 ? Math.round(1000 / median) : 0,
      medianMs: +median.toFixed(1),
      p95Ms: +p95.toFixed(1),
      worstMs: +this.worst.toFixed(1),
      tier: source.qualityTier,
      pixelRatio: +source.pixelRatio.toFixed(2),
      drawCalls: source.drawCalls,
      triangles: source.triangles,
      lite: source.liteScene,
      gpu: this.gpu,
      // Fall back to the screen when the window reports nothing: an embedded or collapsed
      // view can hand back 0x0, and a readout that says "0x0" tells the devs nothing.
      screen: `${window.innerWidth || window.screen.width}x${window.innerHeight || window.screen.height}`
        + ` @${window.devicePixelRatio}`,
      cores: navigator.hardwareConcurrency ?? 0,
      memoryGb: (navigator as { deviceMemory?: number }).deviceMemory ?? 0,
      ua: navigator.userAgent,
    };
  }

  /** The whole readout as one line a tester can paste anywhere. */
  report(): string {
    const s = this.stats();
    return [
      `Markets & Makers frame report`,
      `${s.fps} fps (median ${s.medianMs}ms, p95 ${s.p95Ms}ms, worst ${s.worstMs}ms)`,
      `quality tier ${s.tier}/2, pixel ratio ${s.pixelRatio}${s.lite ? ", lite scene" : ""}`,
      `${s.drawCalls} draw calls, ${s.triangles.toLocaleString()} triangles`,
      `GPU: ${s.gpu}`,
      `screen ${s.screen}, ${s.cores} cores${s.memoryGb ? `, ${s.memoryGb}GB` : ""}`,
      s.ua,
    ].join("\n");
  }

  private paint(): void {
    if (!this.node) return;
    const s = this.stats();
    // Colour the number, so a tester who reads nothing else still reports the right thing.
    const tone = s.fps >= 50 ? "good" : s.fps >= 30 ? "warn" : "bad";
    this.node.innerHTML = `
      <div class="perf-fps tone-${tone}"><strong>${s.fps}</strong><small>fps</small></div>
      <dl>
        <div><dt>frame</dt><dd>${s.medianMs}ms · p95 ${s.p95Ms} · worst ${s.worstMs}</dd></div>
        <div><dt>quality</dt><dd>tier ${s.tier}/2 · ratio ${s.pixelRatio}${s.lite ? " · lite" : ""}</dd></div>
        <div><dt>drawing</dt><dd>${s.drawCalls} calls · ${s.triangles.toLocaleString()} tris</dd></div>
        <div><dt>gpu</dt><dd>${escapeHtml(s.gpu)}</dd></div>
        <div><dt>device</dt><dd>${s.screen} · ${s.cores} cores${s.memoryGb ? ` · ${s.memoryGb}GB` : ""}</dd></div>
      </dl>
      <button type="button" data-perf-copy>Copy this report</button>`;
    const copy = this.node.querySelector<HTMLButtonElement>("[data-perf-copy]");
    if (copy) {
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(this.report()); copy.textContent = "Copied — paste it to the devs"; }
        catch { copy.textContent = "Could not copy — screenshot this box instead"; }
        window.setTimeout(() => { copy.textContent = "Copy this report"; }, 2600);
      };
    }
  }
}

/** The real GPU behind the WebGL context, which is the single most useful field here. */
function readGpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "no webgl";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    // Browsers may mask this for fingerprinting reasons; the plain RENDERER is the fallback.
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name ?? "unknown");
  } catch {
    return "unknown";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
