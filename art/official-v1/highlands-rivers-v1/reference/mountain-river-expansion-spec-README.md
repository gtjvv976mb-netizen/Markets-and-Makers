# Markets & Makers — Official Mountain and Flowing-River Expansion Spec v1

**Status:** topology and modeling contract locked; models not yet built
**Extends:** the approved 50-piece V5 logo-world kit
**New sources:** 24 (`T51–T74`)
**Final structural library after modeling:** 74 source pieces

This is a deliberately bounded extension. It does not replace or restyle the approved V5 tiles. It adds only the terrain forms and water-flow topology that cannot be assembled convincingly from `T01–T50`.

## What remains unchanged

| Contract | Official value |
| --- | ---: |
| Cell | `2 × 2 m` |
| Level-0 walk surface | `Z=+1.00 m` |
| Elevation step | `1.00 m` |
| Ocean | `Z=-0.18 m` |
| Civic canal | `Z=+0.68 m` |
| Axes | `+X east, +Y north, +Z up` |
| Runtime rotation | `0/90/180/270°` only |
| Terrain chunk | `16 × 16 cells` / `32 × 32 m` |

At terrain level `k`, the natural river surface is `Z=0.62+k`, its bed is `Z=0.28+k`, and its bank lip is `Z=0.96+k`. This puts water 0.38 m below nearby land while retaining the saturated turquoise look of the logo.

## Reuse before adding anything

- `T01` fills raised mountain shelves and plateaus at any integer elevation.
- `T02–T06` make exposed contour caps, natural outer silhouettes, and small rocky islets.
- `T07–T09` stack into one-metre mountain walls and flank caves.
- `T10` is the official **straight mountain slope** after applying the mountain grass/rock skin. It is not duplicated in the new range.
- `T11–T12` make maintained trail stairs and lookout landings.
- `T13–T15` remain the ocean/lake shoreline family.
- `T20–T26` remain lined civic canals and ponds; they are not relabeled as rivers.
- `T27–T32` form mountain trails, viewpoints, and cave thresholds.
- `T39–T43` cross rivers; there is no duplicate “river bridge” family.

## New mountain pieces — T51–T61

| ID | Key | Footprint | Elevation | Canonical topology | LOD0 cap |
| --- | --- | ---: | ---: | --- | ---: |
| T51 | Mountain slope outer | 2×2 / 4×4 m | +1 m | one high NW corner | 320 tris |
| T52 | Mountain slope inner | 2×2 / 4×4 m | +1 m | one low SE corner | 360 tris |
| T53 | Ridge straight | 2×2 / 4×4 m | +1 m crest | N–S | 420 tris |
| T54 | Ridge corner | 2×2 / 4×4 m | +1 m crest | N–E | 460 tris |
| T55 | Ridge T | 2×2 / 4×4 m | +1 m crest | N–E–W | 520 tris |
| T56 | Ridge end | 2×2 / 4×4 m | +1 m crest | N | 420 tris |
| T57 | Mountain peak | 3×3 / 6×6 m | +2 m visual summit | radial | 760 tris |
| T58 | Valley straight | 2×2 / 4×4 m | 1 m banks | N–S floor | 480 tris |
| T59 | Valley corner | 2×2 / 4×4 m | 1 m banks | N–E floor | 520 tris |
| T60 | Valley T | 2×2 / 4×4 m | 1 m banks | N–E–W floor | 580 tris |
| T61 | Cave entrance | 2×1 / 4×2 m | L0 floor to L3 top | portal faces south | 900 tris |

Mountain borders use exact three-sample edge profiles. Adjacent arrays must match within 1 mm after rotation and elevation offset. The outermost 8 cm of every seam is protected from sculpting, bevels, displacement, roots, and rocks.

The cave portal is `1.8 m` wide and `2.3 m` high. It is only a streamed-zone doorway; the terrain tile does not contain a large cave interior. Three simple box colliders form the two flanks and lintel.

## New natural-water pieces — T62–T74

Canonical river flow is north to south. Rotate the whole tile to change direction; never mirror it.

