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

    def component_sizes(cells: set[Cell]) -> list[int]:
        remaining = set(cells)
        sizes: list[int] = []
        while remaining:
            seed = remaining.pop()
            pending = [seed]
            size = 0
            while pending:
                x, y = pending.pop()
                size += 1
                for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        pending.append(neighbor)
            sizes.append(size)
        return sorted(sizes, reverse=True)

    road_component_sizes = component_sizes({cell for cell, kind in surface.items() if kind == "road"} | bridge_cells)
    route_component_sizes = component_sizes(routes | bridge_cells)

    catalog = load(Path(__file__).with_name("assets.json"))
    grounding_by_asset = {asset["id"]: asset["grounding"] for asset in catalog["assets"]}
    runtime_assets = []
    for built_asset in build["assets"]:
        runtime_asset = dict(built_asset)
        runtime_asset["grounding"] = grounding_by_asset[built_asset["id"]]
        runtime_assets.append(runtime_asset)

    preferred_kiosk_cells = [
        (3, 7), (-13, 7), (12, 7), (17, -27), (17, 9),
        (17, -7), (-43, -7), (-18, 9), (41, 9),
    ]
    preferred_vehicle_cells = {
        "mv01_sunpod_microcar": [(-44, -23, "N"), (-45, 15, "S"), (-30, -18, "N"), (-31, 14, "S"), (29, -16, "N"), (28, 14, "S"), (43, -17, "N"), (42, 18, "S"), (-18, -31, "E"), (6, -30, "W"), (-20, 6, "E"), (25, 7, "W")],
        "mv02_market_cargo_cart": [(-36, -31, "E"), (20, -30, "W"), (-40, -11, "E"), (35, -10, "W"), (-25, 20, "E"), (22, 21, "W"), (-40, 24, "E"), (36, 25, "W")],
        "mv03_civic_shuttle": [(-5, -11, "E"), (24, -30, "W"), (5, 20, "E"), (30, 37, "E")],
    }
    boat_cells = {
        "bv01_sunwake_ferry": [(26.5, -46, "N"), (-20, -49, "E"), (68, -51, "W")],
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

    def near(cell: Cell, targets: set[Cell], radius: int) -> bool:
        x, y = cell
        return any((x + dx, y + dy) in targets for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1))

    def city(cell: Cell) -> bool:
        return -48 <= cell[0] <= 47 and -40 <= cell[1] <= 45

    def land_level(cell: Cell) -> int | None:
        kind = surface.get(cell, "")
        return int(kind.removeprefix("land_l")) if kind.startswith("land_l") else None

    def authored_surface_y(cell: Cell) -> float:
        level = land_level(cell)
        if level is not None:
            return float(1 + level)
        # Roads mask the underlying terrace label in the compact raster. Its
        # nearest land shoulder is the canonical authored road height.
        nearest: list[tuple[int, int]] = []
        for radius in range(1, 5):
            nearest = [
                (abs(dx) + abs(dy), candidate_level)
                for dx in range(-radius, radius + 1)
                for dy in range(-radius, radius + 1)
                if (candidate_level := land_level((cell[0] + dx, cell[1] + dy))) is not None
                and abs(dx) + abs(dy) == radius
            ]
            if nearest:
                break
        if not nearest:
            raise RuntimeError(f"No authored land height near ground cell {cell}")
        counts = Counter(level_value for _distance, level_value in nearest)
        return float(1 + min(counts, key=lambda value: (-counts[value], value)))

    def flat_land(cell: Cell, radius: int) -> bool:
        level = land_level(cell)
        if level is None:
            return False
        return all(
            land_level((cell[0] + dx, cell[1] + dy)) == level
            for dx in range(-radius, radius + 1)
            for dy in range(-radius, radius + 1)
        )

    occupied: set[Cell] = set()
    tree_positions: list[Cell] = []
    shrub_positions: list[Cell] = []
    placements: list[dict[str, Any]] = []

    def add(
        asset_id: str,
        cell: tuple[float, float],
        *,
        rotation: float | None = None,
        anchor: str = "ground",
        surface_y: float | None = None,
        jitter: bool = False,
        position_offset: tuple[float, float] = (0.0, 0.0),
        roadside: dict[str, Any] | None = None,
    ) -> None:
        px, pz = world_position(cell)
        base_asset_id = asset_id.split(":", 1)[0]
        if jitter:
            rank = fnv_rank(base_asset_id, *cell)
            px += ((rank & 255) / 255.0 - 0.5) * 0.7
            pz += (((rank >> 8) & 255) / 255.0 - 0.5) * 0.7
        px += position_offset[0]
        pz += position_offset[1]
        record: dict[str, Any] = {
            "id": f"{asset_id}_{len(placements) + 1:04d}",
            "assetId": asset_id,
            "cell": [cell[0], cell[1]],
            "position": [round(px, 3), round(pz, 3)],
            "yawDegrees": rotation if rotation is not None else yaw(base_asset_id, cell),
            "anchor": anchor,
        }
        if surface_y is None and anchor == "ground" and float(cell[0]).is_integer() and float(cell[1]).is_integer():
            surface_y = authored_surface_y((int(cell[0]), int(cell[1])))
        if surface_y is not None:
            record["surfaceY"] = round(surface_y, 3)
        if roadside is not None:
            record["roadside"] = roadside
        placements.append(record)

    def rotated_xz(point: tuple[float, float] | list[float], rotation: float) -> tuple[float, float]:
        radians = math.radians(rotation % 360.0)
        cosine, sine = math.cos(radians), math.sin(radians)
        return cosine * point[0] + sine * point[1], -sine * point[0] + cosine * point[1]

    def planned_position(
        asset_id: str,
        cell: Cell,
        *,
        jitter: bool = False,
        position_offset: tuple[float, float] = (0.0, 0.0),
    ) -> tuple[float, float]:
        px, pz = world_position(cell)
        if jitter:
            rank = fnv_rank(asset_id, *cell)
            px += ((rank & 255) / 255.0 - 0.5) * 0.7
            pz += (((rank >> 8) & 255) / 255.0 - 0.5) * 0.7
        return px + position_offset[0], pz + position_offset[1]

    def footprint_cells(
        asset_id: str,
        position: tuple[float, float],
        rotation: float,
    ) -> set[Cell]:
        grounding = grounding_by_asset[asset_id]
        # footprintM/supportPoints are curated around the desired base pivot.
        # baseAnchorXZ only shifts bbox-normalized geometry onto that pivot.
        center_x, center_z = position
        radians = math.radians(rotation % 360.0)
        cosine, sine = abs(math.cos(radians)), abs(math.sin(radians))
        width_x = cosine * grounding["footprintM"][0] + sine * grounding["footprintM"][1]
        width_z = sine * grounding["footprintM"][0] + cosine * grounding["footprintM"][1]
        epsilon = 1e-6
        minimum_x = math.ceil((center_x - width_x / 2 - 1 + epsilon) / 2)
        maximum_x = math.floor((center_x + width_x / 2 + 1 - epsilon) / 2)
        minimum_y = math.ceil((-center_z - width_z / 2 - 1 + epsilon) / 2)
        maximum_y = math.floor((-center_z + width_z / 2 + 1 - epsilon) / 2)
        return {
            (x, y)
            for y in range(minimum_y, maximum_y + 1)
            for x in range(minimum_x, maximum_x + 1)
        }

    def footprint_is_clear(
        asset_id: str,
        cell: Cell,
        *,
        rotation: float,
        jitter: bool = False,
        position_offset: tuple[float, float] = (0.0, 0.0),
    ) -> bool:
        cells = footprint_cells(
            asset_id,
            planned_position(asset_id, cell, jitter=jitter, position_offset=position_offset),
            rotation,
        )
        if any(occupied_cell in hard_reserved for occupied_cell in cells):
            return False
        if asset_id.startswith("tr") and any(occupied_cell in soft_reserved for occupied_cell in cells):
            return False
        return True

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
        placement_for_cell: Callable[[Cell], dict[str, Any]] | None = None,
        relax_spacing: bool = False,
    ) -> None:
        ranked = sorted(set(candidates), key=lambda cell: fnv_rank(asset_id, *cell))
        selected = 0
        spacings = range(minimum_space, 0, -1) if relax_spacing else (minimum_space,)
        for spacing in spacings:
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
                placement_options = placement_for_cell(cell) if placement_for_cell else {}
                add(
                    asset_id,
                    cell,
                    rotation=rotation_for_cell(cell) if rotation_for_cell else None,
                    jitter=jitter,
                    **placement_options,
                )
                selected += 1
        if selected != count:
            raise RuntimeError(f"Only placed {selected}/{count} instances for {asset_id}")

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
        placement_for_cell: Callable[[Cell], dict[str, Any]] | None = None,
        relax_spacing: bool = False,
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
            placement_for_cell=placement_for_cell,
            relax_spacing=relax_spacing,
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
            placement_for_cell=placement_for_cell,
            relax_spacing=relax_spacing,
        )
        normalize_alias(outer_alias, asset_id)

    cardinal = ((1, 0), (-1, 0), (0, 1), (0, -1))

    def roadside_socket(cell: Cell) -> dict[str, Any] | None:
        neighbors = [
            (cell[0] + dx, cell[1] + dy)
            for dx, dy in cardinal
            if (cell[0] + dx, cell[1] + dy) in routes
        ]
        if len(neighbors) != 1:
            return None
        route_cell = neighbors[0]
        rx, ry = route_cell
        horizontal = (rx - 1, ry) in routes and (rx + 1, ry) in routes
        vertical = (rx, ry - 1) in routes and (rx, ry + 1) in routes
        if horizontal == vertical:
            return None
        tangent = "EW" if horizontal else "NS"
        dx, dy = cell[0] - rx, cell[1] - ry
        side = "E" if dx == 1 else "W" if dx == -1 else "N" if dy == 1 else "S"
        return {
            "routeCell": [rx, ry],
            "routeSurface": surface[route_cell],
            "side": side,
            "tangent": tangent,
            "offsetM": 0.0,
            "outwardGrid": (dx, dy),
        }

    def straight_route_axis(cell: Cell) -> str | None:
        route_surface = surface.get(cell)
        if route_surface not in {"road", "path"}:
            return None
        x, y = cell
        horizontal = surface.get((x - 1, y)) == route_surface and surface.get((x + 1, y)) == route_surface
        vertical = surface.get((x, y - 1)) == route_surface and surface.get((x, y + 1)) == route_surface
        if horizontal == vertical:
            return None

        def route_continues(dx: int, dy: int) -> bool:
            return surface.get((x + dx, y + dy)) in {"road", "path"} and surface.get((x + 2 * dx, y + 2 * dy)) in {"road", "path"}

        if horizontal and (route_continues(0, -1) or route_continues(0, 1)):
            return None
        if vertical and (route_continues(-1, 0) or route_continues(1, 0)):
            return None
        return "EW" if horizontal else "NS"

    route_axis_by_cell = {cell: straight_route_axis(cell) for cell in routes}
    route_transition_cells = {cell for cell, axis in route_axis_by_cell.items() if axis is None}
    for cell, axis in route_axis_by_cell.items():
        if axis is None:
            continue
        step = (1, 0) if axis == "EW" else (0, 1)
        if any(route_axis_by_cell.get((cell[0] + step[0] * direction, cell[1] + step[1] * direction)) != axis for direction in (-1, 1)):
            route_transition_cells.add(cell)

    def bank_side_is_safe(cell: Cell, socket: dict[str, Any]) -> bool:
        if not near(cell, water, 3):
            return True
        outward_x, outward_y = socket["outwardGrid"]
        for water_cell in water:
            dx, dy = water_cell[0] - cell[0], water_cell[1] - cell[1]
            if max(abs(dx), abs(dy)) <= 3 and dx * outward_x + dy * outward_y > 0:
                return False
        return True

    def roadside_support_is_flat(cell: Cell, socket: dict[str, Any]) -> bool:
        level = land_level(cell)
        if level is None:
            return False
        if socket["tangent"] == "EW":
            support_cells = [(cell[0] - 1, cell[1]), (cell[0] + 1, cell[1])]
        else:
            support_cells = [(cell[0], cell[1] - 1), (cell[0], cell[1] + 1)]
        outward_x, outward_y = socket["outwardGrid"]
        support_cells.append((cell[0] + outward_x, cell[1] + outward_y))
        return all(land_level(support) == level for support in support_cells)

    socket_by_cell: dict[Cell, dict[str, Any]] = {}
    for cell in land - hard_reserved:
        socket = roadside_socket(cell)
        if (
            socket is not None
            and route_axis_by_cell.get(tuple(socket["routeCell"])) == socket["tangent"]
            and not near(socket["routeCell"], route_transition_cells, 3)
            and not near(cell, bridge_cells, 2)
            and not near(cell, functional_sockets, 2)
            and bank_side_is_safe(cell, socket)
            and roadside_support_is_flat(cell, socket)
        ):
            socket_by_cell[cell] = socket

    def road_axis(cell: Cell) -> str | None:
        return route_axis_by_cell.get(cell) if surface.get(cell) == "road" else None

    headings = {"E": 0.0, "N": 90.0, "W": 180.0, "S": 270.0}
    heading_axis = {"E": "EW", "W": "EW", "N": "NS", "S": "NS"}
    road_cells = {cell for cell, kind in surface.items() if kind == "road"}
    placed_vehicle_cells: list[Cell] = []

    def inferred_route_surface_y(cell: Cell) -> float | None:
        levels = {
            level
            for dx in range(-2, 3)
            for dy in range(-2, 3)
            if (level := land_level((cell[0] + dx, cell[1] + dy))) is not None
        }
        return float(1 + next(iter(levels))) if len(levels) == 1 else None

    def vehicle_lane_offset(asset_id: str, cell: Cell, axis: str) -> tuple[float, float]:
        if axis == "EW":
            inward_steps = [(0, dy) for dy in (-1, 1) if surface.get((cell[0], cell[1] + dy)) == "road"]
        else:
            inward_steps = [(dx, 0) for dx in (-1, 1) if surface.get((cell[0] + dx, cell[1])) == "road"]
        if len(inward_steps) != 1:
            return (0.0, 0.0)
        inset = {"mv01_sunpod_microcar": 0.08, "mv02_market_cargo_cart": 0.02, "mv03_civic_shuttle": 0.35}[asset_id]
        return inward_steps[0][0] * inset, -inward_steps[0][1] * inset

    def vehicle_candidate_is_safe(asset_id: str, cell: Cell, heading: str) -> bool:
        axis = heading_axis[heading]
        position_offset = vehicle_lane_offset(asset_id, cell, axis)
        cells = footprint_cells(
            asset_id,
            planned_position(asset_id, cell, position_offset=position_offset),
            headings[heading],
        )
        return (
            inferred_route_surface_y(cell) is not None
            and all(surface.get(footprint_cell) == "road" for footprint_cell in cells)
            and not any(footprint_cell in hard_reserved for footprint_cell in cells)
            and not any(footprint_cell in route_transition_cells for footprint_cell in cells)
        )

    def snap_vehicle(preferred: Cell, heading: str, asset_id: str) -> Cell:
        candidates = sorted(
            road_cells,
            key=lambda cell: (
                abs(cell[0] - preferred[0]) + abs(cell[1] - preferred[1]),
                fnv_rank(f"{asset_id}:{preferred}", *cell),
            ),
        )
        for cell in candidates:
            if abs(cell[0] - preferred[0]) + abs(cell[1] - preferred[1]) > 40:
                break
            # Long shuttles need a wider turn/crosswalk envelope. Compact cars
            # still clear the intersection cells themselves plus one cell.
            junction_padding = 2 if asset_id == "mv03_civic_shuttle" else 1
            if (
                road_axis(cell) != heading_axis[heading]
                or cell in hard_reserved
                or near(cell, bridge_cells, 2)
                or near(cell, functional_sockets, 2)
                or near(cell, route_transition_cells, junction_padding)
                or any(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) < 3 for other in placed_vehicle_cells)
                or not vehicle_candidate_is_safe(asset_id, cell, heading)
            ):
                continue
            return cell
        raise RuntimeError(f"No safe {heading_axis[heading]} road parking socket near {preferred} for {asset_id}")

    for asset_id, cells in preferred_vehicle_cells.items():
        for preferred_x, preferred_y, heading in cells:
            vehicle_cell = snap_vehicle((preferred_x, preferred_y), heading, asset_id)
            placed_vehicle_cells.append(vehicle_cell)
            add(
                asset_id,
                vehicle_cell,
                rotation=headings[heading],
                surface_y=inferred_route_surface_y(vehicle_cell),
                position_offset=vehicle_lane_offset(asset_id, vehicle_cell, heading_axis[heading]),
            )

    vehicle_buffer: set[Cell] = set()
    for vehicle_cell in placed_vehicle_cells:
        reserve_square(vehicle_buffer, vehicle_cell, 2)

    street_candidates = [cell for cell in socket_by_cell if cell not in vehicle_buffer]
    road_street_candidates = [cell for cell in street_candidates if socket_by_cell[cell]["routeSurface"] == "road"]
    path_street_candidates = [cell for cell in street_candidates if socket_by_cell[cell]["routeSurface"] == "path"]
    street_positions: list[Cell] = []

    def axis_yaw(forward_axis: str, desired_x: float, desired_z: float) -> float:
        radians = math.atan2(desired_x, desired_z) if forward_axis == "z" else math.atan2(-desired_z, desired_x)
        return round(math.degrees(radians) % 360.0, 3)

    def street_rotation(asset_id: str, cell: Cell) -> float:
        socket = socket_by_cell[cell]
        outward_x, outward_y = socket["outwardGrid"]
        if asset_id in {"st01_sunrail_lamp", "st04_wayfinding_kiosk"}:
            # Face the route. Authored cell +Y maps to world -Z.
            desired_x, desired_z = -outward_x, outward_y
        elif socket["tangent"] == "EW":
            desired_x, desired_z = 1.0, 0.0
        else:
            desired_x, desired_z = 0.0, -1.0
        return axis_yaw(grounding_by_asset[asset_id]["forwardAxis"], desired_x, desired_z)

    street_offsets = {
        "st01_sunrail_lamp": 0.25,
        "st02_gardenline_bench": 0.4,
        "st03_modular_planter": 0.2,
        "st04_wayfinding_kiosk": 0.35,
    }

    def street_options(asset_id: str, cell: Cell) -> dict[str, Any]:
        socket = socket_by_cell[cell]
        outward_x, outward_y = socket["outwardGrid"]
        offset = street_offsets[asset_id]
        roadside = {key: socket[key] for key in ("routeCell", "routeSurface", "side", "tangent")}
        roadside["offsetM"] = offset
        return {
            "position_offset": (outward_x * offset, -outward_y * offset),
            "roadside": roadside,
        }

    def street_candidate_is_safe(asset_id: str, cell: Cell) -> bool:
        options = street_options(asset_id, cell)
        return footprint_is_clear(
            asset_id,
            cell,
            rotation=street_rotation(asset_id, cell),
            position_offset=options["position_offset"],
        )

    # Reserve the nine district wayfinding anchors before repeating furniture,
    # so lamps and planters cannot push a kiosk away from its intended district.
    for preferred in preferred_kiosk_cells:
        available = [
            cell for cell in path_street_candidates
            if cell not in occupied
            and street_candidate_is_safe("st04_wayfinding_kiosk", cell)
            and all(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) >= 4 for other in street_positions)
        ]
        if not available:
            raise RuntimeError(f"No safe roadside kiosk socket near {preferred}")
        cell = min(
            available,
            key=lambda candidate: (
                abs(candidate[0] - preferred[0]) + abs(candidate[1] - preferred[1]),
                fnv_rank(f"kiosk:{preferred}", *candidate),
            ),
        )
        occupied.add(cell)
        street_positions.append(cell)
        add(
            "st04_wayfinding_kiosk",
            cell,
            rotation=street_rotation("st04_wayfinding_kiosk", cell),
            **street_options("st04_wayfinding_kiosk", cell),
        )

    split_select(
        "st01_sunrail_lamp", 36, 28,
        [cell for cell in road_street_candidates if street_candidate_is_safe("st01_sunrail_lamp", cell)],
        3, street_positions,
        jitter=False,
        rotation_for_cell=lambda cell: street_rotation("st01_sunrail_lamp", cell),
        placement_for_cell=lambda cell: street_options("st01_sunrail_lamp", cell),
    )
    bench_positions: list[Cell] = []
    split_select(
        "st02_gardenline_bench", 12, 12,
        [cell for cell in road_street_candidates if street_candidate_is_safe("st02_gardenline_bench", cell)],
        5, bench_positions,
        jitter=False,
        candidate_ok=lambda cell: all(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) >= 2 for other in street_positions),
        rotation_for_cell=lambda cell: street_rotation("st02_gardenline_bench", cell),
        placement_for_cell=lambda cell: street_options("st02_gardenline_bench", cell),
    )
    street_positions.extend(bench_positions)
    planter_positions: list[Cell] = []
    split_select(
        "st03_modular_planter", 18, 9,
        [cell for cell in road_street_candidates if street_candidate_is_safe("st03_modular_planter", cell)],
        3, planter_positions,
        jitter=False,
        candidate_ok=lambda cell: all(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) >= 2 for other in street_positions),
        rotation_for_cell=lambda cell: street_rotation("st03_modular_planter", cell),
        placement_for_cell=lambda cell: street_options("st03_modular_planter", cell),
    )
    street_positions.extend(planter_positions)

    street_buffer: set[Cell] = set()
    for street_cell in street_positions:
        reserve_square(street_buffer, street_cell, 2)

    safe_land = land - hard_reserved - vehicle_buffer - street_buffer
    tree_candidates = [
        cell for cell in safe_land - soft_reserved
        if not near(cell, routes, 2) and near(cell, routes | water, 5)
    ]
    shrub_candidates = [
        cell for cell in safe_land
        if not near(cell, routes, 1) and near(cell, routes | water, 3)
    ]
    waterfront_land = [
        cell for cell in safe_land - soft_reserved
        if not near(cell, routes, 2) and near(cell, water, 3)
    ]

    def landscape_candidate_is_safe(asset_id: str, cell: Cell, flat_radius: int) -> bool:
        return flat_land(cell, flat_radius) and footprint_is_clear(
            asset_id,
            cell,
            rotation=yaw(asset_id, cell),
            jitter=True,
        )

    # Palms have the most constrained habitat, so reserve verified flat bank
    # sites before the two general-purpose canopy species.
    split_select(
        "tr03_tidepalm", 18, 34, waterfront_land, 3, tree_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("tr03_tidepalm", cell, 1),
    )
    split_select(
        "tr01_sunleaf_tree", 42, 36, tree_candidates, 5, tree_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("tr01_sunleaf_tree", cell, 2),
    )
    split_select(
        "tr02_bloomfruit_tree", 24, 26, tree_candidates, 4, tree_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("tr02_bloomfruit_tree", cell, 2),
    )

    split_select(
        "sh03_raingarden_reeds", 33, 39, waterfront_land, 2, shrub_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("sh03_raingarden_reeds", cell, 1),
    )
    split_select(
        "sh01_sunleaf_shrub", 54, 42, shrub_candidates, 2, shrub_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("sh01_sunleaf_shrub", cell, 1),
    )
    split_select(
        "sh02_solarbloom_shrub", 56, 40, shrub_candidates, 2, shrub_positions,
        candidate_ok=lambda cell: landscape_candidate_is_safe("sh02_solarbloom_shrub", cell, 1),
    )

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
        chunk_safe = [cell for cell in land_by_chunk[chunk] if cell in safe_land and not near(cell, routes, 2)]
        missing_trees = max(0, 1 - coverage_count(tree_positions, chunk))
        for slot in range(missing_trees):
            choice = fnv_rank(f"coverage-tree-{chunk}-{slot}", *chunk)
            asset_id = "tr01_sunleaf_tree" if choice % 2 == 0 else "tr02_bloomfruit_tree"
            alias = f"{asset_id}:coverage:{chunk[0]}:{chunk[1]}:{slot}"
            safe_tree_choices = [
                cell for cell in chunk_safe
                if cell not in soft_reserved
                and cell not in occupied
                and landscape_candidate_is_safe(asset_id, cell, 1)
                and all(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) >= 5 for other in tree_positions)
            ]
            if not safe_tree_choices:
                continue
            select(
                alias, 1, safe_tree_choices, 5, tree_positions,
                candidate_ok=lambda cell: landscape_candidate_is_safe(asset_id, cell, 1),
            )
            normalize_alias(alias, asset_id)

        missing_shrubs = max(0, 2 - coverage_count(shrub_positions, chunk))
        for slot in range(missing_shrubs):
            choice = fnv_rank(f"coverage-shrub-{chunk}-{slot}", *chunk)
            asset_id = "sh01_sunleaf_shrub" if choice % 2 == 0 else "sh02_solarbloom_shrub"
            alias = f"{asset_id}:coverage:{chunk[0]}:{chunk[1]}:{slot}"
            safe_shrub_choices = [
                cell for cell in chunk_safe
                if cell not in occupied
                and landscape_candidate_is_safe(asset_id, cell, 1)
                and all(max(abs(cell[0] - other[0]), abs(cell[1] - other[1])) >= 2 for other in shrub_positions)
            ]
            if not safe_shrub_choices:
                continue
            select(
                alias, 1, safe_shrub_choices, 2, shrub_positions,
                candidate_ok=lambda cell: landscape_candidate_is_safe(asset_id, cell, 1),
            )
            normalize_alias(alias, asset_id)

    for asset_id, cells in boat_cells.items():
        for x, y, heading in cells:
            # The half-cell ferry is tied directly to the government dock; the
            # other craft are verified against the terrain raster.
            if float(x).is_integer() and surface.get((int(x), y)) != "ocean":
                raise RuntimeError(f"Boat {asset_id} is not on ocean at {(x, y)}")
            add(asset_id, (x, y), rotation=headings[heading], anchor="water", surface_y=-0.18)

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

    # Coverage is best-effort at chunk seams: rejecting a safe neighbouring
    # tree merely because its centre lies in the adjacent chunk causes worse
    # visual clustering. Global density and all physical clearances remain hard.

    leaseable_plots = [*layout["plots"]["existing"], *layout["plots"]["added"]]

    def plot_has_route_frontage(plot: dict[str, Any]) -> bool:
        footprint = set(cells_in_rect(plot["occupied_bounds_cells"]))
        return any(
            (cell[0] + dx, cell[1] + dy) in routes
            for cell in footprint
            for dx, dy in cardinal
        )

    frontage_plot_count = sum(1 for plot in leaseable_plots if plot_has_route_frontage(plot))
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
        "spatialPlan": {
            "roadNetwork": {
                "roadCells": sum(1 for kind in surface.values() if kind == "road"),
                "pathCells": sum(1 for kind in surface.values() if kind == "path"),
                "bridgeCells": len(bridge_cells),
                "namedRoads": [road["id"] for road in layout["transport"]["roads"]],
                "namedTrails": [trail["id"] for trail in layout["transport"]["trails"]],
                "namedBridges": [bridge["id"] for bridge in layout["transport"]["bridges"]],
                "roadBridgeComponents": len(road_component_sizes),
                "allRouteComponents": len(route_component_sizes),
                "largestRoadBridgeComponentCells": road_component_sizes[0],
                "largestAllRouteComponentCells": route_component_sizes[0],
                "verifiedRoadsideSockets": len(socket_by_cell),
                "socketRule": "one cardinal route neighbor on a straight segment; never diagonal or at a junction",
            },
            "leaseableLand": {
                "plotCount": len(leaseable_plots),
                "plotCells": sum(1 for kind in surface.values() if kind == "empty_plot"),
                "clearanceCells": 2,
                "plotsWithDirectRouteFrontage": frontage_plot_count,
                "plotsUsingProtectedApproachAisles": len(leaseable_plots) - frontage_plot_count,
                "plotIds": [plot["id"] for plot in leaseable_plots],
            },
            "placementOrder": ["road vehicles", "district kiosks", "lamps", "benches", "planters", "trees", "shrubs", "boats"],
        },
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
            "vehicles": "straight authored road sockets outside junctions and every functional exclusion",
            "streetFurniture": "cardinal straight-route shoulders, outward offsets, tangent-aware yaw and two-cell landscape buffer",
            "terrainSteps": "support footprints remain on one authored land elevation",
            "walkableMeshes": "decorations are visual-only and never registered as walkable terrain",
        },
        "assets": runtime_assets,
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
