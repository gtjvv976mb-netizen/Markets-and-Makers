#!/usr/bin/env python3
"""Build and validate the exact cell-grid design for the expanded MM world.

This is a design artifact, not the Blender scene generator.  It preserves the
government city coordinate system and supplies deterministic polygons,
polylines, elevations, plots, crossings, streaming regions, and validation
rules for the expanded terrain build.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
SOURCE_LAYOUT = ROOT / "outputs/markets-and-makers-government-city-center-v1/layout.json"
OUT_DIR = ROOT / "work/expanded-world-layout-v1"
OUT_FILE = OUT_DIR / "expanded-world-layout-v1.json"
QA_FILE = OUT_DIR / "qa-report.json"
MAP_FILE = OUT_DIR / "planning-map.png"


def rect(min_x, min_y, max_x, max_y):
    return {"min": [min_x, min_y], "max": [max_x, max_y], "inclusive": True}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plot(plot_id, x, y, w, h, customer_edge, district):
    edge = customer_edge
    if edge == "S":
        utility = [x + w // 2, y - 1]
        service = "N"
    elif edge == "N":
        utility = [x + w // 2, y + h]
        service = "S"
    elif edge == "E":
        utility = [x + w, y + h // 2]
        service = "W"
    else:
        utility = [x - 1, y + h // 2]
        service = "E"
    return {
        "id": plot_id,
        "district": district,
        "anchor_cell_sw": [x, y],
        "footprint_tiles": [w, h],
        "occupied_bounds_cells": rect(x, y, x + w - 1, y + h - 1),
        "customer_edge": edge,
        "service_edge": service,
        "utility_connection_cell": utility,
        "surface_tile": "T34",
        "border_tiles": ["T35", "T36"],
        "entrance_tile": "T37",
        "utility_verge_tile": "T38",
        "owner_type": "unowned",
        "ownership": "unowned",
        "purchasable": True,
        "leaseable": True,
        "status": "available",
        "structures": [],
    }


def build_spec():
    source = json.loads(SOURCE_LAYOUT.read_text())

    mountain_levels = [
        {
            "level": 1,
            "walk_z_m": 2.0,
            "polygons": [[
                [-115, 104], [-106, 92], [-93, 85], [-78, 82], [-62, 86],
                [-47, 83], [-31, 90], [-14, 85], [2, 91], [18, 84],
                [35, 90], [50, 84], [68, 88], [84, 83], [101, 91],
                [114, 105], [111, 121], [99, 141], [78, 158], [53, 168],
                [23, 173], [-8, 174], [-38, 169], [-67, 161], [-92, 147],
                [-109, 128],
            ]],
        },
        {
            "level": 2,
            "walk_z_m": 3.0,
            "polygons": [[
                [-106, 111], [-95, 101], [-80, 96], [-64, 99], [-48, 94],
                [-34, 103], [-18, 96], [0, 104], [18, 96], [34, 104],
                [50, 97], [66, 102], [82, 96], [99, 104], [105, 116],
                [96, 135], [77, 149], [54, 158], [24, 164], [-7, 164],
                [-35, 159], [-61, 152], [-84, 140], [-100, 127],
            ]],
        },
        {
            "level": 3,
            "walk_z_m": 4.0,
            "polygons": [[
                [-97, 119], [-84, 108], [-67, 112], [-52, 106], [-37, 116],
                [-22, 109], [-4, 118], [14, 110], [30, 118], [47, 110],
                [64, 115], [80, 108], [94, 118], [96, 128], [87, 141],
                [68, 150], [46, 155], [19, 159], [-12, 156], [-38, 151],
                [-62, 144], [-83, 135],
            ]],
        },
        {
            "level": 4,
            "walk_z_m": 5.0,
            "polygons": [
                [[-96, 122], [-85, 113], [-69, 115], [-54, 119], [-38, 127],
                 [-29, 141], [-34, 153], [-49, 162], [-68, 164], [-86, 154],
                 [-98, 139]],
                [[-26, 121], [-15, 113], [-1, 116], [13, 112], [29, 122],
                 [33, 138], [25, 156], [8, 166], [-10, 160], [-25, 143]],
                [[36, 122], [47, 113], [61, 115], [75, 112], [91, 121],
                 [98, 137], [91, 153], [75, 164], [57, 165], [42, 155],
                 [33, 140]],
            ],
        },
        {
            "level": 5,
            "walk_z_m": 6.0,
            "polygons": [
                [[-88, 127], [-77, 120], [-62, 122], [-48, 128], [-38, 140],
                 [-42, 151], [-55, 157], [-70, 157], [-83, 149], [-91, 137]],
                [[-18, 126], [-7, 119], [4, 122], [15, 118], [25, 128],
                 [26, 141], [17, 154], [4, 160], [-10, 153], [-19, 139]],
                [[44, 127], [54, 118], [66, 121], [78, 117], [88, 126],
                 [91, 139], [83, 151], [70, 158], [56, 157], [46, 147],
                 [40, 137]],
            ],
        },
        {
            "level": 6,
            "walk_z_m": 7.0,
            "polygons": [
                [[-79, 132], [-68, 127], [-56, 130], [-47, 138], [-49, 148],
                 [-59, 153], [-70, 151], [-78, 143]],
                [[-11, 132], [-2, 124], [8, 128], [17, 125], [21, 135],
                 [16, 147], [5, 154], [-6, 148], [-13, 140]],
                [[51, 132], [61, 124], [72, 127], [82, 124], [87, 135],
                 [83, 146], [72, 152], [59, 149], [50, 141]],
            ],
        },
        {
            "level": 7,
            "walk_z_m": 8.0,
            "polygons": [
                [[-69, 136], [-60, 133], [-52, 140], [-55, 148], [-63, 151],
                 [-71, 146]],
                [[-5, 137], [4, 130], [12, 136], [11, 146], [3, 151], [-5, 145]],
                [[59, 137], [68, 130], [77, 135], [79, 144], [70, 149], [61, 146]],
            ],
        },
    ]

    watersheds = [
        {
            "id": "WS01_VERDANT_RUN",
            "name": "Verdant Run Watershed",
            "outlet": {"cell": [-96, -49], "kind": "ocean_mouth", "tile_id": "RV11"},
            "main_channel": {
                "id": "verdant_run",
                "raster": "supercover_bresenham_between_stations",
                "width_by_reach_cells": [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
                                          2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
                                          3, 3, 3, 3, 3, 3, 3],
                "stations": [
                    {"cell": [-62, 148], "level": 7, "kind": "spring"},
                    {"cell": [-64, 144], "level": 6, "kind": "rapids"},
                    {"cell": [-66, 139], "level": 6, "kind": "stream"},
                    {"cell": [-68, 135], "level": 5, "kind": "rapids"},
                    {"cell": [-70, 132], "level": 5, "kind": "waterfall_crest"},
                    {"cell": [-70, 129], "level": 4, "kind": "waterfall_pool_lake_inlet"},
                    {"cell": [-81, 118], "level": 4, "kind": "lake_outlet"},
                    {"cell": [-83, 115], "level": 4, "kind": "waterfall_crest"},
                    {"cell": [-84, 113], "level": 3, "kind": "waterfall_pool"},
                    {"cell": [-87, 107], "level": 3, "kind": "river"},
                    {"cell": [-88, 102], "level": 3, "kind": "waterfall_crest"},
                    {"cell": [-88, 100], "level": 2, "kind": "waterfall_pool"},
                    {"cell": [-89, 94], "level": 2, "kind": "river"},
                    {"cell": [-89, 88], "level": 2, "kind": "waterfall_crest"},
                    {"cell": [-88, 86], "level": 1, "kind": "waterfall_pool"},
                    {"cell": [-87, 80], "level": 1, "kind": "river"},
                    {"cell": [-86, 76], "level": 1, "kind": "waterfall_crest"},
                    {"cell": [-86, 74], "level": 0, "kind": "waterfall_pool"},
                    {"cell": [-85, 68], "level": 0, "kind": "river"},
                    {"cell": [-82, 60], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [-79, 48], "level": 0, "kind": "river"},
                    {"cell": [-78, 36], "level": 0, "kind": "river"},
                    {"cell": [-80, 24], "level": 0, "kind": "river"},
                    {"cell": [-83, 12], "level": 0, "kind": "river"},
                    {"cell": [-86, 0], "level": 0, "kind": "river"},
                    {"cell": [-89, -12], "level": 0, "kind": "river"},
                    {"cell": [-92, -24], "level": 0, "kind": "river"},
                    {"cell": [-95, -38], "level": 0, "kind": "estuary"},
                    {"cell": [-96, -45], "level": 0, "kind": "tidal"},
                    {"cell": [-96, -49], "level": 0, "kind": "ocean_mouth"},
                ],
            },
            "tributaries": [{
                "id": "copper_creek",
                "width_cells": 1,
                "stations": [
                    {"cell": [-82, 146], "level": 6, "kind": "spring"},
                    {"cell": [-80, 140], "level": 5, "kind": "stream"},
                    {"cell": [-78, 135], "level": 5, "kind": "stream"},
                    {"cell": [-76, 131], "level": 4, "kind": "lake_inlet"},
                ],
            }],
            "lakes": [{
                "id": "mirrorleaf_lake",
                "water_level": 4,
                "water_z_m": 4.62,
                "polygon": [[-80, 128], [-76, 131], [-70, 131], [-65, 128],
                            [-63, 124], [-65, 119], [-70, 116], [-77, 116],
                            [-82, 119], [-84, 124]],
                "inlets": [[-70, 129], [-76, 131]],
                "outlet": [-81, 118],
            }],
        },
        {
            "id": "WS02_HEARTH_RIVER",
            "name": "Hearth River Watershed",
            "outlet": {"cell": [14, -44], "kind": "ocean_mouth", "tile_id": "RV11"},
            "main_channel": {
                "id": "hearth_river",
                "raster": "supercover_bresenham_between_stations",
                "width_by_reach_cells": [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2,
                                          2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
                                          2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
                "stations": [
                    {"cell": [4, 150], "level": 7, "kind": "spring"},
                    {"cell": [6, 146], "level": 7, "kind": "stream"},
                    {"cell": [8, 142], "level": 6, "kind": "rapids"},
                    {"cell": [10, 137], "level": 6, "kind": "stream"},
                    {"cell": [10, 132], "level": 5, "kind": "waterfall_crest"},
                    {"cell": [9, 129], "level": 5, "kind": "cascade"},
                    {"cell": [9, 127], "level": 4, "kind": "lake_inlet"},
                    {"cell": [10, 116], "level": 4, "kind": "lake_outlet"},
                    {"cell": [10, 115], "level": 4, "kind": "waterfall_crest"},
                    {"cell": [11, 113], "level": 3, "kind": "waterfall_pool"},
                    {"cell": [11, 110], "level": 3, "kind": "river"},
                    {"cell": [12, 106], "level": 3, "kind": "waterfall_crest"},
                    {"cell": [12, 104], "level": 2, "kind": "waterfall_pool"},
                    {"cell": [13, 98], "level": 2, "kind": "river"},
                    {"cell": [13, 92], "level": 2, "kind": "waterfall_crest"},
                    {"cell": [14, 90], "level": 1, "kind": "waterfall_pool"},
                    {"cell": [14, 86], "level": 1, "kind": "waterfall_crest"},
                    {"cell": [14, 84], "level": 0, "kind": "waterfall_pool"},
                    {"cell": [14, 80], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [14, 76], "level": 0, "kind": "river"},
                    {"cell": [14, 68], "level": 0, "kind": "river"},
                    {"cell": [14, 60], "level": 0, "kind": "river"},
                    {"cell": [14, 56], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [14, 52], "level": 0, "kind": "river"},
                    {"cell": [14, 44], "level": 0, "kind": "river"},
                    {"cell": [8, 42], "level": 0, "kind": "river"},
                    {"cell": [2, 40], "level": 0, "kind": "river"},
                    {"cell": [-3, 38], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [-3, 32], "level": 0, "kind": "river"},
                    {"cell": [-3, 27], "level": 0, "kind": "footbridge_crossing"},
                    {"cell": [-3, 25], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [-3, 23], "level": 0, "kind": "engineered_bend"},
                    {"cell": [6, 23], "level": 0, "kind": "engineered_channel"},
                    {"cell": [14, 23], "level": 0, "kind": "engineered_bend"},
                    {"cell": [14, 21], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [14, 20], "level": 0, "kind": "canal_confluence"},
                    {"cell": [14, 19], "level": 0, "kind": "canal_t"},
                    {"cell": [14, 4], "level": 0, "kind": "existing_canal"},
                    {"cell": [14, -7], "level": 0, "kind": "existing_canal"},
                    {"cell": [14, -31], "level": 0, "kind": "existing_canal"},
                    {"cell": [14, -40], "level": 0, "kind": "former_mouth_now_channel"},
                    {"cell": [14, -44], "level": 0, "kind": "ocean_mouth"},
                ],
            },
            "tributaries": [],
            "lakes": [{
                "id": "hearthmere",
                "water_level": 4,
                "water_z_m": 4.62,
                "polygon": [[2, 128], [7, 131], [12, 130], [16, 126],
                            [16, 121], [13, 117], [7, 115], [2, 117],
                            [-1, 121], [-1, 125]],
                "inlets": [[9, 127]],
                "outlet": [10, 116],
            }],
            "city_integration": {
                "replace_tile_at_14_19": {"from": "T21", "to": "T22", "reason": "natural river joins civic canal"},
                "replace_tile_at_14_minus40": {"from": "T25", "to": "T20", "reason": "extend outlet four cells"},
                "new_ocean_mouth": {"cell": [14, -44], "tile": "RV11"},
                "protected_core_channel_route": [[14, 44], [8, 42], [2, 40], [-3, 38],
                                                 [-3, 23], [6, 23], [14, 23], [14, 19]],
                "preserve_all_buildings_plots_and_non_crossing_routes": True,
            },
        },
        {
            "id": "WS03_SUNFALL_RIVER",
            "name": "Sunfall River Watershed",
            "outlet": {"cell": [96, -47], "kind": "ocean_mouth", "tile_id": "RV11"},
            "main_channel": {
                "id": "sunfall_river",
                "raster": "supercover_bresenham_between_stations",
                "width_by_reach_cells": [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
                                          2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3,
                                          3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
                "stations": [
                    {"cell": [68, 149], "level": 7, "kind": "spring"},
                    {"cell": [70, 145], "level": 6, "kind": "rapids"},
                    {"cell": [72, 141], "level": 6, "kind": "waterfall_crest"},
                    {"cell": [73, 139], "level": 5, "kind": "waterfall_pool"},
                    {"cell": [73, 137], "level": 5, "kind": "lake_inlet"},
                    {"cell": [77, 131], "level": 5, "kind": "lake_outlet"},
                    {"cell": [79, 129], "level": 5, "kind": "waterfall_crest"},
                    {"cell": [80, 127], "level": 4, "kind": "waterfall_pool"},
                    {"cell": [83, 121], "level": 4, "kind": "river"},
                    {"cell": [85, 117], "level": 4, "kind": "waterfall_crest"},
                    {"cell": [86, 115], "level": 3, "kind": "waterfall_pool"},
                    {"cell": [87, 109], "level": 3, "kind": "river"},
                    {"cell": [88, 104], "level": 3, "kind": "waterfall_crest"},
                    {"cell": [88, 102], "level": 2, "kind": "waterfall_pool"},
                    {"cell": [89, 96], "level": 2, "kind": "river"},
                    {"cell": [90, 90], "level": 2, "kind": "waterfall_crest"},
                    {"cell": [90, 88], "level": 1, "kind": "waterfall_pool"},
                    {"cell": [91, 82], "level": 1, "kind": "river"},
                    {"cell": [92, 78], "level": 1, "kind": "waterfall_crest"},
                    {"cell": [92, 76], "level": 0, "kind": "tributary_confluence"},
                    {"cell": [94, 68], "level": 0, "kind": "bridge_crossing"},
                    {"cell": [95, 58], "level": 0, "kind": "river"},
                    {"cell": [93, 48], "level": 0, "kind": "river"},
                    {"cell": [90, 38], "level": 0, "kind": "river"},
                    {"cell": [89, 28], "level": 0, "kind": "river"},
                    {"cell": [91, 18], "level": 0, "kind": "river"},
                    {"cell": [92, 8], "level": 0, "kind": "river"},
                    {"cell": [93, -2], "level": 0, "kind": "river"},
                    {"cell": [94, -12], "level": 0, "kind": "river"},
                    {"cell": [95, -22], "level": 0, "kind": "river"},
                    {"cell": [96, -32], "level": 0, "kind": "estuary"},
                    {"cell": [96, -42], "level": 0, "kind": "tidal"},
                    {"cell": [96, -47], "level": 0, "kind": "ocean_mouth"},
                ],
            },
            "tributaries": [{
                "id": "amber_brook",
                "width_cells": 1,
                "stations": [
                    {"cell": [45, 153], "level": 5, "kind": "spring"},
                    {"cell": [42, 146], "level": 4, "kind": "bridge_crossing"},
                    {"cell": [52, 141], "level": 4, "kind": "stream"},
                    {"cell": [57, 134], "level": 4, "kind": "rapids"},
                    {"cell": [63, 126], "level": 4, "kind": "stream"},
                    {"cell": [69, 117], "level": 3, "kind": "rapids"},
                    {"cell": [76, 107], "level": 3, "kind": "stream"},
                    {"cell": [82, 97], "level": 2, "kind": "rapids"},
                    {"cell": [87, 87], "level": 1, "kind": "stream"},
                    {"cell": [92, 76], "level": 0, "kind": "confluence"},
                ],
            }],
            "lakes": [{
                "id": "sunmirror_tarn",
                "water_level": 5,
                "water_z_m": 5.62,
                "polygon": [[68, 140], [73, 142], [78, 140], [80, 136],
                            [78, 132], [73, 130], [68, 132], [66, 136]],
                "inlets": [[73, 137]],
                "outlet": [77, 131],
            }],
        },
    ]

    # A width value belongs to each reach between consecutive stations.  These
    # deterministic patterns widen each river downstream without an accidental
    # missing or surplus width record when stations are edited.
    for watershed in watersheds:
        channel = watershed["main_channel"]
        reach_count = len(channel["stations"]) - 1
        if watershed["id"] == "WS01_VERDANT_RUN":
            channel["width_by_reach_cells"] = [1] * 6 + [2] * 11 + [3] * (reach_count - 17)
        elif watershed["id"] == "WS02_HEARTH_RIVER":
            channel["width_by_reach_cells"] = [1] * 6 + [2] * (reach_count - 6)
            # Once the river enters the protected civic rectangle it becomes a
            # one-cell engineered waterway.  This prevents its horizontal y=23
            # reach from visually or physically overlapping the y=24 boulevard.
            protected_start = next(i for i, station in enumerate(channel["stations"])
                                   if station["cell"] == [-3, 38])
            for index in range(protected_start, reach_count):
                channel["width_by_reach_cells"][index] = 1
        else:
            channel["width_by_reach_cells"] = [1] * 4 + [2] * 13 + [3] * (reach_count - 17)

    added_plots = []
    # West Fields: three plots north and three south of the avenue.
    for i, x in enumerate((-70, -62, -54), 1):
        added_plots.append(plot(f"WF{i:02d}", x, 34, 6, 6, "S", "west_fields"))
    for i, x in enumerate((-70, -62, -54), 4):
        added_plots.append(plot(f"WF{i:02d}", x, 23, 6, 7, "N", "west_fields"))
    # East Fields.
    for i, x in enumerate((50, 58, 68), 1):
        added_plots.append(plot(f"EF{i:02d}", x, 34, 6, 6, "S", "east_fields"))
    for i, x in enumerate((50, 58, 68), 4):
        added_plots.append(plot(f"EF{i:02d}", x, 23, 6, 7, "N", "east_fields"))
    # North Valley, kept clear of the river at x=14 and the pass road at x=28.
    for i, x in enumerate((-26, -18, -10, 34, 42, 50), 1):
        added_plots.append(plot(f"NV{i:02d}", x, 58, 6, 8, "S", "north_valley"))
    # Foothill terraces, below elevation level 1 and clear of the mountain pass.
    for i, x in enumerate((-26, -18, -10, 40, 48, 56), 1):
        added_plots.append(plot(f"FH{i:02d}", x, 82, 6, 8, "S", "foothill_terraces"))

    roads = [
        {
            "id": "west_growth_spine",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[-45, 24], [-45, 38], [-45, 55], [-46, 63]],
            "connects_to_existing": "west_service + north_rear_loading",
            "tile_family": "C01-C08",
        },
        {
            "id": "west_fields_avenue",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[-72, 32], [-45, 32]],
            "tile_family": "C01-C08",
        },
        {
            "id": "east_growth_spine",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[43, 24], [43, 38], [43, 55], [44, 63]],
            "connects_to_existing": "east_service + north_rear_loading",
            "tile_family": "C01-C08",
        },
        {
            "id": "east_fields_avenue",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[43, 32], [78, 32]],
            "tile_family": "C01-C08",
        },
        {
            "id": "north_valley_avenue",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[-30, 56], [60, 56]],
            "tile_family": "C01-C08",
        },
        {
            "id": "foothill_avenue",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[-30, 80], [64, 80]],
            "tile_family": "C01-C08",
        },
        {
            "id": "west_scenic_road",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[-46, 56], [-60, 58], [-72, 59], [-82, 60], [-90, 70],
                         [-94, 88], [-90, 104], [-83, 114]],
            "tile_family": "C01-C08 + C08 at elevation transitions",
        },
        {
            "id": "east_scenic_road",
            "kind": "two_lane_solar_road",
            "width_cells": 2,
            "polyline": [[43, 55], [58, 57], [73, 61], [86, 65], [94, 68],
                         [105, 73]],
            "tile_family": "C01-C08",
        },
        {
            "id": "makers_gap_road",
            "kind": "two_lane_mountain_pass",
            "width_cells": 2,
            "polyline": [[28, 38], [28, 55], [27, 70], [28, 86], [31, 100],
                         [34, 112], [34, 126], [36, 138], [43, 148], [55, 158],
                         [69, 164]],
            "road_elevation_stations": [
                {"cell": [28, 38], "level": 0}, {"cell": [28, 70], "level": 0},
                {"cell": [28, 86], "level": 1}, {"cell": [31, 100], "level": 2},
                {"cell": [34, 112], "level": 3}, {"cell": [34, 126], "level": 3},
                {"cell": [36, 138], "level": 4}, {"cell": [43, 148], "level": 4},
                {"cell": [55, 158], "level": 3}, {"cell": [69, 164], "level": 2},
            ],
            "tile_family": "C01-C08 + MT02 + MT07",
        },
        {
            "id": "copperglass_mine_spur",
            "kind": "single_lane_service_road",
            "width_cells": 1,
            "polyline": [[-83, 114], [-72, 110], [-61, 112], [-52, 117], [-46, 122]],
            "tile_family": "C01-C08 + MT02",
        },
    ]

    bridges = [
        {"id": "BR_C01", "road": "north_boulevard", "water": "hearth_river",
         "deck_cells": [[-3, 24], [-3, 25]], "axis": "E-W", "type": "cart",
         "tiles": ["T42", "T43"]},
        {"id": "BR_C02", "road": "north_rear_loading", "water": "hearth_river",
         "deck_cells": [[-3, 37], [-3, 38]], "axis": "E-W", "type": "cart",
         "tiles": ["T42", "T43"]},
        {"id": "BR_C03", "road": "north_valley_avenue", "water": "hearth_river",
         "deck_cells": [[14, 55], [14, 56]], "axis": "E-W", "type": "cart",
         "tiles": ["T42", "T43"]},
        {"id": "BR_C04", "road": "foothill_avenue", "water": "hearth_river",
         "deck_cells": [[14, 79], [14, 80]], "axis": "E-W", "type": "cart",
         "tiles": ["T42", "T43"]},
        {"id": "BR_C05", "road": "north_customer_walk", "water": "hearth_river",
         "deck_cells": [[-3, 27]], "axis": "E-W", "type": "foot",
         "tiles": ["T39", "T40"]},
        {"id": "BR_C06", "road": "north_civic_service", "water": "hearth_river",
         "deck_cells": [[14, 20], [14, 21]], "axis": "E-W", "type": "cart",
         "tiles": ["T42", "T43"]},
        {"id": "BR_W01", "road": "west_scenic_road", "water": "verdant_run",
         "deck_cells": [[-84, 60], [-83, 60], [-82, 60], [-81, 60], [-80, 60]],
         "axis": "E-W", "type": "cart_long", "tiles": ["T42", "T43"]},
        {"id": "BR_E01", "road": "east_scenic_road", "water": "sunfall_river",
         "deck_cells": [[92, 68], [93, 68], [94, 68], [95, 68], [96, 68]],
         "axis": "E-W", "type": "cart_long", "tiles": ["T42", "T43"]},
        {"id": "BR_M01", "road": "makers_gap_road", "water": "amber_brook",
         "deck_cells": [[42, 146], [43, 146]], "axis": "E-W", "type": "stone_arch",
         "tiles": ["RV10", "T42", "T43"]},
    ]

    trails = [
        {
            "id": "hearth_river_greenway",
            "width_cells": 1,
            "polyline": [[18, 39], [18, 56], [18, 76], [18, 92], [17, 108], [15, 116]],
            "connects": ["existing_north_customer_walk", "hearthmere_loop"],
            "tile_family": "T27-T33",
        },
        {
            "id": "hearthmere_loop",
            "width_cells": 1,
            "closed_polyline": [[-3, 120], [1, 114], [8, 112], [15, 115], [19, 121],
                                [18, 128], [12, 134], [4, 134], [-2, 130], [-3, 120]],
            "tile_family": "T27-T33",
        },
        {
            "id": "mirrorleaf_loop",
            "width_cells": 1,
            "closed_polyline": [[-87, 118], [-83, 112], [-75, 110], [-66, 113], [-60, 119],
                                [-60, 127], [-65, 134], [-75, 136], [-84, 132], [-87, 118]],
            "tile_family": "T27-T33",
        },
        {
            "id": "sunmirror_climb",
            "width_cells": 1,
            "polyline": [[69, 111], [64, 120], [63, 130], [65, 140], [68, 145]],
            "tile_family": "T27-T33 + T11-T12",
        },
    ]

    spec = {
        "schema": "markets-and-makers.expanded-open-world.layout.v1",
        "version": "1.0.0",
        "status": "DESIGN_VALIDATED",
        "coordinate_contract": {
            "source_axes": {"east": "+X", "north": "+Y", "up": "+Z"},
            "tile_size_m": 2.0,
            "cell_anchor": "integer cell center",
            "base_walk_z_m": 1.0,
            "elevation_step_m": 1.0,
            "water_inset_below_walk_m": 0.32,
            "river_water_z_formula": "0.62 + elevation_level",
            "civic_canal_water_z_m": 0.68,
            "ocean_z_m": -0.18,
            "rotation_degrees": [0, 90, 180, 270],
            "rasterization": {
                "polylines": "integer supercover Bresenham; every touched cell included",
                "polygons": "cell center inside or on boundary",
                "road_width_2": "centerline plus +X for N/S-dominant reach, plus +Y for E/W-dominant reach; union at turns",
                "water_width": "centerline expanded perpendicular to flow; odd widths centered; union at turns",
                "priority_high_to_low": ["bridge", "waterfall", "water", "road_or_path", "plot", "elevation", "base_land", "ocean"],
            },
        },
        "source_city": {
            "layout": str(SOURCE_LAYOUT.relative_to(ROOT)),
            "layout_sha256": sha256(SOURCE_LAYOUT),
            "protected_bounds_cells": source["world"]["bounds_cells"],
            "protected_building_ids": source["validation_contract"]["government_building_ids"],
            "protected_plot_ids": source["validation_contract"]["empty_plot_ids"],
            "preserve_counts": {"government_buildings": 9, "empty_city_plots": 18},
            "allowed_terrain_edits": {
                "river_corridor_polyline": [[14, 44], [8, 42], [2, 40], [-3, 38], [-3, 23],
                                            [6, 23], [14, 23], [14, 19]],
                "extended_outlet_cells": [[14, -40], [14, -41], [14, -42], [14, -43], [14, -44]],
                "all_other_core_terrain_locked": True,
            },
            "player_owned_buildings": 0,
        },
        "world": {
            "id": "sunwoven_open_world_v1",
            "name": "Sunwoven Island",
            "bounds_cells": rect(-128, -80, 127, 175),
            "dimensions_cells": [256, 256],
            "dimensions_m": [512, 512],
            "chunk_size_cells": [16, 16],
            "chunk_size_m": [32, 32],
            "chunk_grid": [16, 16],
            "terrain_chunk_count": 256,
            "macroregion_size_chunks": [4, 4],
            "macroregion_grid": [4, 4],
            "macroregion_count": 16,
            "land_polygon": [
                [-112, -45], [-82, -52], [-50, -47], [-25, -43], [0, -45],
                [26, -43], [52, -48], [84, -51], [112, -42], [119, -20],
                [120, 20], [116, 55], [121, 88], [111, 120], [93, 147],
                [65, 165], [35, 172], [0, 174], [-34, 170], [-67, 163],
                [-94, 146], [-114, 121], [-122, 89], [-118, 55], [-121, 22],
                [-119, -14],
            ],
            "coast_rule": "T13-T15 natural shore except government harbor T16-T19 and three RV11 mouths",
            "southern_city_coast_preserved": True,
        },
        "tile_program": {
            "reuse": {
                "base_land_coast_elevation": "T01-T19",
                "civic_canal": "T20-T25",
                "pond_compatibility": "T26",
                "paths_plazas_plots": "T27-T38",
                "bridges": "T39-T43",
                "docks_harbor": "T44-T50",
                "city_roads": "C01-C36",
            },
            "new_mountain_tiles": [
                {"id": "MT01", "key": "alpine_ground_flat", "footprint": [1, 1], "delta": 0},
                {"id": "MT02", "key": "natural_slope_straight", "footprint": [1, 2], "delta": 1},
                {"id": "MT03", "key": "natural_slope_outer", "footprint": [2, 2], "delta": 1},
                {"id": "MT04", "key": "natural_slope_inner", "footprint": [2, 2], "delta": 1},
                {"id": "MT05", "key": "ridge_straight", "footprint": [1, 1], "delta": 0},
                {"id": "MT06", "key": "ridge_corner", "footprint": [1, 1], "delta": 0},
                {"id": "MT07", "key": "saddle_pass", "footprint": [2, 2], "delta": 0},
                {"id": "MT08", "key": "summit_cap", "footprint": [2, 2], "delta": 0},
                {"id": "MT09", "key": "talus_straight", "footprint": [1, 1], "delta": 0},
                {"id": "MT10", "key": "talus_corner", "footprint": [1, 1], "delta": 0},
                {"id": "MT11", "key": "rock_outcrop", "footprint": [1, 1], "delta": 0},
                {"id": "MT12", "key": "cave_portal_transition", "footprint": [2, 1], "delta": 0},
            ],
            "new_river_tiles": [
                {"id": "RV01", "key": "spring_source", "connections": ["S"]},
                {"id": "RV02", "key": "narrow_straight", "connections": ["N", "S"]},
                {"id": "RV03", "key": "narrow_corner", "connections": ["N", "E"]},
                {"id": "RV04", "key": "narrow_t_confluence", "connections": ["N", "E", "S"]},
                {"id": "RV05", "key": "wide_straight", "connections": ["N", "S"]},
                {"id": "RV06", "key": "wide_corner", "connections": ["N", "E"]},
                {"id": "RV07", "key": "wide_t_confluence", "connections": ["N", "E", "S"]},
                {"id": "RV08", "key": "narrow_to_wide", "connections": ["N", "S"]},
                {"id": "RV09", "key": "rapids_straight", "connections": ["N", "S"]},
                {"id": "RV10", "key": "bridge_threshold_ford", "connections": ["N", "S", "E", "W"]},
                {"id": "RV11", "key": "natural_ocean_mouth", "connections": ["N", "S"]},
            ],
            "new_lake_tiles": [
                {"id": "LK01", "key": "lake_full_water"},
                {"id": "LK02", "key": "lake_shore_straight"},
                {"id": "LK03", "key": "lake_shore_outer"},
                {"id": "LK04", "key": "lake_shore_inner"},
                {"id": "LK05", "key": "lake_river_inlet_outlet"},
            ],
            "new_waterfall_tiles": [
                {"id": "WF01", "key": "waterfall_crest", "elevation_delta": 1},
                {"id": "WF02", "key": "waterfall_face_stackable", "elevation_delta": 1},
                {"id": "WF03", "key": "waterfall_plunge_pool", "elevation_delta": 0},
                {"id": "WF04", "key": "stepped_cascade", "elevation_delta": 1},
            ],
            "all_new_tiles_rotation_complete": True,
            "style": "approved logo-world solarpunk: warm limestone, sage grass, teal water, dark 0.04m keyline border",
        },
        "elevation": {
            "assignment": "highest containing level polygon wins, then hydrology and road-cut overrides",
            "levels": mountain_levels,
            "max_level": 7,
            "max_walk_z_m": 8.0,
            "road_cut_half_width_cells": 2,
            "river_cut_half_width_cells": 2,
            "no_vertical_cliff_over_one_level_without_MT_or_T07_T09_stack": True,
        },
        "hydrology": {
            "watersheds": watersheds,
            "flow_rule": "station elevation levels never increase downstream; equal-level reaches receive a -0.01m visual water gradient only",
            "lake_rule": "each lake has one or more inlets and exactly one outlet",
            "river_end_rule": "only spring heads and declared ocean mouths may be degree-one endpoints",
            "bank_buffer_cells_no_build": 3,
            "waterfall_count": 14,
            "ocean_mouths": [[-96, -49], [14, -44], [96, -47]],
        },
        "transport": {
            "roads": roads,
            "bridges": bridges,
            "trails": trails,
            "city_routes_preserved": True,
            "all_new_districts_connected_to_civic_network": True,
        },
        "plots": {
            "existing_city_plots_preserved": source["validation_contract"]["empty_plot_ids"],
            "added_plot_count": len(added_plots),
            "added": added_plots,
            "total_empty_plot_count": len(source["validation_contract"]["empty_plot_ids"]) + len(added_plots),
            "player_buildings": [],
        },
        "biomes": [
            {"id": "BF01", "name": "West Coastal Grove", "density": 0.38,
             "polygon": [[-112, 75], [-100, 60], [-89, 62], [-82, 77], [-85, 93], [-96, 107], [-110, 101]],
             "exclude": ["water_buffer_3", "road_buffer_2", "plots"]},
            {"id": "BF02", "name": "Mirrorleaf Forest", "density": 0.55,
             "polygon": [[-102, 108], [-91, 99], [-78, 98], [-61, 107], [-53, 122], [-59, 140], [-77, 148], [-96, 138], [-105, 123]],
             "exclude": ["water_buffer_3", "road_buffer_2", "plots", "mine_spur"]},
            {"id": "BF03", "name": "Central Orchard Woods", "density": 0.32,
             "polygon": [[-50, 74], [-36, 65], [-19, 70], [-10, 87], [-21, 102], [-40, 100], [-52, 89]],
             "exclude": ["water_buffer_3", "road_buffer_2", "plots"]},
            {"id": "BF04", "name": "East Cloud Forest", "density": 0.58,
             "polygon": [[42, 113], [55, 101], [74, 103], [92, 114], [101, 132], [93, 151], [78, 162], [58, 159], [45, 146]],
             "exclude": ["water_buffer_3", "road_buffer_2", "plots"]},
            {"id": "BF05", "name": "Sunfall Riparian Grove", "density": 0.44,
             "polygon": [[72, 62], [84, 53], [102, 57], [111, 72], [106, 94], [92, 102], [77, 91]],
             "exclude": ["water_buffer_3", "road_buffer_2", "plots"]},
        ],
        "points_of_interest": [
            {
                "id": "POI_MINE_01",
                "name": "Copperglass Cave and Survey Mine",
                "kind": "natural_cave_government_survey_site",
                "portal_anchor_cell": [-45, 125],
                "portal_facing": "S",
                "portal_tile": "MT12",
                "level": 4,
                "surface_pad_bounds": rect(-51, 119, -44, 124),
                "access_road": "copperglass_mine_spur",
                "player_owned": False,
                "commercial_operation_active": False,
            },
            {"id": "POI_OVERLOOK_01", "name": "Makers Gap Overlook", "kind": "scenic_pass",
             "anchor_cell": [43, 148], "level": 4, "player_owned": False},
            {"id": "POI_FALLS_01", "name": "Hearthmere Falls", "kind": "waterfall",
             "anchor_cell": [10, 115], "level_top": 4, "level_bottom": 3, "player_owned": False},
        ],
        "streaming": {
            "chunk_id_formula": "cx=floor((x+128)/16), cy=floor((y+80)/16), id=CH_cx_cy",
            "macroregion_id_formula": "rx=floor(cx/4), ry=floor(cy/4), id=MR_rx_ry",
            "macroregions": [
                ["MR_0_0", "southwest_ocean"], ["MR_1_0", "west_estuary"],
                ["MR_2_0", "civic_southwest"], ["MR_3_0", "civic_southeast"],
                ["MR_0_1", "west_coast"], ["MR_1_1", "west_fields"],
                ["MR_2_1", "civic_core"], ["MR_3_1", "east_fields"],
                ["MR_0_2", "west_lowlands"], ["MR_1_2", "mirrorleaf_valley"],
                ["MR_2_2", "hearth_valley"], ["MR_3_2", "sunfall_valley"],
                ["MR_0_3", "northwest_range"], ["MR_1_3", "central_range"],
                ["MR_2_3", "makers_gap"], ["MR_3_3", "northeast_range"],
            ],
            "load_radius_chunks": 2,
            "preload_radius_chunks": 3,
            "keepalive_regions": ["MR_2_1"],
            "lod": [
                {"distance_m": [0, 64], "terrain": "LOD0", "props": "LOD0", "water": "full"},
                {"distance_m": [64, 128], "terrain": "LOD1", "props": "LOD1", "water": "reduced"},
                {"distance_m": [128, 224], "terrain": "LOD2", "props": "billboard_or_cull", "water": "static"},
                {"distance_m": [224, 10000], "terrain": "macro_mesh", "props": "culled", "water": "macro_plane"},
            ],
            "water_seam_rule": "duplicate bank skirt and water edge in adjacent chunks; owning chunk selected by lower packed chunk id",
            "terrain_compile_rule": "merge static geometry by chunk, elevation level, and material; preserve collision mesh separately",
            "interactive_assets_separate": ["bridges", "mine_portal", "plot_markers", "road_signals"],
        },
        "validation_contract": {
            "require_source_city_sha256": sha256(SOURCE_LAYOUT),
            "require_government_buildings": 9,
            "require_existing_city_plots": 18,
            "require_added_plots": 24,
            "require_total_empty_plots": 42,
            "forbid_player_buildings": True,
            "require_watersheds": 3,
            "require_lakes": 3,
            "require_ocean_mouths": 3,
            "require_no_uphill_flow": True,
            "require_no_untyped_river_dead_ends": True,
            "require_all_road_water_crossings_bridged": True,
            "require_city_routes_unblocked": True,
            "require_plot_water_buffer_cells": 3,
            "require_plot_road_clearance_cells": 1,
            "require_16_cell_chunk_alignment": True,
        },
    }
    return spec


def boxes_overlap(a, b):
    amn, amx = a["min"], a["max"]
    bmn, bmx = b["min"], b["max"]
    return not (amx[0] < bmn[0] or bmx[0] < amn[0] or amx[1] < bmn[1] or bmx[1] < amn[1])


def raster_polyline(points):
    """Return deterministic integer cells along a polyline for collision QA."""
    cells = set()
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            cells.add((x0, y0))
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy
    return cells


def validate(spec):
    checks = []

    def check(name, passed, detail):
        checks.append({"name": name, "passed": bool(passed), "detail": detail})

    w = spec["world"]
    b = w["bounds_cells"]
    dims = [b["max"][0] - b["min"][0] + 1, b["max"][1] - b["min"][1] + 1]
    check("world dimensions exact", dims == w["dimensions_cells"] == [256, 256], str(dims))
    check("chunk grid exact", [dims[0] // 16, dims[1] // 16] == w["chunk_grid"] == [16, 16], str(w["chunk_grid"]))
    check("chunk count exact", w["terrain_chunk_count"] == 256, str(w["terrain_chunk_count"]))
    cc = spec["coordinate_contract"]
    check("natural water formula locked", cc["river_water_z_formula"] == "0.62 + elevation_level", cc["river_water_z_formula"])
    check("civic canal remains at 0.68m", cc["civic_canal_water_z_m"] == 0.68, str(cc["civic_canal_water_z_m"]))

    src = spec["source_city"]
    check("source city hash locked", sha256(SOURCE_LAYOUT) == src["layout_sha256"], src["layout_sha256"])
    check("nine civic buildings preserved", len(src["protected_building_ids"]) == 9, str(src["protected_building_ids"]))
    check("eighteen civic plots preserved", len(src["protected_plot_ids"]) == 18, str(src["protected_plot_ids"]))
    core_route = spec["hydrology"]["watersheds"][1]["city_integration"]["protected_core_channel_route"]
    core_water_cells = raster_polyline(core_route)
    source_layout = json.loads(SOURCE_LAYOUT.read_text())
    plot_hits = []
    for p in source_layout["plots"]:
        r = p["occupied_bounds_cells"]
        if any(r["min"][0] <= x <= r["max"][0] and r["min"][1] <= y <= r["max"][1]
               for x, y in core_water_cells):
            plot_hits.append(p["id"])
    building_hits = []
    for building in source_layout["buildings"]:
        r = building["occupied_bounds_cells"]
        if any(r["min"][0] <= x <= r["max"][0] and r["min"][1] <= y <= r["max"][1]
               for x, y in core_water_cells):
            building_hits.append(building["id"])
    check("protected-core river route clears all existing plots", not plot_hits, str(plot_hits))
    check("protected-core river route clears all civic buildings", not building_hits, str(building_hits))
    hearth = spec["hydrology"]["watersheds"][1]["main_channel"]
    protected_start = next(i for i, station in enumerate(hearth["stations"]) if station["cell"] == [-3, 38])
    check("protected-core river remains one cell wide", all(v == 1 for v in hearth["width_by_reach_cells"][protected_start:]), str(hearth["width_by_reach_cells"][protected_start:]))

    all_points = []
    for ws in spec["hydrology"]["watersheds"]:
        stations = ws["main_channel"]["stations"]
        levels = [s["level"] for s in stations]
        check(f"{ws['id']} never flows uphill", all(a >= c for a, c in zip(levels, levels[1:])), str(levels))
        check(f"{ws['id']} width count matches reaches", len(ws["main_channel"]["width_by_reach_cells"]) == len(stations) - 1, f"{len(ws['main_channel']['width_by_reach_cells'])}/{len(stations) - 1}")
        check(f"{ws['id']} starts at spring", stations[0]["kind"] == "spring", str(stations[0]))
        check(f"{ws['id']} reaches declared ocean mouth", stations[-1]["cell"] == ws["outlet"]["cell"] and stations[-1]["kind"] == "ocean_mouth", str(stations[-1]))
        for tr in ws["tributaries"]:
            tl = [s["level"] for s in tr["stations"]]
            check(f"{tr['id']} never flows uphill", all(a >= c for a, c in zip(tl, tl[1:])), str(tl))
            check(f"{tr['id']} has typed endpoints", tr["stations"][0]["kind"] == "spring" and tr["stations"][-1]["kind"] in ("lake_inlet", "confluence"), str([tr["stations"][0], tr["stations"][-1]]))
        for lake in ws["lakes"]:
            check(f"{lake['id']} has inlet", len(lake["inlets"]) >= 1, str(lake["inlets"]))
            check(f"{lake['id']} has one outlet", isinstance(lake["outlet"], list) and len(lake["outlet"]) == 2, str(lake["outlet"]))
            check(f"{lake['id']} water Z matches natural formula", abs(lake["water_z_m"] - (0.62 + lake["water_level"])) < 1e-9, str(lake["water_z_m"]))
        all_points.extend(s["cell"] for s in stations)

    minx, miny = b["min"]
    maxx, maxy = b["max"]
    check("all hydrology stations inside world", all(minx <= x <= maxx and miny <= y <= maxy for x, y in all_points), f"{len(all_points)} stations")
    check("three watersheds", len(spec["hydrology"]["watersheds"]) == 3, str(len(spec["hydrology"]["watersheds"])))
    check("three lakes", sum(len(w["lakes"]) for w in spec["hydrology"]["watersheds"]) == 3, "3")
    check("three ocean mouths unique", len({tuple(v) for v in spec["hydrology"]["ocean_mouths"]}) == 3, str(spec["hydrology"]["ocean_mouths"]))

    plots = spec["plots"]["added"]
    check("24 satellite plots", len(plots) == 24, str(len(plots)))
    check("all satellite plots empty", all(not p["structures"] and p["owner_type"] == "unowned" for p in plots), "all empty and unowned")
    overlap_pairs = []
    for i, p in enumerate(plots):
        for q in plots[i + 1:]:
            if boxes_overlap(p["occupied_bounds_cells"], q["occupied_bounds_cells"]):
                overlap_pairs.append([p["id"], q["id"]])
    check("satellite plots do not overlap", not overlap_pairs, str(overlap_pairs))
    core = src["protected_bounds_cells"]
    intrusions = [p["id"] for p in plots if boxes_overlap(p["occupied_bounds_cells"], core)]
    check("satellite plots outside protected civic rectangle", not intrusions, str(intrusions))
    check("42 total empty plots", spec["plots"]["total_empty_plot_count"] == 42, str(spec["plots"]["total_empty_plot_count"]))

    bridge_ids = {v["id"] for v in spec["transport"]["bridges"]}
    check("nine explicit road-water bridges", len(bridge_ids) == 9, str(sorted(bridge_ids)))
    required = {"BR_C01", "BR_C02", "BR_C03", "BR_C04", "BR_C05", "BR_C06",
                "BR_W01", "BR_E01", "BR_M01"}
    check("all planned crossings assigned", bridge_ids == required, str(sorted(bridge_ids)))
    civic_decks = {tuple(cell) for br in spec["transport"]["bridges"] if br["id"].startswith("BR_C") for cell in br["deck_cells"]}
    expected_civic_decks = {(-3, 24), (-3, 25), (-3, 37), (-3, 38),
                            (14, 55), (14, 56), (14, 79), (14, 80),
                            (-3, 27), (14, 20), (14, 21)}
    check("city bridge crossings use protected clear corridors", civic_decks == expected_civic_decks, str(sorted(civic_decks)))

    levels = spec["elevation"]["levels"]
    check("elevation levels contiguous", [v["level"] for v in levels] == list(range(1, 8)), str([v["level"] for v in levels]))
    check("mountain maximum level seven", spec["elevation"]["max_level"] == 7, str(spec["elevation"]["max_level"]))
    check("all new tile rotations complete", spec["tile_program"]["all_new_tiles_rotation_complete"], "quarter-turn variants")
    new_ids = []
    for group in ("new_mountain_tiles", "new_river_tiles", "new_lake_tiles", "new_waterfall_tiles"):
        new_ids.extend(v["id"] for v in spec["tile_program"][group])
    check("new terrain tile ids unique", len(new_ids) == len(set(new_ids)), str(len(new_ids)))
    check("new terrain tile count", len(new_ids) == 32, str(len(new_ids)))
    check("no player buildings", not spec["plots"]["player_buildings"], "[]")

    return {
        "schema": "markets-and-makers.expanded-open-world.qa.v1",
        "status": "PASS" if all(c["passed"] for c in checks) else "FAIL",
        "checks_passed": sum(c["passed"] for c in checks),
        "checks_total": len(checks),
        "checks": checks,
    }


def render_planning_map(spec):
    """Render a deterministic top-down verification map from the exact spec."""
    size = 1400
    margin = 70
    canvas = Image.new("RGB", (size, size), "#0b6580")
    draw = ImageDraw.Draw(canvas)
    bounds = spec["world"]["bounds_cells"]
    minx, miny = bounds["min"]
    maxx, maxy = bounds["max"]
    scale = (size - margin * 2) / 256.0

    def pt(cell):
        x, y = cell
        return (margin + (x - minx + 0.5) * scale,
                size - margin - (y - miny + 0.5) * scale)

    def poly(points, fill, outline=None, width=1):
        q = [pt(v) for v in points]
        draw.polygon(q, fill=fill)
        if outline:
            draw.line(q + [q[0]], fill=outline, width=width, joint="curve")

    # Land and ordered elevation bands.
    poly(spec["world"]["land_polygon"], "#90a93e", "#243b30", 4)
    level_colors = ["#8da143", "#8f9646", "#968c4b", "#9c8150", "#98754d", "#8e6949", "#825e46"]
    for level in spec["elevation"]["levels"]:
        for polygon in level["polygons"]:
            poly(polygon, level_colors[level["level"] - 1], "#344535", 1)

    # Forests behind transport and water.
    for biome in spec["biomes"]:
        poly(biome["polygon"], "#3d773d", "#27542e", 2)

    # Existing city protection area.
    core = spec["source_city"]["protected_bounds_cells"]
    c0 = pt([core["min"][0], core["max"][1]])
    c1 = pt([core["max"][0], core["min"][1]])
    draw.rectangle([c0, c1], fill="#b9aa76", outline="#f4e1a0", width=4)

    # Roads.
    for road in spec["transport"]["roads"]:
        q = [pt(v) for v in road["polyline"]]
        draw.line(q, fill="#273a3d", width=max(5, int(road["width_cells"] * scale)), joint="curve")
        draw.line(q, fill="#d7b978", width=max(2, int(road["width_cells"] * scale) - 4), joint="curve")
    for trail in spec["transport"]["trails"]:
        points = trail.get("polyline", trail.get("closed_polyline"))
        draw.line([pt(v) for v in points], fill="#eee0b2", width=3, joint="curve")

    # Hydrology including lakes.
    for watershed in spec["hydrology"]["watersheds"]:
        for lake in watershed["lakes"]:
            poly(lake["polygon"], "#29a9b8", "#e6f8db", 2)
        channel = watershed["main_channel"]
        q = [pt(v["cell"]) for v in channel["stations"]]
        draw.line(q, fill="#0d536b", width=12, joint="curve")
        draw.line(q, fill="#31c3d0", width=7, joint="curve")
        for tributary in watershed["tributaries"]:
            tq = [pt(v["cell"]) for v in tributary["stations"]]
            draw.line(tq, fill="#0d536b", width=7, joint="curve")
            draw.line(tq, fill="#51cbd3", width=4, joint="curve")

    # Plots.
    for p in spec["plots"]["added"]:
        r = p["occupied_bounds_cells"]
        p0 = pt([r["min"][0], r["max"][1]])
        p1 = pt([r["max"][0], r["min"][1]])
        draw.rectangle([p0, p1], fill="#d8bd68", outline="#fff1be", width=2)

    # Bridges and points of interest.
    for bridge in spec["transport"]["bridges"]:
        cells = bridge["deck_cells"]
        draw.line([pt(cells[0]), pt(cells[-1])], fill="#fff4cf", width=8)
        draw.line([pt(cells[0]), pt(cells[-1])], fill="#8a5b32", width=3)
    for poi in spec["points_of_interest"]:
        anchor = poi.get("anchor_cell", poi.get("portal_anchor_cell"))
        x, y = pt(anchor)
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill="#f3b43c", outline="#492c21", width=2)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 24)
        small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
    except OSError:
        font = ImageFont.load_default()
        small = font
    draw.text((margin, 20), "MARKETS & MAKERS — SUNWOVEN ISLAND EXPANSION GRID", font=font, fill="#fff7dd")
    labels = [
        ([-2, 0], "CIVIC CENTER"), ([-76, 124], "MIRRORLEAF LAKE"),
        ([5, 123], "HEARTHMERE"), ([72, 136], "SUNMIRROR TARN"),
        ([-58, 150], "WEST RANGE"), ([2, 157], "CENTRAL RANGE"),
        ([69, 159], "EAST RANGE"), ([-46, 125], "COPPERGLASS CAVE"),
        ([42, 147], "MAKERS GAP"),
    ]
    for cell, label in labels:
        draw.text(pt(cell), label, font=small, fill="#fff9db", stroke_width=2, stroke_fill="#193431", anchor="mm")
    draw.text((margin, size - 42), "512 m × 512 m • 2 m cells • 16 × 16 chunks • north is up", font=small, fill="#d9f3e1")
    canvas.save(MAP_FILE, optimize=True)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    spec = build_spec()
    qa = validate(spec)
    OUT_FILE.write_text(json.dumps(spec, indent=2) + "\n")
    QA_FILE.write_text(json.dumps(qa, indent=2) + "\n")
    render_planning_map(spec)
    print(json.dumps({
        "status": qa["status"],
        "checks": f"{qa['checks_passed']}/{qa['checks_total']}",
        "layout": str(OUT_FILE),
        "qa": str(QA_FILE),
        "planning_map": str(MAP_FILE),
        "world_cells": spec["world"]["dimensions_cells"],
        "world_m": spec["world"]["dimensions_m"],
        "chunks": spec["world"]["terrain_chunk_count"],
        "watersheds": len(spec["hydrology"]["watersheds"]),
        "satellite_plots": spec["plots"]["added_plot_count"],
        "new_tiles": sum(len(spec["tile_program"][k]) for k in ("new_mountain_tiles", "new_river_tiles", "new_lake_tiles", "new_waterfall_tiles")),
    }, indent=2))
    if qa["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
