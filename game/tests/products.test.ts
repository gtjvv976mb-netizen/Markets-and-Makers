import { describe, expect, it } from "vitest";
import { BUSINESS_TIER, PRODUCTS, PRODUCTS_BY_ID, productsOf } from "../src/products";
import { BUSINESS, type LicenseKey } from "../src/data";

describe("product chain", () => {
  it("gives every business exactly five products", () => {
    for (const licence of Object.keys(BUSINESS) as LicenseKey[]) {
      expect(productsOf(licence), `${licence} has the wrong product count`).toHaveLength(5);
    }
    expect(PRODUCTS).toHaveLength(75);
  });

  it("splits the fifteen trades evenly across three tiers", () => {
    const counts = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    for (const licence of Object.keys(BUSINESS) as LicenseKey[]) counts[BUSINESS_TIER[licence]] += 1;
    expect(counts).toEqual({ 1: 5, 2: 5, 3: 5 });
  });

  it("only ever depends downward, so the chain can never deadlock", () => {
    for (const product of PRODUCTS) {
      for (const inputId of Object.keys(product.inputs)) {
        const input = PRODUCTS_BY_ID.get(inputId);
        expect(input, `${product.id} needs ${inputId}, which does not exist`).toBeDefined();
        expect(input!.tier, `${product.id} (tier ${product.tier}) depends on same-or-higher tier ${inputId}`)
          .toBeLessThan(product.tier);
      }
    }
  });

  it("has no cycles, and every product is reachable from raw materials", () => {
    const resolved = new Set<string>();
    // Repeatedly admit anything whose inputs are all already resolved.
    for (let pass = 0; pass < 5; pass += 1) {
      for (const product of PRODUCTS) {
        if (resolved.has(product.id)) continue;
        if (Object.keys(product.inputs).every((id) => resolved.has(id))) resolved.add(product.id);
      }
    }
    const unreachable = PRODUCTS.filter((p) => !resolved.has(p.id)).map((p) => p.id);
    expect(unreachable, `unreachable products: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("prices every product above the cost of what it consumes", () => {
    // A product nobody can profit from is a dead branch of the tree.
    const thin: string[] = [];
    for (const product of PRODUCTS) {
      const inputCost = Object.entries(product.inputs)
        .reduce((total, [id, qty]) => total + (PRODUCTS_BY_ID.get(id)?.price ?? 0) * qty, 0);
      if (product.price <= inputCost + product.labour) thin.push(`${product.id} (${product.price} vs ${inputCost + product.labour})`);
    }
    expect(thin, `products that cannot turn a profit: ${thin.join(", ")}`).toEqual([]);
  });

  it("makes deeper products genuinely harder than shallow ones", () => {
    for (const licence of Object.keys(BUSINESS) as LicenseKey[]) {
      const ladder = productsOf(licence).sort((a, b) => a.complexity - b.complexity);
      for (let i = 1; i < ladder.length; i += 1) {
        expect(ladder[i]!.price).toBeGreaterThan(ladder[i - 1]!.price);
        expect(ladder[i]!.hours).toBeGreaterThan(ladder[i - 1]!.hours);
      }
    }
  });
});
