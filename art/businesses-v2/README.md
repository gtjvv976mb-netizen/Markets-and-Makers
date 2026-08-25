# Markets & Makers business buildings v2

This is the production-candidate redesign of all fifteen player-owned businesses. The models are generated from the exact geometry used by the live Three.js game, so this pack does not repeat the v1 problem where several business names pointed to duplicate buildings.

## Contents

- `models/`: fifteen unique, grounded GLB 2.0 files.
- `manifest.json`: dimensions, checksums, triangle/vertex counts, identity, silhouette, hero prop, and regenerative system for every model.
- `references/solarpunk-business-art-direction-v2.png`: shared visual direction board used while redesigning the set.
- `references/in-engine-business-catalog-v2.png`: visual QA capture rendered by the game's own Three.js material and lighting path.
- `references/IMAGEGEN_PROMPT.md`: exact mode, input reference, and prompt used for the shared art-direction board.
- `DESIGN_BRIEF.md`: business-by-business decisions and research provenance.

The current runtime still creates these buildings from `game/src/proceduralAssets.ts` to avoid network downloads. The exported GLBs are reusable authoring/delivery assets and match that source geometry.

## Coordinate and performance contract

- Metres; bottom-centre pivot; minimum Y is exactly zero.
- glTF axes: +Y up and +Z customer front.
- Official 2 m tile footprints from `art/official-v1/manifest.json`.
- One indexed mesh, one opaque `MeshStandardMaterial`, vertex colours, zero textures per building.
- Static geometry: no cameras, lights, skins, morphs, or animation.
- Hard mobile ceiling: 8,000 triangles per building; this set is substantially below it.

## Regenerate

From `repo/game`:

```sh
node_modules/.bin/vite-node ../scripts/export-businesses-v2.ts
```

The exporter rebuilds every GLB and rewrites `manifest.json` from the live procedural source. Unit tests in `game/tests/proceduralAssets.test.ts` enforce fifteen unique geometries, one draw call, grounding, official footprints, metadata, and mobile budgets.

Open `game/businesses-v2.html` through Vite to inspect the actual models in a 5×3 in-engine catalog.
