# Markets & Makers — Official Art Library v1

**Status: APPROVED PRODUCTION AUTHORITY**

This tracked library establishes the official building design and overall graphics theme for Markets & Makers.

- `approved-originals/` contains the eight original concepts that established the visual language.
- `turntables/` contains the 15 player-business turnaround masters plus the Public Market Pavilion.
- `world-tiles-v1/` contains the approved logo-background reference, complete 50-piece world-tile inventory, and Blender modeling contract.
- `manifest.json` maps every game license to its visual reference and required footprint.
- `checksums.sha256` locks the 24 approved source images against accidental replacement.
- [`../../ART-DIRECTION.md`](../../ART-DIRECTION.md) defines the shared visual, modeling, export, performance, and approval rules.

Every turnaround uses the same panel order: **top-left 0° front-right master**, **top-right 90° rear-right**, **bottom-left 180° rear-left**, and **bottom-right 270° front-left**. Artists should regularize small concept-image discrepancies into one coherent model without changing the approved silhouette, footprint, palette, or business cue.

Current browser GLBs are temporary placeholders. A model becomes official runtime art only after it matches this library and passes the GLB checklist in `ART-DIRECTION.md`.

From `game/`, run `npm run validate:art` to verify the complete official set, image dimensions, mappings, footprints, and fingerprints. The production build runs this check automatically.
