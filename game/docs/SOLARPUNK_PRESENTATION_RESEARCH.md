# Solarpunk presentation research and implementation notes

Date: 2026-08-23  
Applied release: browser game v0.2.0

## Visual target

Markets & Makers should read as an optimistic, inhabited, technology-positive archipelago at three distances:

- **World view:** turquoise water, apple/sage green islands, warm stone edges, readable specialist landmarks.
- **District view:** civic paths, public utilities, planted roofs, visible citizens and clearly marked player plots.
- **Interaction view:** a strong next action, business status, useful resource feedback and unmistakable selection states.

Solarpunk is treated as a relationship between community, ecology and useful technology—not simply “green cyberpunk.” The world therefore prioritizes public water, renewable energy, shared transit, markets, gardens and citizen activity.

## Research translated into the game

### Color pipeline

Three.js performs lighting in Linear-sRGB and displays the final canvas in sRGB. The runtime now retains `SRGBColorSpace`, uses neutral tone mapping and explicitly art-directs the untextured GLB material palette. This removes the beige/gray wash without increasing asset downloads.

Reference: [Three.js Color Management](https://threejs.org/manual/en/color-management.html)

### Browser-light depth

One bounded directional shadow is enabled only on capable desktop devices. Citizens and the avatar use inexpensive circular contact shadows. This follows Three.js guidance that each shadow-casting light redraws the scene and that fake shadows are often effective for stylized games.

Reference: [Three.js Shadows](https://threejs.org/manual/en/shadows.html)

### Efficient 3D delivery

The existing GLB source remains the world-delivery format. The visual pass reuses its geometry and materials rather than adding large raster textures or a post-processing bundle. Future production assets should continue using shared geometry, instancing and Meshopt/KTX2 where appropriate.

References: [Khronos glTF](https://www.khronos.org/gltf/), [Khronos Asset Creation Guidelines 2.0](https://www.khronos.org/blog/introducing-asset-creation-guidelines-2.0-siggraph-2025)

### Interaction hierarchy

The founder objective is now visually stronger than the complete checklist, and contextual buttons take the player to the relevant panel. Available plots have animated boundaries, lease labels and beacons. The ferry list is supported by a spatial archipelago map so geography and specialization can be understood at a glance.

### Runtime performance

The existing `requestAnimationFrame` loop remains delta-time based. Device pixel ratio is bounded more aggressively on mobile because filled canvas resolution has a direct performance cost. Interaction raycasts continue to use simple invisible navigation meshes instead of the detailed render terrain.

References: [web.dev Canvas performance](https://web.dev/articles/canvas-performance), [web.dev WebGL case-study guidance](https://web.dev/case-studies/hobbit)

## Changes delivered in v0.2.0

- Saturated solarpunk runtime palette for terrain, water and B01–B08 buildings.
- Neutral tone mapping, stronger daylight and capability-gated shadows.
- Contact shadows for player and citizens.
- Animated click destination and plot markers.
- Compact founder journey with contextual next-action buttons.
- Interactive nine-island ferry map.
- Updated hover, depth, glass and responsive UI treatment.
- Reduced-motion accessibility support.

## Next visual priorities

1. Add three shared landscaping kits—tree, shrub/flower bed and street planter—using instancing and district-specific palettes.
2. Add one shared rigged citizen/avatar GLB with walk, idle, wave and carry animations.
3. Add island landmark signs and business state icons generated through pooled atlases/SDF text.
4. Produce LOD1/LOD2 for the world structures and stream satellites by ferry destination.
5. Create a 1024–2048 px shared material atlas with subtle baked AO and KTX2 compression.
6. Give each business interior a small real 3D room kit after the authoritative upgrade loop is connected to Render.

All additions must preserve the lite-browser gates: useful interaction before the full world finishes streaming, at least 30 FPS on the target low-end device, bounded memory after island travel and no unique texture/material per player business.
