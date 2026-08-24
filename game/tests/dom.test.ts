import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "../src/main.ts?raw";
import interior from "../src/interiorWorld.ts?raw";
import styles from "../src/style.css?raw";

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

  it("uses the official custom brand system instead of platform emoji navigation", () => {
    expect(html).toContain("/assets/brand/markets-makers-official.avif");
    expect(html).toContain("/assets/brand/mm-maker-crest.svg");
    expect(html).toContain('id="mm-icon-enterprise"');
    expect(html).toContain('id="mm-icon-exchange"');
    expect(html).toContain('id="mm-icon-world"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain("⌥1");
  });

  it("uses the Mercedonia canon and shows MERCS beside every visible Merc Dollar price", () => {
    const visibleSource = `${html}\n${main}\n${styles}`;
    expect(visibleSource).toContain("Mercedonia");
    expect(visibleSource).toContain("Mercedonians");
    expect(visibleSource).toContain("Merc Dollars");
    expect(visibleSource).toContain("MERCS");
    expect(visibleSource).not.toMatch(/Makropolis|Mercadonia|Mollars?|Maker Dollars?|Sunmarks?/i);
    expect(visibleSource).not.toMatch(/\b(?:MD|SM|MERC)\b/);
    expect(main).toContain("${row.nextUnit} ${CURRENCY_CODE}");
    expect(main).toContain("${store.marketBuyPrice(key)} ${CURRENCY_CODE}");
    expect(main).toContain("${store.marketSellPrice(key)} ${CURRENCY_CODE}");
    expect(main).toContain("${store.dailyPayroll()} ${CURRENCY_CODE}/day");
    expect(styles).not.toContain('content: " MERCS"');
  });

  it("keeps hidden sheets and interiors out of the focus order", () => {
    expect(html).toContain('id="sheet" data-open="false" aria-hidden="true" inert');
    expect(html).toContain('id="interiorModal" aria-hidden="true" role="dialog"');
    expect(main).toContain('sheet.setAttribute("inert", "")');
    expect(main).toContain('sheet.removeAttribute("inert")');
    expect(main).toContain("trapFocusWithin(interiorModal, event)");
    expect(main).toContain("trapFocusWithin(sheet, event)");
  });

  it("renders accessible, branded building banners above visible roofs", () => {
    expect(main).toContain('class="marker-building-icon"');
    expect(main).toContain('class="marker-building-copy"');
    expect(main).toContain('class="marker-building-status"');
    expect(main).toContain('class="marker-status-text"');
    expect(main).toContain('data-building-sign="true"');
    expect(main).toContain('data-building-state=');
    expect(main).toContain("aria-label=");
    expect(main).toContain("--sign-accent:");
    expect(main).toContain("y: model.y");
    expect(main).toContain("!point.onScreen");
    expect(main).toContain("m.title");
    expect(main).toContain("m.icon");
    expect(main).toContain("m.accent");
  });

  it("keeps the walkable equipment room functional across mouse, keyboard and touch", () => {
    expect(html).toContain('id="interiorCanvas"');
    expect(html).toContain('id="interiorPrompt"');
    expect(html).toContain('id="interiorInteract"');
    expect(html).toContain('data-interior-move="forward"');
    expect(main).toContain("interiorWorld.enter({");
    expect(main).toContain("store.purchaseUpgrade(key)");
    expect(main).toContain("store.upgradeCeiling()");
    expect(main).toContain("world.setInputEnabled(false)");
    expect(main).toContain("world.setInputEnabled(true)");
    expect(main).not.toContain('element("#interiorStage").innerHTML');
    expect(main).not.toContain("Math.min(3, level + 1)");
    expect(interior).toContain("INTERIOR_EQUIPMENT_CATALOG");
    expect(interior).toContain("station.blueprint.visible = level === 0");
    expect(interior).toContain("setMoveInput(direction");
  });
});
