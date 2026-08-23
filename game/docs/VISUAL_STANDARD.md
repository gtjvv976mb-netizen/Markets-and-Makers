# Markets & Makers visual standard — game implementation

The canonical visual and GLB contract is [`../../ART-DIRECTION.md`](../../ART-DIRECTION.md). The canonical images and business-footprint manifest are in [`../../art/official-v1`](../../art/official-v1).

## Current implementation status

- **Approved:** visual direction and fifteen business turnaround masters.
- **Temporary:** existing Sunwoven Reach world GLB and eight reused B01–B08 structure GLBs.
- **Pending:** fifteen unique production GLBs, exact plot-footprint classes, exact-scale placement, authored PBR material preservation, LODs, collision, sockets, and rebuilt public districts.

## Runtime integration rule

Do not change a business to a new model path merely because a draft GLB exists. A replacement GLB must first pass the approval checklist in `ART-DIRECTION.md` and match the corresponding record in `art/official-v1/manifest.json`.

At integration time:

1. Add stable `assetId`, `footprintTiles`, orientation, and model version to the business catalog.
2. Provide compatible plots at the authoritative 2 m scale.
3. Load approved models at scale `1.0`; reject bounds that do not match their manifest instead of silently shrinking them.
4. Preserve authored materials. Runtime palette overrides are legacy fallback behavior only.
5. Validate customer/service sockets, collision, LODs, texture sizes, triangle counts, and GLB hash.
6. Capture all four fixed gameplay-camera screenshots for visual approval.
7. Rebuild and test the browser release; never hand-edit `dist/`.

