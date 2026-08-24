# Mercedonian runtime avatars

These nine animated citizens are optimized, axis-corrected rigs built from the original uploaded GLBs.

- 256px WebP textures
- Meshopt-compressed geometry
- 8k–15k triangles per citizen
- `Idle` and `Walk` animations preserved
- Per-model `+X`/`+Z` authoring axes recorded with the matching game yaw correction
- In-place v2 humanoid rigs with correct lateral weighting and planted-knee walk cycles
- Integrity and performance budgets recorded in `manifest.json`

Rebuild citizens and the animated civic player together with:

`node scripts/worldgen/mercedonians/rebuild_character_runtime.mjs`