| ID | Key | Footprint | Flow at rotation 0 | Local water height | Speed | LOD0 cap |
| --- | --- | ---: | --- | --- | ---: | ---: |
| T62 | River straight | 1×1 | N in → S out | 0.62 m | 0.85 m/s | 260 |
| T63 | River corner | 1×1 | N in → E out | 0.62 m | 0.70 m/s | 300 |
| T64 | River T confluence | 1×1 | N+E in → S out | 0.62 m | 0.55 m/s | 380 |
| T65 | River T distributary | 1×1 | N in → E+S out | 0.62 m | 0.60 m/s | 380 |
| T66 | Braided river cross | 1×1 | N+W in → E+S out | 0.62 m | 0.45 m/s | 460 |
| T67 | Spring source | 1×1 | source → S out | 0.62 m | 0.35 m/s | 440 |
| T68 | Flow-through pond | 2×2 | N in → S out | 0.62 m | 0.12 m/s | 680 |
| T69 | Closed end basin | 2×2 | N in → terminal | 0.62 m | 0.05 m/s | 620 |
| T70 | River rapid | 1×2 | N at L+1 → S at L | 1.62 → 0.62 m | 1.45 m/s | 520 |
| T71 | Waterfall | 1×1 | N at L+1 → S at L | 1.62 → 0.62 m | 2.80 m/s | 760 |
| T72 | Plunge basin | 2×2 | fall N in → S out | 0.62 m | 0.22 m/s | 700 |
| T73 | Natural ocean mouth | 1×2 | river N → ocean S | 0.62 → -0.18 m | 0.50 m/s | 760 |
| T74 | Civic headworks | 1×1 | river N → canal S | 0.62 → 0.68 m | 0.30 m/s | 900 |

The natural channel is normally 1.20 m wide, with an allowed authored range of 1.10–1.35 m and roughly 0.40 m of planted bank on each side. Connected socket widths must match within 1 cm and water heights within 5 mm.

`T69` is legal only when world metadata explicitly says `closed_basin=true`. It must never hide an accidental dead-end river. `T71` drops exactly one metre and may be repeated once per level; it must never be scaled vertically. `T74` is the only legal direct natural-river connection to the existing civic canal family. Its visible solar pump/weir explains the six-centimetre lift into the canal.

## Gameplay-authoritative topology

The art mesh and the water graph use the same sockets. Each river edge records:

- cardinal edge;
- `IN`, `OUT`, `IN_FROM_FALL`, `OUT_OCEAN`, or `OUT_CANAL` role;
- relative terrain level;
- exact water surface height and width;
- local XY flow vector;
- nominal flow speed.

The world validator must reject:

- inlet-to-inlet or outlet-to-outlet seams;
- unmatched widths or water heights;
- water that climbs uphill outside `T74`;
- non-source nodes with no upstream connection;
- non-terminal outlets that cannot reach the ocean, a declared closed basin, or headworks;
- unintended flow cycles;
- a waterfall/rapid drop other than exactly 1.000 m.

This graph can drive water animation, fishing zones, resource quality, ferry restrictions, irrigation availability, flood simulation, and later hydro-power production without inferring gameplay from pixels.

## Materials and art direction

Use the existing V5 grass, cliff, rounded rock, limestone, border, shallow-water, ocean, teal, cream, and foam materials. The only additions are lightweight shader instances:

- `MAT_RIVER_FLOW`: the existing shallow-water appearance with per-instance direction, phase, and speed;
- `MAT_CAVE_VOID`: a recessed opaque deep teal-black portal surface.

No new bitmap texture language is needed. Do not introduce photoreal rock, snow, generic gray mountains, dense baked grass, or realism that clashes with the warm miniature solarpunk logo world. Decorative trees, shrubs, reeds, flowers, boulders, lamps, benches, and wildlife remain separate instanced props.

## Runtime limits

- Mountain piece: one opaque draw; cave: two maximum.
- Ordinary river piece: two draws; rapid/waterfall/mouth/headworks: three maximum.
- LOD1: 45–55% of LOD0. LOD2: 12–18%.
- Worst-case 16×16-cell chunk: 45k LOD0 terrain triangles maximum.
- Average chunk target: 15k LOD0 terrain triangles.
- Streamed district: 120k visible terrain triangles and 120 terrain draws maximum.
- Compile each chunk into one opaque atlas draw, one river-water draw, one foam draw, and one keyline draw where possible.
- Use one chunk collider plus explicit cave/bridge/waterfall blockers—not one collider per tile.

## Recommended build and QA sequence

1. Model `T51`, `T52`, `T62`, `T63`, `T70`, and `T71` first.
2. Build a 12×12-cell seam laboratory containing every land, elevation, river, rapid, waterfall, mouth, and canal-headworks transition.
3. Validate every allowed rotation before adding detail.
4. Complete ridge/valley pieces, then source/pond/basin/mouth/headworks.
5. Create LOD1, LOD2, collisions, sockets, and deterministic prop anchors.
6. Only after the seam and hydrology tests pass, expand the government-city world.

Keep the existing 192×160 m government city at level 0 and unchanged. Put mountain terrain outside its civic development bounds. Natural drainage may bypass the city to `T73`, or enter the government canal only through `T74`. This preserves the approved city while making the surrounding open world dramatically larger and more intricate.

The complete machine-readable contract is in `manifest.json`.
