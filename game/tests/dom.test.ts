import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const main = readFileSync(resolve(root, "src/main.ts"), "utf8");

describe("markup contract", () => {
  it("every element() selector main.ts requires actually exists in index.html", () => {
    // element() throws on a missing node, which kills the whole app on first render —
    // and TypeScript cannot see it, because the selector is just a string.
    const required = new Set<string>();
    for (const match of main.matchAll(/element(?:<[^>]*>)?\(\s*"#([A-Za-z][\w-]*)"/g)) {
      required.add(match[1]!);
    }
    expect(required.size).toBeGreaterThan(5);

    const missing = [...required].filter((id) => !html.includes(`id="${id}"`));
    expect(missing, `main.ts requires ids that index.html does not define: ${missing.join(", ")}`).toEqual([]);
  });

  it("every tab button has a matching panel", () => {
    const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]!);
    const panels = new Set([...html.matchAll(/data-panel="([a-z]+)"/g)].map((m) => m[1]!));
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) expect(panels.has(tab), `tab "${tab}" has no panel`).toBe(true);
  });

  it("keeps the interface small enough to learn", () => {
    // The brief was: fewer tabs, less text. Guard both so it does not creep back.
    const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].length;
    expect(tabs).toBeLessThanOrEqual(3);

    const headerStats = [...html.matchAll(/<div[^>]*><small>[^<]+<\/small><strong id="\w+"/g)].length;
    expect(headerStats).toBeLessThanOrEqual(3);
  });
});
