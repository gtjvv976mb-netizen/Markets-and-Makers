import type { LicenseKey } from "./data";

export type ProductTier = 1 | 2 | 3;

export interface Product {
  id: string; name: string; business: LicenseKey; tier: ProductTier;
  /** 1-5 within its business: how far up that trade's own ladder it sits. */
  complexity: number;
  /** What it consumes, always from a LOWER tier — the chain only points downward. */
  inputs: Record<string, number>;
  labour: number; hours: number; price: number;
  buyer: "citizens" | "business";
}

export const TIER_NAMES: Record<ProductTier, string> = { 1: "Foundation", 2: "Industry", 3: "Enterprise" };

export const BUSINESS_TIER: Record<LicenseKey, ProductTier> = {
  aquaworks: 1, sungrid: 1, mine: 1, timberworks: 1, greenhouse: 1,
  cratemill: 2, workshop: 2, factory: 2, recycler: 2, shop: 2,
  construction: 3, freight: 3, restaurant: 3, gym: 3, cinema: 3,
};

/**
 * Five products per business, 75 in all.
 * Prices are derived from what each product CONSUMES plus the labour to make it, so
 * value is added at every step and no rung of the ladder is a loss-maker.
 */
export const PRODUCTS: Product[] = [
  { id: "aquaworks-rainwater-draw", name: "Rainwater Draw", business: "aquaworks", tier: 1, complexity: 1, inputs: {}, labour: 7, hours: 1.43, price: 18, buyer: "business" },
  { id: "aquaworks-filtered-water", name: "Filtered Water", business: "aquaworks", tier: 1, complexity: 2, inputs: {}, labour: 8, hours: 1.76, price: 27, buyer: "business" },
  { id: "aquaworks-mineral-water", name: "Mineral Water", business: "aquaworks", tier: 1, complexity: 3, inputs: {}, labour: 10, hours: 2.09, price: 35, buyer: "business" },
  { id: "aquaworks-steam-charge", name: "Steam Charge", business: "aquaworks", tier: 1, complexity: 4, inputs: {}, labour: 11, hours: 2.42, price: 43, buyer: "business" },
  { id: "aquaworks-hydrogel-reserve", name: "Hydrogel Reserve", business: "aquaworks", tier: 1, complexity: 5, inputs: {}, labour: 12, hours: 2.75, price: 52, buyer: "business" },
  { id: "sungrid-day-current", name: "Day Current", business: "sungrid", tier: 1, complexity: 1, inputs: {}, labour: 7, hours: 1.43, price: 18, buyer: "business" },
  { id: "sungrid-stored-charge", name: "Stored Charge", business: "sungrid", tier: 1, complexity: 2, inputs: {}, labour: 8, hours: 1.76, price: 27, buyer: "business" },
  { id: "sungrid-grid-balance", name: "Grid Balance", business: "sungrid", tier: 1, complexity: 3, inputs: {}, labour: 10, hours: 2.09, price: 35, buyer: "business" },
  { id: "sungrid-solar-cell", name: "Solar Cell", business: "sungrid", tier: 1, complexity: 4, inputs: {}, labour: 11, hours: 2.42, price: 43, buyer: "business" },
  { id: "sungrid-power-rail", name: "Power Rail", business: "sungrid", tier: 1, complexity: 5, inputs: {}, labour: 12, hours: 2.75, price: 52, buyer: "business" },
  { id: "mine-loose-rubble", name: "Loose Rubble", business: "mine", tier: 1, complexity: 1, inputs: {}, labour: 7, hours: 1.43, price: 18, buyer: "business" },
  { id: "mine-cut-stone", name: "Cut Stone", business: "mine", tier: 1, complexity: 2, inputs: {}, labour: 8, hours: 1.76, price: 27, buyer: "business" },
  { id: "mine-ore-concentrate", name: "Ore Concentrate", business: "mine", tier: 1, complexity: 3, inputs: {}, labour: 10, hours: 2.09, price: 35, buyer: "business" },
  { id: "mine-rare-earths", name: "Rare Earths", business: "mine", tier: 1, complexity: 4, inputs: {}, labour: 11, hours: 2.42, price: 43, buyer: "business" },
  { id: "mine-polished-aggregate", name: "Polished Aggregate", business: "mine", tier: 1, complexity: 5, inputs: {}, labour: 12, hours: 2.75, price: 52, buyer: "business" },
  { id: "timberworks-green-timber", name: "Green Timber", business: "timberworks", tier: 1, complexity: 1, inputs: {}, labour: 7, hours: 1.43, price: 18, buyer: "business" },
  { id: "timberworks-seasoned-plank", name: "Seasoned Plank", business: "timberworks", tier: 1, complexity: 2, inputs: {}, labour: 8, hours: 1.76, price: 27, buyer: "business" },
  { id: "timberworks-laminated-beam", name: "Laminated Beam", business: "timberworks", tier: 1, complexity: 3, inputs: {}, labour: 10, hours: 2.09, price: 35, buyer: "business" },
  { id: "timberworks-wood-fibre", name: "Wood Fibre", business: "timberworks", tier: 1, complexity: 4, inputs: {}, labour: 11, hours: 2.42, price: 43, buyer: "business" },
  { id: "timberworks-tree-resin", name: "Tree Resin", business: "timberworks", tier: 1, complexity: 5, inputs: {}, labour: 12, hours: 2.75, price: 52, buyer: "business" },
  { id: "greenhouse-leaf-greens", name: "Leaf Greens", business: "greenhouse", tier: 1, complexity: 1, inputs: {}, labour: 7, hours: 1.43, price: 18, buyer: "business" },
  { id: "greenhouse-root-harvest", name: "Root Harvest", business: "greenhouse", tier: 1, complexity: 2, inputs: {}, labour: 8, hours: 1.76, price: 27, buyer: "business" },
  { id: "greenhouse-grain-sheaf", name: "Grain Sheaf", business: "greenhouse", tier: 1, complexity: 3, inputs: {}, labour: 10, hours: 2.09, price: 35, buyer: "business" },
  { id: "greenhouse-seed-stock", name: "Seed Stock", business: "greenhouse", tier: 1, complexity: 4, inputs: {}, labour: 11, hours: 2.42, price: 43, buyer: "business" },
  { id: "greenhouse-bloom-nectar", name: "Bloom Nectar", business: "greenhouse", tier: 1, complexity: 5, inputs: {}, labour: 12, hours: 2.75, price: 52, buyer: "business" },
  { id: "cratemill-slat-crate", name: "Slat Crate", business: "cratemill", tier: 2, complexity: 1, inputs: { "aquaworks-rainwater-draw": 1, "mine-cut-stone": 1 }, labour: 14, hours: 2.08, price: 82, buyer: "business" },
  { id: "cratemill-sealed-crate", name: "Sealed Crate", business: "cratemill", tier: 2, complexity: 2, inputs: { "aquaworks-filtered-water": 1, "mine-ore-concentrate": 2 }, labour: 25, hours: 2.56, price: 169, buyer: "business" },
  { id: "cratemill-insulated-crate", name: "Insulated Crate", business: "cratemill", tier: 2, complexity: 3, inputs: { "aquaworks-mineral-water": 2, "mine-rare-earths": 2, "greenhouse-bloom-nectar": 2 }, labour: 60, hours: 3.04, price: 442, buyer: "business" },
  { id: "cratemill-pallet-rig", name: "Pallet Rig", business: "cratemill", tier: 2, complexity: 4, inputs: { "aquaworks-steam-charge": 2, "mine-polished-aggregate": 2, "greenhouse-bloom-nectar": 3 }, labour: 86, hours: 3.52, price: 597, buyer: "business" },
  { id: "cratemill-shipping-cradle", name: "Shipping Cradle", business: "cratemill", tier: 2, complexity: 5, inputs: { "aquaworks-hydrogel-reserve": 2, "mine-polished-aggregate": 3, "greenhouse-bloom-nectar": 3, "sungrid-power-rail": 3 }, labour: 149, hours: 4.0, price: 995, buyer: "business" },
  { id: "workshop-fixings", name: "Fixings", business: "workshop", tier: 2, complexity: 1, inputs: { "sungrid-day-current": 1, "timberworks-seasoned-plank": 1 }, labour: 14, hours: 2.08, price: 82, buyer: "business" },
  { id: "workshop-utility-part", name: "Utility Part", business: "workshop", tier: 2, complexity: 2, inputs: { "sungrid-stored-charge": 1, "timberworks-laminated-beam": 2 }, labour: 25, hours: 2.56, price: 169, buyer: "business" },
  { id: "workshop-precision-gear", name: "Precision Gear", business: "workshop", tier: 2, complexity: 3, inputs: { "sungrid-grid-balance": 2, "timberworks-wood-fibre": 2, "aquaworks-hydrogel-reserve": 2 }, labour: 60, hours: 3.04, price: 442, buyer: "business" },
  { id: "workshop-control-board", name: "Control Board", business: "workshop", tier: 2, complexity: 4, inputs: { "sungrid-solar-cell": 2, "timberworks-tree-resin": 2, "aquaworks-hydrogel-reserve": 3 }, labour: 86, hours: 3.52, price: 597, buyer: "business" },
  { id: "workshop-service-kit", name: "Service Kit", business: "workshop", tier: 2, complexity: 5, inputs: { "sungrid-power-rail": 2, "timberworks-tree-resin": 3, "aquaworks-hydrogel-reserve": 3, "mine-polished-aggregate": 3 }, labour: 149, hours: 4.0, price: 995, buyer: "business" },
  { id: "factory-frame-set", name: "Frame Set", business: "factory", tier: 2, complexity: 1, inputs: { "mine-loose-rubble": 1, "greenhouse-root-harvest": 1 }, labour: 14, hours: 2.08, price: 82, buyer: "business" },
  { id: "factory-pump-unit", name: "Pump Unit", business: "factory", tier: 2, complexity: 2, inputs: { "mine-cut-stone": 1, "greenhouse-grain-sheaf": 2 }, labour: 25, hours: 2.56, price: 169, buyer: "business" },
  { id: "factory-turbine-core", name: "Turbine Core", business: "factory", tier: 2, complexity: 3, inputs: { "mine-ore-concentrate": 2, "greenhouse-seed-stock": 2, "sungrid-power-rail": 2 }, labour: 60, hours: 3.04, price: 442, buyer: "business" },
  { id: "factory-assembly-rig", name: "Assembly Rig", business: "factory", tier: 2, complexity: 4, inputs: { "mine-rare-earths": 2, "greenhouse-bloom-nectar": 2, "sungrid-power-rail": 3 }, labour: 86, hours: 3.52, price: 597, buyer: "business" },
  { id: "factory-capital-engine", name: "Capital Engine", business: "factory", tier: 2, complexity: 5, inputs: { "mine-polished-aggregate": 2, "greenhouse-bloom-nectar": 3, "sungrid-power-rail": 3, "timberworks-tree-resin": 3 }, labour: 149, hours: 4.0, price: 995, buyer: "business" },
  { id: "recycler-sorted-scrap", name: "Sorted Scrap", business: "recycler", tier: 2, complexity: 1, inputs: { "timberworks-green-timber": 1, "aquaworks-filtered-water": 1 }, labour: 14, hours: 2.08, price: 82, buyer: "business" },
  { id: "recycler-recovered-alloy", name: "Recovered Alloy", business: "recycler", tier: 2, complexity: 2, inputs: { "timberworks-seasoned-plank": 1, "aquaworks-mineral-water": 2 }, labour: 25, hours: 2.56, price: 169, buyer: "business" },
  { id: "recycler-reclaimed-board", name: "Reclaimed Board", business: "recycler", tier: 2, complexity: 3, inputs: { "timberworks-laminated-beam": 2, "aquaworks-steam-charge": 2, "mine-polished-aggregate": 2 }, labour: 60, hours: 3.04, price: 442, buyer: "business" },
  { id: "recycler-compost-blend", name: "Compost Blend", business: "recycler", tier: 2, complexity: 4, inputs: { "timberworks-wood-fibre": 2, "aquaworks-hydrogel-reserve": 2, "mine-polished-aggregate": 3 }, labour: 86, hours: 3.52, price: 597, buyer: "business" },
  { id: "recycler-renewed-module", name: "Renewed Module", business: "recycler", tier: 2, complexity: 5, inputs: { "timberworks-tree-resin": 2, "aquaworks-hydrogel-reserve": 3, "mine-polished-aggregate": 3, "greenhouse-bloom-nectar": 3 }, labour: 149, hours: 4.0, price: 995, buyer: "business" },
  { id: "shop-daily-basket", name: "Daily Basket", business: "shop", tier: 2, complexity: 1, inputs: { "greenhouse-leaf-greens": 1, "sungrid-stored-charge": 1 }, labour: 14, hours: 2.08, price: 82, buyer: "business" },
  { id: "shop-prepared-meal", name: "Prepared Meal", business: "shop", tier: 2, complexity: 2, inputs: { "greenhouse-root-harvest": 1, "sungrid-grid-balance": 2 }, labour: 25, hours: 2.56, price: 169, buyer: "business" },
  { id: "shop-preserve-jar", name: "Preserve Jar", business: "shop", tier: 2, complexity: 3, inputs: { "greenhouse-grain-sheaf": 2, "sungrid-solar-cell": 2, "timberworks-tree-resin": 2 }, labour: 60, hours: 3.04, price: 442, buyer: "business" },
  { id: "shop-household-kit", name: "Household Kit", business: "shop", tier: 2, complexity: 4, inputs: { "greenhouse-seed-stock": 2, "sungrid-power-rail": 2, "timberworks-tree-resin": 3 }, labour: 86, hours: 3.52, price: 597, buyer: "business" },
  { id: "shop-gift-hamper", name: "Gift Hamper", business: "shop", tier: 2, complexity: 5, inputs: { "greenhouse-bloom-nectar": 2, "sungrid-power-rail": 3, "timberworks-tree-resin": 3, "aquaworks-hydrogel-reserve": 3 }, labour: 149, hours: 4.0, price: 995, buyer: "business" },
  { id: "construction-wall-module", name: "Wall Module", business: "construction", tier: 3, complexity: 1, inputs: { "cratemill-slat-crate": 1, "factory-pump-unit": 1 }, labour: 43, hours: 2.73, price: 406, buyer: "citizens" },
  { id: "construction-roof-canopy", name: "Roof Canopy", business: "construction", tier: 3, complexity: 2, inputs: { "cratemill-sealed-crate": 1, "factory-turbine-core": 2 }, labour: 185, hours: 3.36, price: 1709, buyer: "citizens" },
  { id: "construction-floor-deck", name: "Floor Deck", business: "construction", tier: 3, complexity: 3, inputs: { "cratemill-insulated-crate": 2, "factory-assembly-rig": 2, "shop-gift-hamper": 2 }, labour: 791, hours: 3.99, price: 6706, buyer: "citizens" },
  { id: "construction-utility-riser", name: "Utility Riser", business: "construction", tier: 3, complexity: 4, inputs: { "cratemill-pallet-rig": 2, "factory-capital-engine": 2, "shop-gift-hamper": 3 }, labour: 1343, hours: 4.62, price: 10367, buyer: "citizens" },
  { id: "construction-turnkey-shell", name: "Turnkey Shell", business: "construction", tier: 3, complexity: 5, inputs: { "cratemill-shipping-cradle": 2, "factory-capital-engine": 3, "shop-gift-hamper": 3, "workshop-service-kit": 3 }, labour: 2639, hours: 5.25, price: 18746, buyer: "citizens" },
  { id: "freight-local-run", name: "Local Run", business: "freight", tier: 3, complexity: 1, inputs: { "workshop-fixings": 1, "recycler-recovered-alloy": 1 }, labour: 43, hours: 2.73, price: 406, buyer: "citizens" },
  { id: "freight-island-run", name: "Island Run", business: "freight", tier: 3, complexity: 2, inputs: { "workshop-utility-part": 1, "recycler-reclaimed-board": 2 }, labour: 185, hours: 3.36, price: 1709, buyer: "citizens" },
  { id: "freight-cold-chain", name: "Cold Chain", business: "freight", tier: 3, complexity: 3, inputs: { "workshop-precision-gear": 2, "recycler-compost-blend": 2, "cratemill-shipping-cradle": 2 }, labour: 791, hours: 3.99, price: 6706, buyer: "citizens" },
  { id: "freight-bulk-charter", name: "Bulk Charter", business: "freight", tier: 3, complexity: 4, inputs: { "workshop-control-board": 2, "recycler-renewed-module": 2, "cratemill-shipping-cradle": 3 }, labour: 1343, hours: 4.62, price: 10367, buyer: "citizens" },
  { id: "freight-priority-courier", name: "Priority Courier", business: "freight", tier: 3, complexity: 5, inputs: { "workshop-service-kit": 2, "recycler-renewed-module": 3, "cratemill-shipping-cradle": 3, "factory-capital-engine": 3 }, labour: 2639, hours: 5.25, price: 18746, buyer: "citizens" },
  { id: "restaurant-street-plate", name: "Street Plate", business: "restaurant", tier: 3, complexity: 1, inputs: { "factory-frame-set": 1, "shop-prepared-meal": 1 }, labour: 43, hours: 2.73, price: 406, buyer: "citizens" },
  { id: "restaurant-set-lunch", name: "Set Lunch", business: "restaurant", tier: 3, complexity: 2, inputs: { "factory-pump-unit": 1, "shop-preserve-jar": 2 }, labour: 185, hours: 3.36, price: 1709, buyer: "citizens" },
  { id: "restaurant-feast-table", name: "Feast Table", business: "restaurant", tier: 3, complexity: 3, inputs: { "factory-turbine-core": 2, "shop-household-kit": 2, "workshop-service-kit": 2 }, labour: 791, hours: 3.99, price: 6706, buyer: "citizens" },
  { id: "restaurant-catering-run", name: "Catering Run", business: "restaurant", tier: 3, complexity: 4, inputs: { "factory-assembly-rig": 2, "shop-gift-hamper": 2, "workshop-service-kit": 3 }, labour: 1343, hours: 4.62, price: 10367, buyer: "citizens" },
  { id: "restaurant-tasting-menu", name: "Tasting Menu", business: "restaurant", tier: 3, complexity: 5, inputs: { "factory-capital-engine": 2, "shop-gift-hamper": 3, "workshop-service-kit": 3, "recycler-renewed-module": 3 }, labour: 2639, hours: 5.25, price: 18746, buyer: "citizens" },
  { id: "gym-day-pass", name: "Day Pass", business: "gym", tier: 3, complexity: 1, inputs: { "recycler-sorted-scrap": 1, "cratemill-sealed-crate": 1 }, labour: 43, hours: 2.73, price: 406, buyer: "citizens" },
  { id: "gym-class-block", name: "Class Block", business: "gym", tier: 3, complexity: 2, inputs: { "recycler-recovered-alloy": 1, "cratemill-insulated-crate": 2 }, labour: 185, hours: 3.36, price: 1709, buyer: "citizens" },
  { id: "gym-personal-coaching", name: "Personal Coaching", business: "gym", tier: 3, complexity: 3, inputs: { "recycler-reclaimed-board": 2, "cratemill-pallet-rig": 2, "factory-capital-engine": 2 }, labour: 791, hours: 3.99, price: 6706, buyer: "citizens" },
  { id: "gym-recovery-suite", name: "Recovery Suite", business: "gym", tier: 3, complexity: 4, inputs: { "recycler-compost-blend": 2, "cratemill-shipping-cradle": 2, "factory-capital-engine": 3 }, labour: 1343, hours: 4.62, price: 10367, buyer: "citizens" },
  { id: "gym-athlete-programme", name: "Athlete Programme", business: "gym", tier: 3, complexity: 5, inputs: { "recycler-renewed-module": 2, "cratemill-shipping-cradle": 3, "factory-capital-engine": 3, "shop-gift-hamper": 3 }, labour: 2639, hours: 5.25, price: 18746, buyer: "citizens" },
  { id: "cinema-matinee-seat", name: "Matinee Seat", business: "cinema", tier: 3, complexity: 1, inputs: { "shop-daily-basket": 1, "workshop-utility-part": 1 }, labour: 43, hours: 2.73, price: 406, buyer: "citizens" },
  { id: "cinema-evening-screening", name: "Evening Screening", business: "cinema", tier: 3, complexity: 2, inputs: { "shop-prepared-meal": 1, "workshop-precision-gear": 2 }, labour: 185, hours: 3.36, price: 1709, buyer: "citizens" },
  { id: "cinema-private-box", name: "Private Box", business: "cinema", tier: 3, complexity: 3, inputs: { "shop-preserve-jar": 2, "workshop-control-board": 2, "recycler-renewed-module": 2 }, labour: 791, hours: 3.99, price: 6706, buyer: "citizens" },
  { id: "cinema-premiere-night", name: "Premiere Night", business: "cinema", tier: 3, complexity: 4, inputs: { "shop-household-kit": 2, "workshop-service-kit": 2, "recycler-renewed-module": 3 }, labour: 1343, hours: 4.62, price: 10367, buyer: "citizens" },
  { id: "cinema-festival-pass", name: "Festival Pass", business: "cinema", tier: 3, complexity: 5, inputs: { "shop-gift-hamper": 2, "workshop-service-kit": 3, "recycler-renewed-module": 3, "cratemill-shipping-cradle": 3 }, labour: 2639, hours: 5.25, price: 18746, buyer: "citizens" },
];

export const PRODUCTS_BY_ID = new Map(PRODUCTS.map((entry) => [entry.id, entry]));

export function productsOf(business: LicenseKey): Product[] {
  return PRODUCTS.filter((entry) => entry.business === business);
}


/**
 * How many rungs of the ladder stand under a product.
 *
 * 0 for something made from nothing, 1 for something made from those, 2 for the top. Memoised,
 * and cycle-guarded so a future data edit that makes A need B and B need A cannot hang the game.
 */
const CHAIN_DEPTH = new Map<string, number>();
export function productChainDepth(productId: string, seen: ReadonlySet<string> = new Set()): number {
  const cached = CHAIN_DEPTH.get(productId);
  if (cached !== undefined) return cached;
  const product = PRODUCTS_BY_ID.get(productId);
  if (!product || seen.has(productId)) return 0;
  const inputs = Object.keys(product.inputs ?? {});
  if (!inputs.length) { CHAIN_DEPTH.set(productId, 0); return 0; }
  const guard = new Set(seen).add(productId);
  const depth = 1 + Math.max(...inputs.map((id) => productChainDepth(id, guard)));
  if (seen.size === 0) CHAIN_DEPTH.set(productId, depth);
  return depth;
}
