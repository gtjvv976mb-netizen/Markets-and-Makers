# Markets & Makers — Highlands & Rivers World v1

This is the first production expansion of the official logo-world terrain.  It turns the
original civic island into a **512 m × 512 m**, 2 m-grid open world with seven elevation
levels, three complete watersheds, three lakes, authored rapids and waterfalls, nine
explicit bridges, government services, and 42 empty buy-or-lease plots.

## Repository and release boundary

This tracked directory contains the authoritative contracts, generated layout and
hydrology data, complete QA evidence, checksum ledger, and approved review renders. The
large Blender, GLB, chunk, and per-tile binaries are distributed in
`markets-and-makers-highlands-rivers-world-v1.zip`; its expected SHA-256 is recorded in
`release/markets-and-makers-highlands-rivers-world-v1.zip.sha256`.

The expansion is an approved world-content build, not yet the live browser terrain. The
current browser still needs a 256-chunk streaming integration before this package should
replace the existing Sunwoven runtime world.

## Start here

- `mm_highlands_rivers_world_v1_preview.glb` — complete presentation scene.
- `mm_highlands_rivers_world_v1_lite.glb` — browser-first terrain, water, bridges and plots.
- `chunks/CH_cx_cy.glb` — 256 local-origin, 32 m × 32 m streaming chunks.
- `tiles/T51_*.glb` through `tiles/T74_*.glb` — canonical source tiles.
- `hydrology.json` — authoritative directed flow graph and browser shader fields.
- `terrain-grid.json` — full 256 × 256-cell priority-resolved surface raster.
- `layout.json` — buildings, empty plots, transport, streaming and world placement.

## Coordinate contract

Each integer cell is a tile center; +X is east, +Y north, +Z up.  Ground walk height is
1.0 m.  Natural river and lake water is `0.62 + elevation_level` metres; the historic
government canal alone remains at 0.68 m.  Ocean water is -0.18 m.  Chunk records carry
their world origin; the geometry inside each chunk GLB is local to that origin.

## Browser runtime

Load the current chunk plus a two-chunk radius, prefetch to three chunks, and bind the
shared approved material atlas by exported material name.  Animate `MAT_RIVER_FLOW` from
`hydrology.json`: `MMFlow` UVs provide continuity, `flow_vector` provides direction, and
`speed_mps` provides rate.  The static lite GLB is useful for prototypes; production
should stream the individual chunk GLBs.

This v1 package delivers **LOD0 terrain chunks only**; it does not claim LOD1/LOD2 mesh
artifacts.  Generate a greedy heightfield collider per loaded chunk from the `land_l#`
runs in `terrain-grid.json`, add bridge deck boxes from `layout.json`, keep water and
waterfall cells non-walkable, and use the T61 portal's two flank boxes plus lintel box.

The individual T51–T74 GLBs are authoring/review assets and intentionally preserve the
approved multi-material look; some therefore exceed the source specification's nominal
draw-call ceiling.  Browser production must use the compiled chunk GLBs, whose terrain
surfaces are consolidated for streaming, rather than instancing the authoring GLBs.

## Planning vocabulary versus runtime assets

The expanded layout contains **32 semantic tile markers**
(mountain, river, lake and waterfall planning roles).  Rotation, placement context and
shared topology consolidate those roles into **24 canonical
source meshes**, T51–T74; no source file is missing.  Likewise, the layout declares
**14 authored waterfall sites with dedicated plunge pools**,
while the directed hydrology graph contains **15 waterfall edges**
and **12 rapid edges**.  The terminal Sunfall confluence drop uses its
confluence basin rather than a separate plunge-pool marker, so these counts intentionally
describe different units.

## Ownership boundary

The nine imported civic buildings remain government-owned and non-buildable.  All 18
original plots are byte-for-byte placement/ownership compatible with the government-city
layout, and 24 new empty plots are added.  No commercial structure is placed in this
package.

## Source locks and validation

`source-lock.json` binds the tile specification, approved V5 library, expanded layout and
government city by SHA-256.  `qa-report-generator.json` contains build-time gates.  Run
the independent validator after generation:

```sh
python3 scripts/worldgen/highlands-rivers-v1/validate_markets_makers_highlands_rivers_world_v1.py --workspace /path/to/Markets-and-Makers
```
