import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/network", () => ({ serverBase: () => "https://realm.example" }));
vi.mock("../src/wallet", () => ({ sessionToken: () => null }));
vi.mock("../src/state", () => ({ isDemo: () => false }));

import { fetchDispatches, type CityDispatch } from "../src/realm";

const dispatch: CityDispatch = {
  headline: "Green freight lifts the quays",
  body: "Measured trade rose while the civic treasury remained steady.",
  mood: "thriving",
  publishedAt: "2026-08-28T00:00:00.000Z",
  snapshot: {
    businesses: 12,
    districts: ["Copperglass Terraces"],
    treasury: 840_000,
    citizensPurse: 96_000,
    makersHolding: 48_000,
    wagesPaidToday: 8_400,
    payrollToday: 5_200,
    worksSpendToday: 3_100,
    worksOutput: { part: 18 },
    soldToday: 44,
    grossToday: 9_600,
    busiestTrade: "Maker Workshop",
    quietestShelf: "Hydrogel Reserve",
  },
};

describe("city dispatch feed", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches the bounded public dispatch feed as JSON", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ dispatches: [dispatch] }) });

    await expect(fetchDispatches(999)).resolves.toEqual([dispatch]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://realm.example/api/world/dispatch?limit=30");
    expect(options.headers).toEqual({ Accept: "application/json" });
  });

  it("fails closed when the dispatch service refuses or cannot be reached", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchDispatches()).resolves.toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(fetchDispatches()).resolves.toBeNull();
  });
});
