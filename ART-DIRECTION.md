# Markets & Makers — Official Visual and 3D Asset Standard

**Status:** APPROVED / production authority  
**Version:** 1.0  
**Approved:** 2026-08-24  
**Applies to:** world terrain, buildings, interiors, utilities, props, vehicles, avatars, VFX, UI illustration, marketing renders, and all replacement GLBs

## 1. Visual authority

The approved building designs in `art/official-v1` are the official visual authority for **Markets & Makers**. The downloadable modeling archive remains available at `outputs/markets-and-makers-business-modeling-references-v2-original-style.zip`, but the tracked `art/official-v1` library is canonical.

Use references in this order:

1. `art/official-v1/approved-originals/` establishes the collection-wide architectural language, palette, proportions, and detail density.
2. The matching `art/official-v1/turntables/*.png` sheet establishes each individual asset's approved identity and silhouette. Its top-left 0° front-right panel is the master modeling view.
3. The top-right 90° rear-right, bottom-left 180° rear-left, and bottom-right 270° front-left panels resolve the other façades and service equipment.
4. `art/official-v1/manifest.json` establishes the stable asset ID, exact 2 m footprint, axes, and approved source lineage.
5. This document governs all shared art and technical rules.

The immutable reference fingerprints are recorded in `art/official-v1/checksums.sha256`. Any deliberate replacement requires a new standard version and new checksums.

The current B01–B08 runtime GLBs are **temporary technical placeholders**. They may demonstrate scale, pivots, loading, and gameplay, but they do not override the approved concepts. Production GLBs supplied later must replace them progressively.

## 2. The official look

Markets & Makers is a warm, prosperous, readable solarpunk island world. Its technology is useful and understandable. Buildings visibly collect energy, circulate water, grow food, make products, receive deliveries, and welcome customers. It is optimistic without becoming sterile science fiction.

Every asset should feel:

- compact and handmade rather than monumental;
- clean and productive rather than industrially dirty;
- planted and inhabited rather than overgrown or abandoned;
- technologically capable without neon, holograms, or cyberpunk clutter;
- detailed enough to reward a close view while remaining legible at isometric gameplay scale.

## 3. Shared shape language

- One or two floors for ordinary businesses; a restrained third-height roof feature is allowed for civic landmarks.
- Rounded cream-stone corners, framed openings, soft arches, and chamfered tiled foundations.
- Honey timber beams, pergolas, railings, doors, window frames, and roof ribs.
- Teal metal, painted utility cabinets, glass, pipes, awnings, and equipment housings.
- Roofs carry the primary business identity: solar arrays, greenhouse arches, tanks, planted borders, skylights, or a single civic landmark.
- Use one clear hero feature per building. Avoid competing silhouettes or covering every surface with machinery.
- Preserve broad, quiet wall and roof areas. Target roughly 60–70% architecture, 15–25% functional equipment, and 10–20% planting/decor.
- Customer entrances face local `-Y`; loading and utility access should read on a side or rear face.
- Buildings must remain recognizable at 128–256 pixels tall.

## 4. Official palette and materials

| Role | Hex target | Typical use |
| --- | --- | --- |
| Warm cream | `#F0E4C7` | Stucco, ceramic, limestone body |
| Path limestone | `#CFC7AD` | Foundations, steps, public paving |
| Honey timber | `#A96934` | Frames, doors, beams, decks |
| Dark timber | `#5F3E29` | Undersides, joints, deep accents |
| Utility teal | `#267F82` | Doors, awnings, tanks, cabinets |
| Solar navy | `#287E9D` / `#365A78` | Photovoltaics and energy glass |
| Solar amber | `#E0AD3D` | Solar accents and civic energy cues |
| Glass aqua | `#73C9D2` | Windows, greenhouse and skylights |
| Brushed metal | `#70828A` | Pipes, rails, vents, fasteners |
| Terracotta | `#BF623C` | Workshops and manufacturing accents |
| Coral | `#DF7655` | Retail/hospitality awnings and seating |
| Leaf green | `#66A348` | Planters, roofs and living systems |
| Charcoal | `#30454A` | Deep recesses, roof membranes, machines |

