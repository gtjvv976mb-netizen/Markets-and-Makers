import type { LicenseKey } from "./data";

export const ART_STANDARD_VERSION = "1.0";

export const OFFICIAL_PALETTE = {
  cream: "#f0e4c7",
  pathStone: "#cfc7ad",
  timber: "#a96934",
  timberDark: "#5f3e29",
  teal: "#267f82",
  solarNavy: "#287e9d",
  solarAmber: "#e0ad3d",
  glassAqua: "#73c9d2",
  metal: "#70828a",
  terracotta: "#bf623c",
  coral: "#df7655",
  leaf: "#66a348",
  charcoal: "#30454a",
  water: "#21b8c4",
} as const;

export const SOLARPUNK_MATERIALS: Readonly<Record<string, string>> = {
  MAT_TERRAIN_GRASS_SAGE: "#73a83f",
  MAT_TERRAIN_GRASS_DRY: "#b39b49",
  MAT_TERRAIN_SAND: "#dec98f",
  MAT_TERRAIN_LIMESTONE: "#d9caa0",
  MAT_TERRAIN_CLIFF: "#8e6c4d",
  MAT_TERRAIN_PATH: "#d0b786",
  MAT_TERRAIN_GRAVEL: "#77796d",
  MAT_TERRAIN_ROCK: "#686d65",
  MAT_TERRAIN_TERRACOTTA: "#c96f3c",
  MAT_TERRAIN_TIMBER: "#a96f38",
  MAT_TERRAIN_TIMBER_DARK: "#5f402c",
  MAT_WATER_SHALLOW: "#16afc2",
  MAT_MM_STONE: OFFICIAL_PALETTE.pathStone,
  MAT_MM_CREAM: OFFICIAL_PALETTE.cream,
  MAT_MM_TIMBER: OFFICIAL_PALETTE.timber,
  MAT_MM_TIMBER_DARK: OFFICIAL_PALETTE.timberDark,
  MAT_MM_TEAL: OFFICIAL_PALETTE.teal,
  MAT_MM_GLASS: OFFICIAL_PALETTE.glassAqua,
  MAT_MM_METAL: OFFICIAL_PALETTE.metal,
  MAT_MM_CHARCOAL: OFFICIAL_PALETTE.charcoal,
  MAT_MM_GREEN: OFFICIAL_PALETTE.leaf,
  MAT_MM_SOIL: "#4f3829",
  MAT_MM_CORAL: OFFICIAL_PALETTE.coral,
  MAT_MM_OCEAN_BLUE: OFFICIAL_PALETTE.solarNavy,
  MAT_MM_MUSTARD: OFFICIAL_PALETTE.solarAmber,
  MAT_MM_WATER: OFFICIAL_PALETTE.water,
  MAT_MM_TERRACOTTA: OFFICIAL_PALETTE.terracotta,
};

export const OFFICIAL_PRESENTATION_CAMERA = {
  projection: "orthographic",
  yawDegrees: 45,
  elevationDegrees: 35.264,
} as const;

interface OfficialBusinessArtSpec {
  assetId: string;
  footprintTiles: readonly [number, number];
  reference: string;
}

export const OFFICIAL_BUSINESS_ART = {
  aquaworks: { assetId: "mm_biz_aquaworks_v1", footprintTiles: [6, 6], reference: "01-aquaworks.png" },
  sungrid: { assetId: "mm_biz_sungrid_v1", footprintTiles: [6, 6], reference: "02-sungrid.png" },
  greenhouse: { assetId: "mm_biz_greenhouse_v1", footprintTiles: [6, 8], reference: "03-greenhouse.png" },
  mine: { assetId: "mm_biz_mine_v1", footprintTiles: [6, 6], reference: "04-mine.png" },
  timberworks: { assetId: "mm_biz_timberworks_v1", footprintTiles: [6, 6], reference: "05-timberworks.png" },
  cratemill: { assetId: "mm_biz_cratemill_v1", footprintTiles: [6, 6], reference: "06-crate-mill.png" },
  workshop: { assetId: "mm_biz_workshop_v1", footprintTiles: [6, 6], reference: "07-maker-workshop.png" },
  factory: { assetId: "mm_biz_factory_v1", footprintTiles: [8, 8], reference: "08-sunwoven-factory.png" },
  construction: { assetId: "mm_biz_construction_v1", footprintTiles: [8, 6], reference: "09-civic-construction.png" },
  freight: { assetId: "mm_biz_freight_v1", footprintTiles: [8, 6], reference: "10-copper-quay-freight.png" },
  shop: { assetId: "mm_biz_shop_v1", footprintTiles: [4, 4], reference: "11-supply-shop-cafe.png" },
  restaurant: { assetId: "mm_biz_restaurant_v1", footprintTiles: [6, 6], reference: "12-sunset-market-kitchen.png" },
  gym: { assetId: "mm_biz_gym_v1", footprintTiles: [6, 6], reference: "13-harbor-gym.png" },
  cinema: { assetId: "mm_biz_cinema_v1", footprintTiles: [8, 6], reference: "14-lantern-cinema.png" },
  recycler: { assetId: "mm_biz_recycler_v1", footprintTiles: [6, 6], reference: "15-reclamation-hub.png" },
} as const satisfies Record<LicenseKey, OfficialBusinessArtSpec>;
