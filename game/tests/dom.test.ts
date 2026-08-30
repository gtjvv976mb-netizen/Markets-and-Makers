import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "../src/main.ts?raw";
import interior from "../src/interiorWorld.ts?raw";
import styles from "../src/style.css?inline";
import turntable from "../src/businessTurntable.ts?raw";
import data from "../src/data.ts?raw";
import state from "../src/state.ts?raw";

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

  it("keeps the minimalist HUD closed, labelled, and clear of the mobile playfield", () => {
    const rail = html.match(/<nav class="hud-utility-rail"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(rail.match(/<button/g) ?? []).toHaveLength(3);
    expect(rail).toContain('data-utility="news" aria-label="News"');
    expect(rail).toContain('data-utility="bank" aria-label="Bank"');
    expect(rail).toContain('data-action="info-open" aria-label="Info"');

    expect(html).toContain('id="hudUtilityDrawer" data-open="false" aria-hidden="true" inert');
    expect(html).toContain('id="hudBusinessDrawer" data-open="false" aria-hidden="true" inert');
    expect(html).toContain('aria-controls="hudUtilityDrawer"');
    expect(html).toContain('aria-controls="hudBusinessDrawer"');
    expect(html).toContain('id="onlinePill"');
    expect(html).toContain('id="hudVitals"');
    expect(html).toContain('id="walletSlot"');

    expect(main).toContain('drawer.removeAttribute("inert")');
    expect(main).toContain('drawer.setAttribute("inert", "")');
    expect(main).toContain("const activeBeforeClose = document.activeElement");
    expect(main).toContain('document.body.classList.toggle("hud-drawer-open"');
  });

  it("exposes live balances, an exact-model business dossier, civic news, and the bank", () => {
    expect(main).toContain("const total = peerCount + 1");
    expect(main).not.toContain("districtShopCount + 1");
    expect(main).toContain("<small>MERCS</small>");
    // "$MM earned" now, to tell it apart from the real balance in the player's wallet —
    // two different things that were both just called $MM.
    expect(main).toContain("<small>$MM earned</small>");

    for (const label of [
      "Production",
      "Product inventory",
      "Inputs / cycle",
      "Labour / cycle",
      "Utilities / day",
      "Company payroll / day",
      "Expected revenue",
      "Estimated cycle margin",
      "Recorded company net today",
      "Upgrades",
    ]) expect(main).toContain(label);

    expect(main).toContain("store.productsMade()");
    expect(main).toContain("store.dailyUtilityBill()");
    expect(main).toContain("store.dailyPayroll()");
    expect(main).toContain("store.todayProfit()");
    expect(html).toContain('id="businessTurntable"');
    expect(main).toContain("businessTurntable.setBusiness(licence)");
    expect(turntable).toContain("proceduralSceneFor(config.model)");
    expect(turntable).toContain('powerPreference: "low-power"');
    expect(turntable).toContain("private license: LicenseKey | null | undefined");

    expect(main).toContain("dispatches = await fetchDispatches(7)");
    expect(main).toContain("escapeMarkup(lead!.headline)");
    expect(main).toContain("escapeMarkup(lead!.body)");
    expect(main).toContain("AI-written from measured city ledger figures");
    // The bank takes what the player actually holds, within the epoch's issuance cap —
    // not a hard-coded hundred, which was refused if you held less and needed pressing
    // four hundred times if you held more.
    expect(main).toContain("exchangeMMForMercDollars(convertibleMM())");
    expect(main).toContain("Math.floor(store.issuanceHeadroom() / perUnit)");
    expect(main).toContain("exchangeMercDollarsForMM(1000)");
    expect(main).toContain('action === "info-open"');
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
    expect(html).toContain('id="interiorRoomLabel"');
    expect(html).toContain('id="interiorObjectiveTitle"');
    expect(html).toContain('id="interiorObjectiveCopy"');
    expect(html).toContain('id="interiorSystem"');
    // The on-screen arrow pad and the WASD/E/Esc chips were removed at the owner's request
    // ("remove the control buttons"). Touch players still walk by tapping the floor — the
    // canvas click-to-walk path — so the contract is now that the pad stays GONE and the
    // canvas remains the input surface.
    expect(html, "the touch arrow pad stays removed").not.toContain("data-interior-move");
    expect(html, "the key-hint chips stay removed").not.toContain("interior-help");
    expect(main).toContain("interiorWorld.enter({");
    expect(main).toContain("store.purchaseUpgrade(key)");
    expect(main).toContain("store.upgradeCeiling()");
    expect(main).toContain("world.setInputEnabled(false)");
    expect(main).toContain("world.setInputEnabled(true)");
    expect(main).not.toContain('element("#interiorStage").innerHTML');
    expect(main).not.toContain("Math.min(3, level + 1)");
    expect(interior).toContain("INTERIOR_EQUIPMENT_CATALOG");
    // The level-0 blueprint was the "hologram on the floor" the owner ordered removed, and
    // the rebuilt interior has no such concept left to switch off: an unbought machine is
    // simply not built into the scene. The contract is the ABSENCE, plus the rule that
    // replaced it.
    expect(interior).toContain("station.root.visible = level > 0");
    // Not a bare "blueprint" search: that word is also the construction studio's wall
    // motif, which is a legitimate painting on a wall. What must never return is a ghost
    // MACHINE standing on the floor for something nobody bought.
    expect(interior, "no ghost machines may return").not.toContain("station.blueprint");
    expect(interior, "unbought machines get no collider").toContain("not bought is not there");
    expect(interior).toContain("setMoveInput(direction");
  });

  it("identifies every rebuilt room as a Mercedonian enterprise with its own living system", () => {
    expect(html).toContain("Mercedonian enterprise interior");
    expect(html).toContain('aria-describedby="interiorObjectiveCopy"');
    expect(main).toContain("INTERIOR_ROOMS[license]");
    expect(main).toContain("room.displayName");
    expect(main).toContain("room.description");
    expect(main).toContain("room.regenerativeSystem");
    expect(main).toContain('interiorModal.dataset.architecture = room.architecture');
    expect(main).toContain('interiorModal.style.setProperty("--interior-accent", roomAccent)');
    // The right-hand panel used to be an EMPTY STATE — a centred icon and a line of copy
    // ("...your Mercedonian will walk to it before purchasing") shown for as long as nobody
    // was standing at a machine, which is most of the time anyone spends in the room. That
    // copy is gone because the panel is no longer empty: it reads the floor out.
    // The panel became the BUILD TRAY: closed by default so the room runs edge to edge, a
    // Build button opens it, and every row starts a drag-place onto the floor.
    expect(main).toContain('class="interior-tray"');
    expect(main).toContain("interior-floor-row");
    expect(html).toContain('data-action="interior-build"');
    expect(html, "the tray starts closed").not.toContain('interior-aside-toggle');
    expect(main).not.toContain("interior-console-empty");
    expect(html, "the first paint must not show the old placeholder either")
      .not.toContain("Shape your Mercedonian enterprise");
    expect(main).not.toContain("your Maker will walk");
  });

  it("calls people Mercedonians while preserving the Markets & Makers brand", () => {
    expect(html).toContain("Markets &amp; Makers");
    expect(main).toContain('label: "Mercedonian"');
    expect(main).toContain("Mercedonian market");
    expect(main).toContain("Demo Mercedonian");
    expect(main).toContain('total === 1 ? "Mercedonian" : "Mercedonians"');
    expect(data).toContain('name: "New Mercedonian"');
    expect(data).toContain("your Mercedonian will head there");
    expect(state).toContain("Bought from a Mercedonian");
    expect(main).not.toMatch(/Maker market|Demo Maker|maker · (?:private|local)|Other makers here/);
  });
});

