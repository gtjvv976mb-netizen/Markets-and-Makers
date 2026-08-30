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
    const guided = styles.slice(styles.indexOf('.app-shell[data-guided="true"]'));
    const ids = new Set([...guided.matchAll(/#([A-Za-z][\w-]*)/g)].map((m) => m[1]!));
    expect(ids.size).toBeGreaterThan(3);
    expect([...ids].filter((id) => !html.includes(`id="${id}"`))).toEqual([]);
  });

  it("stops guiding when the Mayor is dismissed", () => {
    // One switch, not two. Her Hide button already means "stop guiding me".
    expect(main).toContain("!store.state.mayorHidden");
    expect(main).toContain('shell.dataset.guided');
  });
});
