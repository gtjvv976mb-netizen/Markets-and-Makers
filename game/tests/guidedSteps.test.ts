import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "../src/main.ts?raw";
import styles from "../src/style.css?inline";
import { TUTORIAL } from "../src/data";

/** The `show` token lists, read out of STEP_ACTION as written. */
const steps = new Map<string, string[]>();
for (const m of main.matchAll(/^\s{2}(\w+):\s*\{\s*tab:.*?show:\s*\[([^\]]*)\]/gm)) {
  steps.set(m[1]!, [...m[2]!.matchAll(/"([^"]+)"/g)].map((t) => t[1]!));
}

describe("the guided first run", () => {
  it("gives every tutorial step a plan for what to show", () => {
    expect(steps.size).toBe(TUTORIAL.length);
    for (const [key] of TUTORIAL) expect(steps.has(key), `no STEP_ACTION.show for "${key}"`).toBe(true);
  });

  it("opens on the world alone", () => {
    // Step one is "click the ground to walk". Three desks and six panels on that same
    // screen is the thing this replaced.
    expect(steps.get("moved")).toEqual([]);
  });

  it("never takes a region away again once a step has revealed it", () => {
    // Going backwards would read as the interface breaking, not as focus.
    const order = TUTORIAL.map(([key]) => key as string);
    let seen: string[] = [];
    for (const key of order) {
      const now = steps.get(key) ?? [];
      // "build" is the one deliberate exception: the build panel is finished with once
      // the business exists, and its step is behind you.
      const dropped = seen.filter((t) => !now.includes(t) && t !== "build");
      expect(dropped, `step "${key}" takes back ${dropped.join(", ")}`).toEqual([]);
      seen = now;
    }
  });

  it("hides a region for every token it can reveal, and no token is a typo", () => {
    // A token with no rule silently reveals nothing; a rule with no token silently hides
    // a panel forever. Neither is visible from outside the code.
    const used = new Set([...steps.values()].flat());
    const ruled = new Set([...styles.matchAll(/\[data-show~="([^"]+)"\]/g)].map((m) => m[1]!));
    expect([...used].filter((t) => !ruled.has(t)), "tokens with no CSS rule").toEqual([]);
    expect([...ruled].filter((t) => !used.has(t)), "CSS rules no step can trigger").toEqual([]);
  });

  it("only gates regions that exist in the markup", () => {
    // Only ids named INSIDE a guided rule. Slicing to end-of-file swept in every later
    // rule in the stylesheet, including ones for markup built at runtime.
    const guidedRules = styles.split("}").filter((rule) => rule.includes("data-guided"));
    const ids = new Set(guidedRules.flatMap((rule) =>
      [...(rule.split("{")[0] ?? "").matchAll(/#([A-Za-z][\w-]*)/g)].map((m) => m[1]!)));
    expect(ids.size).toBeGreaterThan(3);
    expect([...ids].filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
  });

  it("never hides the player's money, at any step", () => {
    // A stated requirement: MERCS and the $MM balance stay on screen the whole way
    // through. It currently holds by accident — no rule happens to name them — so this
    // is what makes it hold on purpose the next time these rules are edited.
    // Only rules that ACTUALLY gate on the guide. Slicing to end-of-file swept in later,
    // unrelated rules and made this fail on a global compaction that hides a subtitle.
    const selectors = styles
      .split("}")
      .filter((rule) => /display:\s*none/.test(rule) && rule.includes("data-guided"))
      .map((rule) => rule.split("{")[0] ?? "")
      .join(" ");
    expect(selectors, "no guided hide rules found — has the mechanism moved?").toContain("data-guided");
    for (const vital of ["hud-vitals", "hudVitals", "wallet-slot", "walletSlot"]) {
      expect(selectors, `a guided rule hides ${vital}`).not.toContain(vital);
    }
    expect(html).toContain('id="hudVitals"');
  });

  it("can actually be hidden, and goes away when the guide is done", () => {
    // renderTutorial sets `element("#nextStep").hidden`, but `.next-step` sets
    // `display: grid` and an author rule beats the browser's `[hidden] { display: none }`.
    // Without a guard the Hide button set a property and changed nothing on screen — and
    // so did finishing the tutorial, which sets the same flag.
    expect(main).toContain('element("#nextStep").hidden = hidden;');
    expect(styles).toMatch(/\.next-step\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it("guards every element it hides with a display rule", () => {
    // The class of bug above, for the whole HUD: anything toggled through `.hidden` needs
    // a `[hidden]` rule if its own class sets a display, or the toggle is inert.
    const toggled = new Set([...main.matchAll(/element(?:<[^>]*>)?\("#([A-Za-z][\w-]*)"\)\.hidden\s*=/g)].map((m) => m[1]!));
    expect(toggled.size).toBeGreaterThan(0);
    const unguarded: string[] = [];
    for (const id of toggled) {
      // Which class does the markup give it? Only classed elements can carry a display rule.
      const tag = new RegExp(`id="${id}"[^>]*class="([^"]+)"|class="([^"]+)"[^>]*id="${id}"`).exec(html);
      const classes = (tag?.[1] ?? tag?.[2] ?? "").split(/\s+/).filter(Boolean);
      for (const cls of classes) {
        const setsDisplay = new RegExp(`\\.${cls}\\s*\\{[^}]*display:`).test(styles);
        const guarded = new RegExp(`\\.${cls}\\[hidden\\]`).test(styles)
          || new RegExp(`#${id}\\[hidden\\]`).test(styles);
        if (setsDisplay && !guarded) unguarded.push(`#${id} (.${cls})`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("stops guiding when the Mayor is dismissed", () => {
    // One switch, not two. Her Hide button already means "stop guiding me".
    expect(main).toContain("!store.state.mayorHidden");
    expect(main).toContain('shell.dataset.guided');
  });
});