describe("the boot catch-up waits for the world's owner", () => {
  /**
   * A source assertion, because the bug is an ORDERING one and the thing that hid it was a
   * comment claiming the order was already right.
   *
   * refreshWorldOwner is asynchronous and worldOwner starts null, so any catchUp() that
   * runs before it resolves sees worldRunsOnServer() === false and settles a night the
   * authority's tick has already paid for. The player is credited twice and the away
   * report shows the doubled figure.
   */
  it("does not settle a shift before refreshWorldOwner has answered", () => {
    const boot = main.indexOf("void refreshWorldOwner()");
    expect(boot).toBeGreaterThan(-1);
    // Only a TOP-LEVEL call is the bug: one at column 0 runs during boot, before the
    // answer arrives. The identical call inside the visibilitychange listener is fine —
    // that fires when a player returns to the tab, long after the owner is known.
    const before = main.slice(0, boot);
    const topLevel = before.match(/^showAwayReport\(store\.catchUp\(\)\);/m) ?? [];
    expect(topLevel).toHaveLength(0);
  });

  it("settles the boot shift inside the refreshWorldOwner callback", () => {
    const boot = main.indexOf("void refreshWorldOwner()");
    const tail = main.slice(boot, boot + 900);
    expect(tail).toContain("showAwayReport(store.catchUp())");
  });
});

describe("the Mayor is actually on screen", () => {
  /**
   * The onboarding was written, rendered and shown to nobody.
   *
   * #nextStep lived inside .hud-internal-data — `display: none !important` and
   * aria-hidden="true" — so every render wrote Perenna Vale's name, the step counter, what
   * she says and the reason underneath it into a box the stylesheet had switched off. The
   * renderer was complete and correct the whole time, which is why nothing looked broken.
   */
  it("does not render the first-run guidance inside the hidden data sheet", () => {
    const start = html.indexOf('class="hud-internal-data"');
    expect(start).toBeGreaterThan(-1);
    const sheet = html.slice(start, html.indexOf("</div>", html.indexOf("<nav", start)));
    expect(sheet).not.toContain('id="nextStep"');
    expect(sheet).not.toContain('id="mayorRecall"');
  });

  it("gives the card the class its own stylesheet targets", () => {
    // Unhiding it is not enough: .next-step carries the whole card design and #nextStep
    // carried no class at all, so it would have arrived on screen unstyled.
    const card = html.match(/<div class="([^"]*)" id="nextStep"/);
    expect(card).not.toBeNull();
    expect(card![1]).toContain("next-step");
  });

  it("keeps every element the renderer writes into", () => {
    // Moving markup is exactly how a renderer starts throwing on a null element.
    for (const id of ["nextLabel", "nextTitle", "nextHint", "nextBecause",
                      "nextGo", "nextDismiss", "nextMeter", "mayorRecall"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});