Materials should read through form, bevel highlights, restrained roughness variation, and baked/vertex AO. Avoid noisy photoreal scans, high-frequency grunge, mirror chrome, black unlit faces, and unique 4K textures.

## 5. Business identity rules

| Business | Required hero cue |
| --- | --- |
| Tideglass AquaWorks | Twin purification tanks and visible clean-water treatment |
| Sunwell Microgrid | Alternating navy and amber solar roof with battery wall |
| Greenloom Greenhouse | Arched growhouse, visible crops, irrigation and packing bay |
| Stonewake Mine | Restrained rock portal, short ore conveyor and compact sorter |
| Timbercoast Works | Timber canopy, vertical stock rack and clean carpentry bay |
| Freight Crate Mill | Reusable-crate press, rollers and flat-pack storage |
| Maker Workshop | Terracotta workshop, roof skylight and service bay |
| Sunwoven Factory | Arched assembly hall and stepped solar sawtooth roof |
| Civic Construction Co. | Prefab rack, loading pergola and fixed compact gantry |
| Copper Quay Freight | Passenger/cargo terminal, timber deck and loading edge |
| Supply Shop & Café | Open-roof storefront, coral awning and visible retail counter |
| Sunset Market Kitchen | Coral awnings, dining terrace and rooftop herb kitchen |
| Harbor Gym | Rounded glass training floors and planted roof |
| Lantern Cinema | Lantern dome, warm entrance canopy and poster recesses |
| Tideglass Reclamation Hub | Circular sorting drum and clean material-recovery bay |

Public Market Pavilion remains the civic trade-language reference: open canopy, central planter, modular stalls, cream structure, timber counters, and coral/teal awnings.

## 6. Terrain and world extension

- The official structural inventory and Blender contract are defined in `art/official-v1/world-tiles-v1/README.md`; its logo reference and 50-piece manifest are production authority for the rebuilt world.
- The authoritative grid is 2 m per tile.
- Terrain uses chunky, chamfered tile edges: green cap, warm earth band, pale stone base.
- Main paths use cream limestone pavers with visible but restrained joints.
- Water is saturated turquoise with readable shallow/deep variation, never gray or photorealistically dark.
- Landscaping is clustered along shorelines, paths, roofs, and civic spaces; production lanes and plot entrances remain clear.
- Trees, shrubs, flowers, lamps, benches, cargo props, and planters reuse a small shared kit.
- Islands should look intentionally landscaped and economically active, not like wilderness biomes.

## 7. Interiors and upgrades

- A business interior is the inside of the same building, not a separate visual theme.
- Repeat exterior materials and colors indoors: cream walls, timber structure, teal equipment, terracotta/coral category accents, planted details, and warm light.
- Customer circulation, service circulation, storage, and utility clearance must be readable.
- Tier upgrades preserve the base silhouette and add capability visibly:
  - **Tier 1:** starter shell and one signature machine;
  - **Tier 2:** improved roof/service module, more storage, cleaner frontage;
  - **Tier 3:** premium materials, one footprint-preserving extension, additional productive equipment and stronger planting/lighting.
- Never replace an upgraded business with an unrelated building.

## 8. Props, vehicles, avatars, and UI

- Props use the same cream/timber/teal/terracotta/coral family and rounded construction.
- Vehicles are compact electric carts, cargo bikes, ferries, and service vehicles with visible cargo roles; no oversized cars or military silhouettes.
- Avatars use friendly stylized proportions, practical workwear, readable business-color accents, and the same material saturation.
- UI illustration, icons, loading art, store art, banners, and promotional images must depict these exact buildings and palette. Do not introduce a separate realistic, cyberpunk, medieval, or generic mobile-city style.
- UI chrome remains warm cream and deep teal with coral/gold highlights. It supports the world instead of competing with it.

