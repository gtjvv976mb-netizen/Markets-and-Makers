import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "../src/main.ts?raw";

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

  it("every routed target has a panel to show", () => {
    // The world routes navigation now, so targets come from data-target rather than tabs.
    const targets = new Set([...main.matchAll(/data-target="([a-z]+)"/g)].map((m) => m[1]!));
    const panels = new Set([...html.matchAll(/data-panel="([a-z]+)"/g)].map((m) => m[1]!));
    expect(panels.size).toBeGreaterThan(0);
    for (const target of targets) {
      expect(panels.has(target), `"${target}" is routed to but has no panel`).toBe(true);
    }
  });

  it("keeps the interface small enough to learn", () => {
    // The brief was: fewer tabs, less text. Guard both so it does not creep back.
    const headerStats = [...html.matchAll(/<div[^>]*><small>[^<]+<\/small><strong id="\w+"/g)].length;
    expect(headerStats).toBeLessThanOrEqual(3);
  });

  it("renders accessible, branded building banners above visible roofs", () => {
    expect(main).toContain('class="marker-emblem"');
    expect(main).toContain("aria-label=");
    expect(main).toContain("--sign-accent:");
    expect(main).toContain("y: model.y");
    expect(main).toContain("!point.onScreen");
    expect(main).toContain("m.title");
    expect(main).toContain("m.icon");
    expect(main).toContain("m.accent");
  });
});
