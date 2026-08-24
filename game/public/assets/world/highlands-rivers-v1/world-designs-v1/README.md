# Markets & Makers — World Designs v1

This package turns the uploaded solarpunk GLBs into the streamed scenery layer for the Highlands & Rivers world.

- `models/` contains the 16 browser-optimized GLBs.
- `manifest.json` defines asset dimensions, integrity locks, and 910 deterministic placements.
- `build-manifest.json` records the source/runtime byte and triangle budgets.
- Trees, shrubs, street furniture, vehicles, and boats are grouped by terrain chunk at runtime.
- Civic buildings, plot entrances, utilities, bridges, roads, and points of interest retain authored clearances.

Rebuild the optimized models with `node scripts/worldgen/world-designs-v1/build_world_designs_v1.mjs`, then regenerate placement data with `scripts/worldgen/world-designs-v1/generate_placements.py`.

The 1920×1080 modeling renders and the 4K catalog are stored in `outputs/markets-and-makers-world-designs-v1/`.
