# Markets & Makers — Official Logo-World Tile Modeling Kit v1

**Status:** official 3D terrain kit approved
**Visual authority:** `reference/official-logo-world.png`
**Target:** reproduce the full solarpunk island world behind the Markets & Makers logo, not merely a graybox.

## Approved v4 deliverable

- Editable Blender source, 50 individual GLBs, 50 modeling previews, catalogs, textures, manifests, and QA: `outputs/markets-and-makers-logo-world-tiles-v4/`
- Complete archive: `outputs/markets-and-makers-logo-world-tiles-v4.zip`
- Browser/runtime archive: `outputs/markets-and-makers-logo-world-tiles-v4-runtime-lite.zip`
- Technical QA: **PASS — 836/836 checks, 0 errors, 0 warnings**
- Visual art-direction review: **APPROVED**

The logo is now the binding material, palette, silhouette, coastline, paving, water, timber, and landscaping reference for this terrain system.

## The correct system

Build the world from four reusable layers:

1. structural land, coast, canal, path, plot, bridge, and dock pieces;
2. nine shared surface appearances;
3. thin reusable overlays such as foam, plot lines, moss, and wear;
4. separately instanced trees, flowers, planters, lights, fences, and street props.

Do not model every grass/path/cliff combination as a different complete block. The official archive contains **50 structural source pieces**, rotated in 90° steps, plus material skins and props. This is enough to build every island and district in the logo style without hundreds of duplicated models.

## World datum and grid

| Rule | Official value |
| --- | --- |
| Blender units | Metric; 1 unit = 1 m |
| Standard cell | Exactly `2.000 × 2.000 m` |
| Source axes | `+X` east, `+Y` north, `+Z` up |
| glTF axes | `+X` east, `-Z` north, `+Y` up |
| Tile root | XY center at world/sea datum `(0,0,0)` |
| Level-0 walk surface | `Z=+1.000 m` |
| Level-1 terrace | `Z=+2.000 m` |
| Ocean water | `Z=-0.180 m` |
| Shallow civic canal surface | `Z=+0.680 m` visual surface inside the lined canal cut |
| Terrain bottom | approximately `Z=-0.280 m` |
| Canonical direction | Single route connection faces north `+Y`; exposed coast faces south `-Y` |
| Runtime rotation | `0°, 90°, 180°, 270°` only |
| Transforms | Applied; scale `1,1,1`; no negative scale |

The logo's visible island side should read as three values, with pale masonry visually dominant:

- three pale limestone/stone courses from roughly `Z=-0.28` to `0.72`;
- a restrained warm-earth band from roughly `Z=0.72` to `0.90`;
- a thin living grass cap from roughly `Z=0.90` to `1.00`.

Shared tile borders must remain mathematically exact. Bevel only exposed visual edges by `0.04–0.06 m`, one segment. Never noise, sculpt, or bevel a connection seam.

## Complete 50-piece structural archive

### Land, cliffs, terraces, ramps, and stairs — T01–T12

| ID | Key | Footprint | Model purpose |
| --- | --- | --- | --- |
| T01 | `LAND_FLAT` | 1×1 | Base structural land cell; receives any of the nine surface skins |
| T02 | `CLIFF_STRAIGHT` | 1×1 | One exposed south edge with logo-style grass/earth/limestone stack |
| T03 | `CLIFF_OUTER` | 1×1 | Convex exposed south+east corner |
| T04 | `CLIFF_INNER` | 1×1 | Concave south+east terrain recess |
| T05 | `CLIFF_CAP_PENINSULA` | 1×1 | Narrow land cap with three exposed sides |
| T06 | `CLIFF_ISOLATED` | 1×1 | Small isolated four-sided land cell/islet |
| T07 | `STACKABLE_WALL_STRAIGHT` | 1×1 edge | Additional one-level retaining course for higher terraces |
| T08 | `STACKABLE_WALL_OUTER` | 1×1 edge | Convex stackable retaining-wall corner |
| T09 | `STACKABLE_WALL_INNER` | 1×1 edge | Concave stackable retaining-wall corner |
| T10 | `RAMP_STRAIGHT` | 1×2 | Cart-accessible 1 m rise over 4 m; low south, high north |
| T11 | `STAIRS_STRAIGHT` | 1×1 | Five broad cream-stone steps for one 1 m rise |
| T12 | `STAIRS_LANDING` | 1×1 | Level stair landing/turn platform with compatible wall sockets |

### Natural coast and civic seawalls — T13–T19

| ID | Key | Footprint | Model purpose |
| --- | --- | --- | --- |
| T13 | `NATURAL_SHORE_STRAIGHT` | 1×1 edge | Planted stepped coast with wet stone and foam socket |
| T14 | `NATURAL_SHORE_OUTER` | 1×1 edge | Convex natural shoreline corner |
| T15 | `NATURAL_SHORE_INNER` | 1×1 edge | Concave planted inlet |
| T16 | `SEAWALL_STRAIGHT` | 1×1 edge | Clean stacked-limestone urban waterfront |
| T17 | `SEAWALL_OUTER` | 1×1 edge | Convex urban seawall corner |
| T18 | `SEAWALL_INNER` | 1×1 edge | Concave urban seawall corner |
| T19 | `SEAWALL_WATER_ACCESS` | 1×1 | Stone steps/low landing reaching the water |