## 9. Camera, presentation, and lighting

- Modeling/marketing master: orthographic isometric, 45° yaw and approximately 35.264° elevation.
- Gameplay supports four 90° rotations while keeping entrances and routes readable.
- Default light is warm late morning with soft contact shadows and a cool sky fill.
- No façade may fall to featureless black. Glass must remain transparent enough to communicate function without noisy refraction.
- Studio turntables use a neutral warm-gray background and show the full foundation without cropping.

## 10. Production GLB contract

- **Coordinates:** meters; Blender source uses `+Z` up and customer front `-Y`. Exported glTF/GLB uses `+Y` up and customer front `+Z`, matching the Three.js runtime.
- **Grid:** structural placement in 2 m increments; interiors may use a 0.5 m sub-grid.
- **Origin:** bottom center of the legal footprint at ground level.
- **Front:** customer entrance points local `-Y` in Blender and local `+Z` after glTF axis conversion.
- **Transforms:** applied; scale `(1,1,1)`; no negative scale.
- **Stable asset ID:** `mm_biz_<license>_v1`, exactly as declared in `art/official-v1/manifest.json`; this is the persistent catalog/save identifier and does not contain an LOD suffix.
- **GLB filename:** `<asset_id>_lod0.glb`, with optional sibling `<asset_id>_lod1.glb` and `<asset_id>_lod2.glb`.
- **Root node:** `<ASSET_ID>_LOD0` in uppercase snake case; collision `COL_<LICENSE>_*`; sockets `SOCKET_CUSTOMER`, `SOCKET_SERVICE`, `SOCKET_POWER`, `SOCKET_WATER`, `SOCKET_INPUT`, `SOCKET_OUTPUT` as applicable.
- **LOD:** LOD0 retains the approved silhouette; LOD1 is approximately 45–55% of LOD0; LOD2 is approximately 10–18% and preserves the roof cue.
- **Collision:** simple boxes/capsules/convex hulls; never render-mesh collision.
- **Animation:** keep doors, fans, water, conveyors, solar trackers, screens, and machinery as separable named nodes when they animate.
- **Materials:** shared master families; target 1–4 visible material primitives per standard building.
- **Textures:** shared 1024–2048 atlases, KTX2 at runtime; no unique 4K building textures.
- **Standard building target:** 12k–30k LOD0 triangles, up to 4 draw calls, compressed GLB target below 1.5 MB and hard cap 3 MB.
- **Large factory/civic landmark:** up to 45k LOD0 triangles, up to 6 draw calls, compressed GLB hard cap 4 MB.
- **Collider budget:** no more than 12 simple primitives for a standard building or 18 for a landmark.

## 11. Submission package for each replacement GLB

Provide one folder per asset:

```text
<business-id>/
  model/<asset>.blend
  model/<asset>.glb
  previews/front_right.png
  previews/rear_right.png
  previews/rear_left.png
  previews/front_left.png
  manifest.json
```

The manifest records footprint, triangle counts, material counts, texture dimensions, LODs, sockets, animations, SHA-256, and Blender version.

## 12. Approval checklist

An asset passes only when all answers are **yes**:

- Does it clearly match the approved reference at first glance?
- Is its footprint and entrance orientation correct?
- Is the business purpose readable without text?
- Does it use the official form, palette, planting, and detail density?
- Does it avoid oversized massing, industrial clutter, neon, grime, and random sci-fi parts?
- Are customer, service, and utility faces readable?
- Does it work from all four camera rotations?
- Are transforms, pivots, sockets, LODs, materials, collision, and file budgets valid?
- Does it remain readable at 128–256 pixels tall?
- Does it load within the lite-browser performance budget?

If any answer is no, the asset is a draft and must not replace an official runtime model.

## 13. Change control

This standard is intentionally versioned. New art may extend it, but may not silently change the palette, proportions, camera, density, or architectural language. A deliberate visual-direction change requires a new approved reference set and a new version of this document.
