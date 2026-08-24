#!/usr/bin/env python3
"""Create deterministic, plot-safe, logo-density scenery for Highlands & Rivers."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable, Iterable

from PIL import Image, ImageDraw, ImageFont


Cell = tuple[int, int]


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def cells_in_rect(rect: dict[str, Any], padding: int = 0) -> Iterable[Cell]:
    minimum, maximum = rect["min"], rect["max"]
    for y in range(minimum[1] - padding, maximum[1] + padding + 1):
        for x in range(minimum[0] - padding, maximum[0] + padding + 1):
            yield x, y


def fnv_rank(seed: str, x: float, y: float) -> int:
    digest = hashlib.sha256(f"world-designs-v1|{seed}|{x}|{y}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def world_position(cell: tuple[float, float]) -> tuple[float, float]:
    return cell[0] * 2.0, -cell[1] * 2.0


def yaw(seed: str, cell: tuple[float, float]) -> float:
    return float((fnv_rank(seed, *cell) % 24) * 15)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()

    layout = load(args.world / "layout.json")
    terrain = load(args.world / "terrain-grid.json")
    hydrology = load(args.world / "hydrology.json")
    build = load(args.runtime / "build-manifest.json")

    surface: dict[Cell, str] = {}
    for row in terrain["rows"]:
        for run in row["runs"]:
            for x in range(run["x0"], run["x1"] + 1):
                surface[(x, row["y"])] = run["surface"]
    bounds_min = tuple(terrain["bounds_cells"]["min"])
    bounds_max = tuple(terrain["bounds_cells"]["max"])

    land = {cell for cell, kind in surface.items() if kind.startswith("land_l")}
    routes = {cell for cell, kind in surface.items() if kind in {"road", "path"}}
    water = {cell for cell, kind in surface.items() if kind in {"ocean", "natural_water", "civic_canal"}}
    bridge_cells = {cell for cell, kind in surface.items() if kind == "bridge"}

    kiosk_specs = [
        ((3, 7), 180.0), ((-13, 7), 0.0), ((12, 7), 180.0),
        ((17, -27), 0.0), ((17, 9), 0.0), ((17, -7), 0.0),
        ((-43, -7), 0.0), ((-18, 9), 180.0), ((41, 9), 180.0),
    ]
    vehicle_cells = {
        "mv01_sunpod_microcar": [(-44, -23, "N"), (-45, 15, "S"), (-30, -18, "N"), (-31, 14, "S"), (29, -16, "N"), (28, 14, "S"), (43, -17, "N"), (42, 18, "S"), (-18, -31, "E"), (6, -30, "W"), (-20, 6, "E"), (25, 7, "W")],
        "mv02_market_cargo_cart": [(-36, -31, "E"), (20, -30, "W"), (-40, -11, "E"), (35, -10, "W"), (-25, 20, "E"), (22, 21, "W"), (-40, 24, "E"), (36, 25, "W")],
        "mv03_civic_shuttle": [(-5, -11, "E"), (24, -30, "W"), (5, 20, "E"), (30, 37, "E")],
    }
    boat_cells = {
        "bv01_sunwake_ferry": [(26.5, -44, "N"), (-20, -49, "E"), (68, -50, "W")],
        "bv02_makers_workboat": [(34, -49, "W"), (-62, -53, "E"), (102, -52, "W"), (6, -54, "E")],
    }

    def reserve_square(target: set[Cell], cell: Cell, radius: int) -> None:
        x, y = cell
        target.update((x + dx, y + dy) for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1))

    hard_reserved: set[Cell] = set()
    soft_reserved: set[Cell] = set()
    functional_sockets: set[Cell] = set()
    for building in layout["buildings"]:
        hard_reserved.update(cells_in_rect(building["occupied_bounds_cells"], 1))
        soft_reserved.update(cells_in_rect(building["occupied_bounds_cells"], 3))
        for key in ("customer_socket_cell", "service_socket_cell", "utility_node_cell"):
            if key in building:
                socket_cell = tuple(building[key])
                functional_sockets.add(socket_cell)
                reserve_square(hard_reserved, socket_cell, 2)
    for collection in (layout["plots"]["existing"], layout["plots"]["added"]):
        for plot in collection:
            hard_reserved.update(cells_in_rect(plot["occupied_bounds_cells"], 2))
            if "utility_connection_cell" in plot:
                socket_cell = tuple(plot["utility_connection_cell"])
                functional_sockets.add(socket_cell)
                reserve_square(hard_reserved, socket_cell, 2)
    # The terrain raster contains both the expansion bridges and protected
    # civic bridges. Reserving only layout.transport left props on the latter.
    for bridge_cell in bridge_cells:
        reserve_square(hard_reserved, bridge_cell, 2)
    for poi in layout.get("points_of_interest", []):
        if "surface_pad_bounds" in poi:
            hard_reserved.update(cells_in_rect(poi["surface_pad_bounds"], 2))
        for key in ("portal_anchor_cell", "anchor_cell"):
            if key in poi:
                reserve_square(hard_reserved, tuple(poi[key]), 2)

    fixed_prop_reserved: set[Cell] = set()
    for cell, _rotation in kiosk_specs:
        reserve_square(fixed_prop_reserved, cell, 1)
    for cells in vehicle_cells.values():
        for x, y, _heading in cells:
            reserve_square(fixed_prop_reserved, (x, y), 1)

    def near(cell: Cell, targets: set[Cell], radius: int) -> bool:
        x, y = cell
        return any((x + dx, y + dy) in targets for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1))

    def city(cell: Cell) -> bool:
        return -48 <= cell[0] <= 47 and -40 <= cell[1] <= 45

    occupied: set[Cell] = set()
    tree_positions: list[Cell] = []
    shrub_positions: list[Cell] = []
    placements: list[dict[str, Any]] = []

    def add(asset_id: str, cell: tuple[float, float], *, rotation: float | None = None, anchor: str = "ground", surface_y: float | None = None, sink_m: float = 0.0, jitter: bool = False) -> None:
        px, pz = world_position(cell)
        if jitter:
            rank = fnv_rank(asset_id, *cell)
            px += ((rank & 255) / 255.0 - 0.5) * 0.7
            pz += (((rank >> 8) & 255) / 255.0 - 0.5) * 0.7
        record: dict[str, Any] = {
            "id": f"{asset_id}_{len(placements) + 1:04d}",
            "assetId": asset_id,
            "cell": [cell[0], cell[1]],
            "position": [round(px, 3), round(pz, 3)],
            "yawDegrees": rotation if rotation is not None else yaw(asset_id, cell),
            "anchor": anchor,
        }
        if surface_y is not None:
            record["surfaceY"] = surface_y
        if sink_m:
            record["sinkM"] = sink_m
        placements.append(record)

    def select(
        asset_id: str,
        count: int,
        candidates: Iterable[Cell],
        minimum_space: int,
        group: list[Cell],
        *,
        jitter: bool = True,
        candidate_ok: Callable[[Cell], bool] | None = None,
        rotation_for_cell: Callable[[Cell], float] | None = None,
    ) -> None:
        ranked = sorted(set(candidates), key=lambda cell: fnv_rank(asset_id, *cell))
        selected = 0
        for spacing in range(minimum_space, 0, -1):
            for cell in ranked:
                if selected >= count:
                    return
                if (
                    cell in occupied
                    or (candidate_ok is not None and not candidate_ok(cell))
                    or any(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) < spacing for other in group)
                ):
                    continue
                occupied.add(cell)
                group.append(cell)
                add(asset_id, cell, rotation=rotation_for_cell(cell) if rotation_for_cell else None, jitter=jitter)
                selected += 1
        if selected != count:
            raise RuntimeError(f"Only placed {selected}/{count} instances for {asset_id}")

    safe_land = land - hard_reserved - fixed_prop_reserved
    tree_candidates = [cell for cell in safe_land - soft_reserved if near(cell, routes | water, 5)]
    shrub_candidates = [cell for cell in safe_land if near(cell, routes | water, 3)]
    waterfront_land = [cell for cell in safe_land - soft_reserved if near(cell, water, 2)]
    route_edge_land = [cell for cell in safe_land if near(cell, routes, 1)]

    def normalize_alias(alias: str, asset_id: str) -> None:
        for record in placements:
            if record["assetId"] == alias:
                record["assetId"] = asset_id
                record["id"] = record["id"].replace(alias, asset_id)

    def split_select(
        asset_id: str,
        city_count: int,
        outer_count: int,
        candidates: list[Cell],
        space: int,
        group: list[Cell],
        *,
        jitter: bool = True,
        candidate_ok: Callable[[Cell], bool] | None = None,
        rotation_for_cell: Callable[[Cell], float] | None = None,
    ) -> None:
        city_alias = f"{asset_id}:city"
        select(
            city_alias,
            city_count,
            (cell for cell in candidates if city(cell)),
            space,
            group,
            jitter=jitter,
            candidate_ok=candidate_ok,
            rotation_for_cell=rotation_for_cell,
        )
        # Restore the real asset id in records while retaining a distinct ranking seed.
        normalize_alias(city_alias, asset_id)
        outer_alias = f"{asset_id}:outer"
        select(
            outer_alias,
            outer_count,
            (cell for cell in candidates if not city(cell)),
            space,
            group,
            jitter=jitter,
            candidate_ok=candidate_ok,
            rotation_for_cell=rotation_for_cell,
        )
        normalize_alias(outer_alias, asset_id)

    split_select("tr01_sunleaf_tree", 42, 36, tree_candidates, 5, tree_positions)
    split_select("tr02_bloomfruit_tree", 28, 22, tree_candidates, 5, tree_positions)
    split_select("tr03_tidepalm", 28, 24, waterfront_land, 4, tree_positions)

    split_select("sh01_sunleaf_shrub", 54, 42, shrub_candidates, 2, shrub_positions)
    split_select("sh02_solarbloom_shrub", 56, 40, shrub_candidates, 2, shrub_positions)
    split_select("sh03_raingarden_reeds", 36, 36, waterfront_land, 2, shrub_positions)

    # The initial logo-density pass favors routes and water. A second,
    # deterministic coverage pass prevents the broad highland chunks from
    # becoming visually empty: every substantially-land chunk gets at least
    # one tree and two shrubs, without relaxing any authored exclusion.
    def chunk_index(cell: Cell) -> tuple[int, int]:
        return (
            math.floor((cell[0] - bounds_min[0]) / 16),
            math.floor((cell[1] - bounds_min[1]) / 16),
        )

    land_by_chunk: dict[tuple[int, int], list[Cell]] = defaultdict(list)
    for cell in land:
        land_by_chunk[chunk_index(cell)].append(cell)

    def coverage_count(group: list[Cell], chunk: tuple[int, int]) -> int:
        return sum(1 for cell in group if chunk_index(cell) == chunk)

    for chunk in sorted(land_by_chunk, key=lambda value: (value[1], value[0])):
        if len(land_by_chunk[chunk]) < 128:
            continue
        chunk_safe = [cell for cell in land_by_chunk[chunk] if cell in safe_land]
        missing_trees = max(0, 1 - coverage_count(tree_positions, chunk))
        for slot in range(missing_trees):
            choice = fnv_rank(f"coverage-tree-{chunk}-{slot}", *chunk)
            asset_id = "tr01_sunleaf_tree" if choice % 2 == 0 else "tr02_bloomfruit_tree"
            alias = f"{asset_id}:coverage:{chunk[0]}:{chunk[1]}:{slot}"
            select(alias, 1, (cell for cell in chunk_safe if cell not in soft_reserved), 5, tree_positions)
            normalize_alias(alias, asset_id)

        missing_shrubs = max(0, 2 - coverage_count(shrub_positions, chunk))
        for slot in range(missing_shrubs):
            choice = fnv_rank(f"coverage-shrub-{chunk}-{slot}", *chunk)
            asset_id = "sh01_sunleaf_shrub" if choice % 2 == 0 else "sh02_solarbloom_shrub"
            alias = f"{asset_id}:coverage:{chunk[0]}:{chunk[1]}:{slot}"
            select(alias, 1, chunk_safe, 2, shrub_positions)
            normalize_alias(alias, asset_id)

    footprint_radius_m = {
        "tr01_sunleaf_tree": 3.13,
        "tr02_bloomfruit_tree": 3.19,
        "tr03_tidepalm": 3.05,
        "sh01_sunleaf_shrub": 0.87,
        "sh02_solarbloom_shrub": 0.71,
        "sh03_raingarden_reeds": 0.64,
        "st01_sunrail_lamp": 1.21,
        "st02_gardenline_bench": 1.25,
        "st03_modular_planter": 1.05,
    }

    def street_clear(asset_id: str, cell: Cell) -> bool:
        px, pz = world_position(cell)
        own_radius = footprint_radius_m[asset_id]
        for record in placements:
            other_id = record["assetId"]
            if not (other_id.startswith("tr") or other_id.startswith("sh")):
                continue
            other_radius = footprint_radius_m[other_id]
            distance = math.hypot(px - record["position"][0], pz - record["position"][1])
            padding = 0.25 if other_id.startswith("tr") else 0.15
            if distance < own_radius + other_radius + padding:
                return False
        return True

    def nearest_axis(cell: Cell, targets: set[Cell]) -> str:
        cx, cy = cell
        nearest = min(targets, key=lambda target: ((target[0] - cx) ** 2 + (target[1] - cy) ** 2, target[1], target[0]))
        nx, ny = nearest
        horizontal = int((nx - 1, ny) in targets) + int((nx + 1, ny) in targets)
        vertical = int((nx, ny - 1) in targets) + int((nx, ny + 1) in targets)
        if horizontal == vertical:
            local = [target for target in targets if max(abs(target[0] - nx), abs(target[1] - ny)) <= 2]
            horizontal = max((target[0] for target in local), default=nx) - min((target[0] for target in local), default=nx)
            vertical = max((target[1] for target in local), default=ny) - min((target[1] for target in local), default=ny)
        return "horizontal" if horizontal >= vertical else "vertical"

    def bench_rotation(cell: Cell) -> float:
        # The optimized bench's long axis is local Z.
        return 90.0 if nearest_axis(cell, routes | water) == "horizontal" else 0.0

    def planter_rotation(cell: Cell) -> float:
        return 0.0 if nearest_axis(cell, routes) == "horizontal" else 90.0

    street_positions: list[Cell] = []
    split_select(
        "st01_sunrail_lamp", 40, 24, route_edge_land, 4, street_positions,
        jitter=False, candidate_ok=lambda cell: street_clear("st01_sunrail_lamp", cell),
        rotation_for_cell=lambda _cell: 270.0,
    )
    split_select(
        "st02_gardenline_bench", 12, 12, route_edge_land + waterfront_land, 5, street_positions,
        jitter=False, candidate_ok=lambda cell: street_clear("st02_gardenline_bench", cell),
        rotation_for_cell=bench_rotation,
    )
    split_select(
        "st03_modular_planter", 18, 9, route_edge_land, 3, street_positions,
        jitter=False, candidate_ok=lambda cell: street_clear("st03_modular_planter", cell),
        rotation_for_cell=planter_rotation,
    )

    for cell, rotation in kiosk_specs:
        if cell not in land or cell in hard_reserved:
            raise RuntimeError(f"Unsafe kiosk placement at {cell}")
        add("st04_wayfinding_kiosk", cell, rotation=rotation)

    headings = {"E": 0.0, "N": 90.0, "W": 180.0, "S": 270.0}
    placed_vehicle_cells: list[Cell] = []
    for asset_id, cells in vehicle_cells.items():
        for x, y, heading in cells:
            if surface.get((x, y)) != "road":
                raise RuntimeError(f"Vehicle {asset_id} is not on a road at {(x, y)}")
            if near((x, y), bridge_cells, 2):
                raise RuntimeError(f"Vehicle {asset_id} is too close to a bridge at {(x, y)}")
            if near((x, y), functional_sockets, 2):
                raise RuntimeError(f"Vehicle {asset_id} obstructs a functional socket at {(x, y)}")
            if any(max(abs(x - other[0]), abs(y - other[1])) < 3 for other in placed_vehicle_cells):
                raise RuntimeError(f"Vehicle traffic spacing failed at {(x, y)}")
            placed_vehicle_cells.append((x, y))
            add(asset_id, (x, y), rotation=headings[heading])

    for asset_id, cells in boat_cells.items():
        for x, y, heading in cells:
            # The half-cell ferry is tied directly to the government dock; the
            # other craft are verified against the terrain raster.
            if float(x).is_integer() and surface.get((int(x), y)) != "ocean":
                raise RuntimeError(f"Boat {asset_id} is not on ocean at {(x, y)}")
            add(asset_id, (x, y), rotation=headings[heading], anchor="water", surface_y=-0.18, sink_m=0.34 if asset_id.startswith("bv01") else 0.27)

    counts = Counter(record["assetId"] for record in placements)
    minimum_expected = {
        "tr01_sunleaf_tree": 78, "tr02_bloomfruit_tree": 50, "tr03_tidepalm": 52,
        "sh01_sunleaf_shrub": 96, "sh02_solarbloom_shrub": 96, "sh03_raingarden_reeds": 72,
        "st01_sunrail_lamp": 64, "st02_gardenline_bench": 24, "st03_modular_planter": 27,
        "st04_wayfinding_kiosk": 9, "mv01_sunpod_microcar": 12, "mv02_market_cargo_cart": 8,
        "mv03_civic_shuttle": 4, "bv01_sunwake_ferry": 3, "bv02_makers_workboat": 4,
    }
    exact_assets = {
        "tr03_tidepalm", "sh03_raingarden_reeds",
        "st01_sunrail_lamp", "st02_gardenline_bench", "st03_modular_planter", "st04_wayfinding_kiosk",
        "mv01_sunpod_microcar", "mv02_market_cargo_cart", "mv03_civic_shuttle",
        "bv01_sunwake_ferry", "bv02_makers_workboat",
    }
    for asset_id, minimum in minimum_expected.items():
        if counts[asset_id] < minimum or (asset_id in exact_assets and counts[asset_id] != minimum):
            raise RuntimeError(f"Placement count drift for {asset_id}: {counts[asset_id]} (expected {minimum})")

    asset_category = {asset["id"]: asset["category"] for asset in build["assets"]}
    placement_cells = {record["id"]: tuple(record["cell"]) for record in placements}
    for record in placements:
        category = asset_category[record["assetId"]]
        cell = placement_cells[record["id"]]
        integer_cell = (round(cell[0]), round(cell[1]))
        kind = surface.get(integer_cell)
        if category in {"trees", "shrubs", "street"}:
            if not kind or not kind.startswith("land_l"):
                raise RuntimeError(f"{record['id']} is not anchored to land at {cell}")
            if integer_cell in hard_reserved:
                raise RuntimeError(f"{record['id']} violates a hard exclusion at {cell}")
            if category == "trees" and integer_cell in soft_reserved:
                raise RuntimeError(f"{record['id']} violates tree/building clearance at {cell}")
        elif category == "vehicles" and kind != "road":
            raise RuntimeError(f"{record['id']} is not anchored to road at {cell}")
        elif category == "boats" and float(cell[0]).is_integer() and kind != "ocean":
            raise RuntimeError(f"{record['id']} is not anchored to ocean at {cell}")

    for chunk, chunk_land in land_by_chunk.items():
        if len(chunk_land) < 128:
            continue
        if coverage_count(tree_positions, chunk) < 1 or coverage_count(shrub_positions, chunk) < 2:
            raise RuntimeError(f"Natural coverage contract failed for chunk {chunk}")

    final_tree_records = [record for record in placements if record["assetId"].startswith("tr")]
    final_shrub_records = [record for record in placements if record["assetId"].startswith("sh")]
    for record in placements:
        if not record["assetId"].startswith("st0") or record["assetId"].startswith("st04"):
            continue
        own_radius = footprint_radius_m[record["assetId"]]
        for other in final_tree_records + final_shrub_records:
            other_radius = footprint_radius_m[other["assetId"]]
            padding = 0.25 if other["assetId"].startswith("tr") else 0.15
            distance = math.hypot(record["position"][0] - other["position"][0], record["position"][1] - other["position"][1])
            if distance < own_radius + other_radius + padding:
                raise RuntimeError(f"Street/landscape footprint overlap: {record['id']} and {other['id']}")

    water_lookup = {tuple(record["cell"]): record for record in hydrology["water_cells"]}
    manifest = {
        "schema": "markets-and-makers.world-designs-runtime.v1",
        "version": "1.0.0",
        "visualTarget": "MM Logo.png garden-city-on-water composition",
        "coordinateContract": {
            "cellToThree": "(x, y, elevation) -> (2*x, 1+elevation, -2*y)",
            "tileSizeM": 2,
            "oceanY": -0.18,
            "naturalWaterY": "0.62 + elevation level",
            "civicCanalY": 0.68,
        },
        "streaming": {"grouping": "asset plus terrain chunk", "radiusChunks": 3},
        "counts": {
            "uniqueAssets": len(build["assets"]),
            "staticPlacements": len(placements),
            "dynamicAvatar": 1,
            "totalInstances": len(placements) + 1,
            "byAsset": dict(sorted(counts.items())),
        },
        "exclusions": {
            "plots": "two-cell clearance",
            "governmentBuildings": "one-cell hard and three-cell tree clearance",
            "entrancesUtilities": "two-cell clearance",
            "bridges": "two-cell clearance around every terrain bridge cell",
            "pointsOfInterest": "two-cell clearance around pads, portals and anchors",
            "fixedProps": "one-cell clearance around kiosks and road vehicles",
            "streetLandscape": "authored-footprint radius plus safety padding",
            "walkableMeshes": "decorations are visual-only and never registered as walkable terrain",
        },
        "assets": build["assets"],
        "placements": placements,
        "sourceLocks": {
            "layoutSha256": hashlib.sha256((args.world / "layout.json").read_bytes()).hexdigest(),
            "terrainGridSha256": hashlib.sha256((args.world / "terrain-grid.json").read_bytes()).hexdigest(),
            "hydrologySha256": hashlib.sha256((args.world / "hydrology.json").read_bytes()).hexdigest(),
        },
    }
    args.runtime.mkdir(parents=True, exist_ok=True)
    (args.runtime / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if args.preview:
        scale = 8
        width = (bounds_max[0] - bounds_min[0] + 1) * scale
        height = (bounds_max[1] - bounds_min[1] + 1) * scale
        image = Image.new("RGB", (width, height), (20, 139, 165))
        draw = ImageDraw.Draw(image)
        colors = defaultdict(lambda: (100, 155, 79), {
            "ocean": (13, 142, 173), "natural_water": (40, 165, 184), "civic_canal": (65, 184, 190),
            "road": (204, 190, 148), "path": (226, 211, 171), "empty_plot": (188, 162, 99), "bridge": (167, 121, 74),
        })
        for (x, y), kind in surface.items():
            sx, sy = (x - bounds_min[0]) * scale, (bounds_max[1] - y) * scale
            draw.rectangle((sx, sy, sx + scale - 1, sy + scale - 1), fill=colors[kind])
        marker_colors = {
            "trees": (25, 77, 38), "shrubs": (112, 42, 121), "street": (255, 210, 67),
            "vehicles": (224, 87, 53), "boats": (245, 248, 232),
        }
        asset_category = {asset["id"]: asset["category"] for asset in build["assets"]}
        for record in placements:
            x, y = record["cell"]
            sx, sy = (x - bounds_min[0]) * scale, (bounds_max[1] - y) * scale
            color = marker_colors[asset_category[record["assetId"]]]
            radius = 5 if asset_category[record["assetId"]] in {"vehicles", "boats"} else 3
            draw.ellipse((sx - radius, sy - radius, sx + radius, sy + radius), fill=color, outline=(13, 53, 54), width=1)
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.preview, "PNG", optimize=True)

    print(f"Generated {len(placements)} static placements + 1 avatar across {len(build['assets'])} assets.")


if __name__ == "__main__":
    main()