Use the natural family around gardens and outer islands. Use the seawall family around Hearthmarket, canals, ferry docks, and commercial districts. Both must share the same land and water datums.

### Canals, ponds, and ocean connections — T20–T26

| ID | Key | Footprint | Connections |
| --- | --- | --- | --- |
| T20 | `CANAL_STRAIGHT` | 1×1 | North + south |
| T21 | `CANAL_CORNER` | 1×1 | North + east |
| T22 | `CANAL_T` | 1×1 | North + east + west |
| T23 | `CANAL_CROSS` | 1×1 | All four sides |
| T24 | `CANAL_END_BASIN` | 1×1 | North only; planted reflecting-pool head |
| T25 | `CANAL_OCEAN_MOUTH` | 1×1 | South canal to north ocean opening |
| T26 | `POND_FULL_WATER_CUT` | 1×1 | Full-cell lined water cut; repeats into larger ponds |

Canal clear water width is `1.40–1.50 m`, with `0.20–0.25 m` stone curbs. Use the shallow civic canal surface at `Z=+0.68 m`; use the ocean datum at `Z=-0.18 m` only at ocean-facing inlets and shores. Open ocean is one continuous zone plane—not thousands of water-tile objects.

### Stone paths and plazas — T27–T33

| ID | Key | Footprint | Connections / purpose |
| --- | --- | --- | --- |
| T27 | `PATH_STRAIGHT` | 1×1 | North + south |
| T28 | `PATH_CORNER` | 1×1 | North + east; use the logo's softly rounded planted outer corner |
| T29 | `PATH_T` | 1×1 | North + east + west |
| T30 | `PATH_CROSS` | 1×1 | All four sides |
| T31 | `PATH_END` | 1×1 | North only; small civic landing on closed side |
| T32 | `PATH_THRESHOLD` | 1×1 | Path-to-building, plot, stair, or dock entrance transition |
| T33 | `PLAZA_FILL` | 1×1 | Full-width cream flagstone for markets, forecourts, and cart lanes |

Pedestrian routes are exactly `1.20 m` wide and centered at each connected edge. Use real low-profile paver slabs only where they affect the silhouette; keep small joints and cracks in the shared texture/normal. All topology pieces must continue the same paver rhythm.

### Player plots — T34–T38

| ID | Key | Footprint | Model purpose |
| --- | --- | --- | --- |
| T34 | `PLOT_FILL` | 1×1 | Quiet buildable grass/packed-earth cell |
| T35 | `PLOT_BORDER_STRAIGHT` | 1×1 overlay | Thin white lease boundary |
| T36 | `PLOT_BORDER_CORNER` | 1×1 overlay | Matching 90° white corner |
| T37 | `PLOT_ENTRANCE` | 1×1 overlay | Boundary gap and customer threshold |
| T38 | `PLOT_UTILITY_VERGE` | 1×1 | Flush power/water/data access strip at service edge |

Plots are assemblies of these pieces, never unique meshes for every plot size. The animated selection glow and internal build grid are runtime effects, not baked geometry.

### Bridges, boardwalks, docks, and ferry berths — T39–T50

| ID | Key | Footprint | Model purpose |
| --- | --- | --- | --- |
| T39 | `FOOTBRIDGE_SHORT` | 1×2 | Complete 4×2 m arched timber canal bridge visible in the logo |
| T40 | `FOOTBRIDGE_LANDING` | 1×1 | Stone/path-to-footbridge transition |
| T41 | `FOOTBRIDGE_MID` | 1×1 | Repeatable pedestrian bridge span |
| T42 | `CART_BRIDGE_LANDING` | 2×1 | Wider service/cart bridge approach |
| T43 | `CART_BRIDGE_MID` | 2×1 | Repeatable 4 m-wide service/cart span |
| T44 | `DOCK_LAND_LANDING` | 1×1 | Stone-path-to-timber quay transition with ferry stripe |
| T45 | `PIER_STRAIGHT` | 1×1 | Repeatable timber pier, north + south |
| T46 | `PIER_CORNER` | 1×1 | North + east pier turn |
| T47 | `PIER_T` | 1×1 | North + east + west pier junction |
| T48 | `PIER_END` | 1×1 | Closed berth end with bollard/cleat sockets |
| T49 | `DOCK_STAIRS` | 1×1 | Timber/stone access from land deck to lower pier deck |
| T50 | `FERRY_BERTH_EDGE` | 1×2 | 4 m ferry/cargo loading face with fender, cleat, and service sockets |

Land bridge decks sit at approximately `Z=1.02`. Lower pier decks may sit near `Z=0.42`. Planks are approximately `0.22–0.25 m` wide with `0.015–0.025 m` gaps. Repeatable pieces must omit hidden end caps to prevent overlap and flicker.

## Nine shared surface appearances

These are material/UV variants of compatible geometry, not nine extra heavy models:

1. lush perimeter grass;
2. quiet buildable grass;
3. sun-dried grass;
4. productive dark soil;
5. pale sand;
6. compacted gravel;
7. cream limestone plaza;
8. terracotta industrial paving;
9. honey timber deck.

Use the official palette and semantic material names from `game/src/artStandard.ts`. One shared 2048 terrain atlas should serve the complete kit, with at least 8 px gutters and approximately 128–256 px per metre. Water uses one separate shared shader/material.

## Required lightweight overlays

These remain simple ribbons/cards and do not count as structural tiles:

- foam straight, foam outer, and foam inner;
- moss/flower-speckle/wear variants;
- plot selection and construction grid;
- drain, utility, cargo, and traffic markings.

Place opaque land overlays at approximately `Z=1.015–1.025`; place foam just above water. Never leave coplanar surfaces.

## Shared landscaping and street props

The logo's richness comes largely from composition. Make these as separate instanced assets, never baked into T01:

- three broadleaf trees and one palm;
- two shrub clusters and two flower clusters;
- coastal rocks, reeds, and lilies;
- square, long, and round planters;
- solar lamp, bench, recycling bin, and sign;
- fence straight/corner/gate and hedge straight/corner;
- canal/dock rail, bollard/cleat, utility cabinet/valve/pipe;
- crate stack, hand trolley, market stall, and parked utility cart.

Every suitable tile should expose metadata sockets for center, four corners, four edge centers, path-facing, water-facing, service/cargo, utility, plot sign, and planting. The world generator chooses 2–3 deterministic variants so adjacent tiles do not repeat identically.

## Browser-safe geometry

| Family | LOD0 hard ceiling |
| --- | ---: |
| Flat/fill structural tile | 24 triangles |
| Path, foam, or plot overlay | 80 triangles |
| Cliff, shore, seawall, or canal | 180 triangles |
| Ramp, stair, or landing | 300 triangles |
| Bridge, dock, or ferry macro | 1,200 triangles |

- One opaque draw per ordinary tile; two maximum for shore/decal; three maximum for bridge/dock.
- LOD1: approximately 40–55% of LOD0. LOD2: approximately 10–18%, preserving silhouette.
- Flat tiles use a chunk collision/nav surface, not thousands of individual colliders.
- Ramp/stair: one wedge collider. Bridge/dock: at most three boxes. Small foliage has no collider.
- Author pieces separately, but runtime must instance repeated meshes and merge static terrain into 16×16-cell chunks.
- Keep one streamed district below approximately 120k visible terrain triangles and 120 terrain draw calls.

## Sockets and compatibility tags

Every tile root gets cardinal grid sockets:

```text
SOCKET_GRID_N  (0,+1,walk_z)
SOCKET_GRID_E  (+1,0,walk_z)
SOCKET_GRID_S  (0,-1,walk_z)
SOCKET_GRID_W  (-1,0,walk_z)
```

Only active edges receive `SOCKET_PATH_*`, `SOCKET_CANAL_*`, `SOCKET_DECK_*`, or `SOCKET_WATER_*`. Use these compatibility tags in the asset manifest:

`LAND_L0`, `LAND_L1`, `WATER_S0`, `PATH_120`, `PLAZA_200`, `CANAL_150`, `DECK_LAND`, `DECK_PIER`.

## Naming and delivery

Example:

```text
ASSET_MM_TILE_PATH_CORNER_V1
  RENDER/MM_TILE_PATH_CORNER_V1_LOD0
         MM_TILE_PATH_CORNER_V1_LOD1
         MM_TILE_PATH_CORNER_V1_LOD2
  COLLISION/COL_MM_TILE_PATH_CORNER
  SOCKETS/SOCKET_GRID_N ... SOCKET_PATH_N SOCKET_PATH_E
```

File: `mm_tile_path_corner_v1_lod0.glb`. Deliver one combined `mm_terrain_kit_v1.glb`, plus separate source GLBs, previews, `.blend`, and a manifest with footprint, elevation delta, edge mask/tags, bounds, triangles, materials, collision, sockets, hashes, and Blender version.

## Modeling order

First build the 34 high-frequency pieces required for a convincing main-island test:

`T01–T04, T11, T13–T18, T20–T25, T27–T33, T34–T37, T39, T44–T48`.

Then complete `T05–T10, T12, T19, T26, T38, T40–T43, T49–T50` before constructing the full archipelago.

Before island production, build a 4×4 seam stage and test every compatible piece at 0°, 90°, 180°, and 270°. Reject cracks, height mismatches, broken paver rhythm, doubled walls, visible internal faces, z-fighting, or water seams.

## Logo-world composition recipe

- Use irregular stepped coastlines, not a perfect square island.
- Keep most districts one level above water and use a few +1 m garden/landmark terraces.
- Run one-cell-wide turquoise canals through Hearthmarket with 2–4 timber footbridges per civic cluster.
- Use cream paths and full plaza fills around buildings; place quiet player plots along outer commercial rings.
- Cluster trees and flowers along island edges and planters, leaving entrances, plot gates, and service lanes open.
- Keep buildings, boats, vehicles, market stalls, and citizens as separate prefabs; they are not terrain tiles.
