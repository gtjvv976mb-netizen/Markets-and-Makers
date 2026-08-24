#!/usr/bin/env python3
"""Independent validator for Markets & Makers Highlands & Rivers World v1.

The validator deliberately has no Blender dependency.  It binds the generated
world to the locked T51-T74 expansion specification, the approved V5 tile kit,
and the original government city.  It checks content topology as well as file
presence so a visually convincing render cannot conceal broken game data.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import struct
import sys
import zipfile
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator, Sequence


PACKAGE_NAME = "markets-and-makers-highlands-rivers-world-v1"
MANIFEST_SCHEMA = "markets-and-makers.highlands-rivers-world.generated.v1"
LAYOUT_SCHEMA = "markets-and-makers.highlands-rivers-world.layout.v1"
HYDROLOGY_SCHEMA = "markets-and-makers.highlands-rivers-world.hydrology.v1"
SPEC_SCHEMA = "markets-and-makers.mountain-river-expansion.spec.v1"

SPEC_REL = Path("art/official-v1/highlands-rivers-v1/reference/mountain-river-expansion-spec-manifest.json")
BASE_CITY_LAYOUT_REL = Path("outputs/markets-and-makers-government-city-center-v1/layout.json")
BASE_CITY_MANIFEST_REL = Path("outputs/markets-and-makers-government-city-center-v1/manifest.json")
V5_MANIFEST_REL = Path("outputs/markets-and-makers-logo-world-tiles-v5/manifest.json")

EXPECTED_TILE_IDS = [f"T{number}" for number in range(51, 75)]
EXPECTED_BUILDING_IDS = [f"CV{number:02d}" for number in range(1, 10)]
EXPECTED_ORIGINAL_PLOT_COUNT = 18
EXPECTED_ADDED_PLOT_COUNT = 24
EXPECTED_TOTAL_PLOT_COUNT = 42
EXPECTED_DECLARED_CHUNKS = 256
CHUNK_SIZE_CELLS = (16, 16)

WIDE_PREVIEW = Path("previews/mm_highlands_rivers_world_v1_wide.png")
HYDROLOGY_PREVIEW = Path("previews/mm_highlands_rivers_world_v1_hydrology.png")
EXPECTED_PREVIEW_DIMENSIONS = {
    WIDE_PREVIEW.as_posix(): (2560, 1440),
    HYDROLOGY_PREVIEW.as_posix(): (1920, 1080),
}

REQUIRED_STATIC_FILES = {
    "markets-and-makers-highlands-rivers-world-v1.blend",
    "mm_highlands_rivers_world_v1_preview.glb",
    "mm_highlands_rivers_world_v1_lite.glb",
    "mm_highlands_rivers_tiles_v1.glb",
    "layout.json",
    "terrain-grid.json",
    "hydrology.json",
    "source-lock.json",
    "manifest.json",
    "qa-report-generator.json",
    "README.md",
    "checksums.sha256",
    WIDE_PREVIEW.as_posix(),
    HYDROLOGY_PREVIEW.as_posix(),
}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PLAYER_BUILDING_RE = re.compile(
    r"(?:PLAYER[_ -]?(?:OWNED[_ -]?)?(?:BUILDING|BUSINESS)|BUSINESS[_ -]?(?:BUILDING|ASSET|NODE)|MM_CITY_BUILDING_\d{2})\b",
    re.IGNORECASE,
)

COMPONENT_INFO: dict[int, tuple[str, int]] = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}


@dataclass
class ValidationState:
    checks: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    assets: list[dict[str, Any]] = field(default_factory=list)

    def check(self, name: str, condition: bool, detail: Any = "") -> bool:
        passed = bool(condition)
        self.checks.append({"name": name, "passed": passed, "severity": "error", "detail": str(detail)})
        if not passed:
            self.errors.append(f"{name}: {detail}")
        return passed

    def warn(self, name: str, condition: bool, detail: Any = "") -> bool:
        passed = bool(condition)
        self.checks.append({"name": name, "passed": passed, "severity": "warning", "detail": str(detail)})
        if not passed:
            self.warnings.append(f"{name}: {detail}")
        return passed


def parse_args() -> argparse.Namespace:
    workspace_default = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Validate Highlands & Rivers World v1 without Blender.")
    parser.add_argument("--workspace", type=Path, default=workspace_default)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--zip", dest="zip_path", type=Path)
    parser.add_argument("--max-triangles-per-glb", type=int, default=2_000_000)
    parser.add_argument("--skip-zip", action="store_true")
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path}: JSON root must be an object")
    return value


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def pair(value: Any, *, integers: bool = True) -> tuple[int, int] | tuple[float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    if integers:
        if not all(isinstance(item, int) and not isinstance(item, bool) for item in value):
            return None
        return int(value[0]), int(value[1])
    if not all(is_number(item) for item in value):
        return None
    return float(value[0]), float(value[1])


def inclusive_rect(value: Any) -> tuple[tuple[int, int], tuple[int, int]] | None:
    if not isinstance(value, dict):
        return None
    minimum = pair(value.get("min"))
    maximum = pair(value.get("max"))
    if minimum is None or maximum is None:
        return None
    if minimum[0] > maximum[0] or minimum[1] > maximum[1]:
        return None
    return minimum, maximum


def rect_from_record(record: dict[str, Any]) -> tuple[tuple[int, int], tuple[int, int]] | None:
    for key in ("occupied_bounds_cells", "bounds_cells", "cell_bounds"):
        rect = inclusive_rect(record.get(key))
        if rect is not None:
            return rect
    anchor = pair(record.get("anchor_cell_sw") or record.get("anchor_cell") or record.get("anchor"))
    footprint = pair(record.get("footprint_tiles") or record.get("footprint_cells") or record.get("footprint"))
    if anchor is None or footprint is None or footprint[0] <= 0 or footprint[1] <= 0:
        return None
    return anchor, (anchor[0] + footprint[0] - 1, anchor[1] + footprint[1] - 1)


def rect_area(rect: tuple[tuple[int, int], tuple[int, int]]) -> int:
    return (rect[1][0] - rect[0][0] + 1) * (rect[1][1] - rect[0][1] + 1)


def rect_cells(rect: tuple[tuple[int, int], tuple[int, int]]) -> Iterator[tuple[int, int]]:
    for x in range(rect[0][0], rect[1][0] + 1):
        for y in range(rect[0][1], rect[1][1] + 1):
            yield x, y


def rectangles_overlap(a: tuple[tuple[int, int], tuple[int, int]], b: tuple[tuple[int, int], tuple[int, int]]) -> bool:
    return not (a[1][0] < b[0][0] or b[1][0] < a[0][0] or a[1][1] < b[0][1] or b[1][1] < a[0][1])


def within(rect: tuple[tuple[int, int], tuple[int, int]], bounds: tuple[tuple[int, int], tuple[int, int]]) -> bool:
    return all(rect[0][axis] >= bounds[0][axis] and rect[1][axis] <= bounds[1][axis] for axis in (0, 1))


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def recursively_yield(value: Any) -> Iterator[Any]:
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from recursively_yield(child)
    elif isinstance(value, list):
        for child in value:
            yield from recursively_yield(child)


def recursively_contains(value: Any, needle: str) -> bool:
    return any(item == needle for item in recursively_yield(value) if isinstance(item, str))


def find_record_list(root: Any, required_ids: Iterable[str]) -> list[dict[str, Any]] | None:
    wanted = set(required_ids)
    for value in recursively_yield(root):
        if not isinstance(value, list) or not value or not all(isinstance(item, dict) for item in value):
            continue
        ids = {str(item.get("id")) for item in value if item.get("id") is not None}
        if wanted <= ids:
            return value
    return None


def records_by_id(records: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(records, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for record in records:
        if isinstance(record, dict) and isinstance(record.get("id"), str):
            result[record["id"]] = record
    return result


def flatten_plot_records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict) and isinstance(item.get("id"), str)]
    if not isinstance(value, dict):
        return []
    result: list[dict[str, Any]] = []
    for key in ("existing", "added", "records", "all", "plots"):
        child = value.get(key)
        if isinstance(child, list):
            result.extend(item for item in child if isinstance(item, dict) and isinstance(item.get("id"), str))
    unique: dict[str, dict[str, Any]] = {}
    for record in result:
        unique[record["id"]] = record
    return list(unique.values())


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ValueError("not a valid PNG IHDR")
    return struct.unpack(">II", header[16:24])


def parse_checksum_file(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            continue
        match = re.match(r"^([0-9a-fA-F]{64})\s+\*?(.+)$", stripped)
        if not match:
            raise ValueError(f"invalid checksum line {line_number}: {line}")
        digest, rel = match.group(1).lower(), match.group(2).strip()
        rel = PurePosixPath(rel).as_posix()
        if rel.startswith("./"):
            rel = rel[2:]
        if rel in result:
            raise ValueError(f"duplicate checksum path: {rel}")
        result[rel] = digest
    return result


def _decode_data_uri(uri: str) -> bytes:
    if not uri.startswith("data:") or "," not in uri:
        raise ValueError("unsupported buffer URI")
    header, payload = uri.split(",", 1)
    if ";base64" not in header:
        raise ValueError("only base64 data URIs are supported")
    return base64.b64decode(payload)


def parse_glb(path: Path) -> tuple[dict[str, Any], list[bytes]]:
    raw = path.read_bytes()
    if len(raw) < 12:
        raise ValueError("GLB shorter than header")
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    if magic != GLB_MAGIC or version != 2 or declared_length != len(raw):
        raise ValueError(f"bad GLB header magic={magic!r} version={version} length={declared_length}/{len(raw)}")
    offset = 12
    json_doc: dict[str, Any] | None = None
    binary_chunks: list[bytes] = []
    while offset < len(raw):
        if offset + 8 > len(raw):
            raise ValueError("truncated GLB chunk header")
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        if offset + length > len(raw):
            raise ValueError("truncated GLB chunk")
        payload = raw[offset : offset + length]
        offset += length
        if chunk_type == JSON_CHUNK:
            if json_doc is not None:
                raise ValueError("multiple JSON chunks")
            json_doc = json.loads(payload.rstrip(b"\x00 \t\r\n").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary_chunks.append(payload)
    if json_doc is None or not isinstance(json_doc, dict):
        raise ValueError("missing JSON object chunk")

    buffers: list[bytes] = []
    bin_index = 0
    for buffer_record in json_doc.get("buffers", []):
        uri = buffer_record.get("uri") if isinstance(buffer_record, dict) else None
        if isinstance(uri, str):
            buffer_data = _decode_data_uri(uri)
        else:
            if bin_index >= len(binary_chunks):
                raise ValueError("missing BIN chunk for declared buffer")
            buffer_data = binary_chunks[bin_index]
            bin_index += 1
        declared = int(buffer_record.get("byteLength", len(buffer_data)))
        if len(buffer_data) < declared:
            raise ValueError("buffer shorter than declared byteLength")
        buffers.append(buffer_data)
    return json_doc, buffers


def accessor_values(doc: dict[str, Any], buffers: Sequence[bytes], accessor_index: int) -> list[tuple[float | int, ...]]:
    accessors = doc.get("accessors", [])
    views = doc.get("bufferViews", [])
    if not 0 <= accessor_index < len(accessors):
        raise ValueError(f"bad accessor index {accessor_index}")
    accessor = accessors[accessor_index]
    if "sparse" in accessor:
        raise ValueError("sparse accessors are not supported by this binding validator")
    if "bufferView" not in accessor:
        raise ValueError("accessor has no bufferView")
    view_index = int(accessor["bufferView"])
    if not 0 <= view_index < len(views):
        raise ValueError("bad bufferView index")
    view = views[view_index]
    buffer_index = int(view.get("buffer", 0))
    if not 0 <= buffer_index < len(buffers):
        raise ValueError("bad buffer index")
    component_type = int(accessor["componentType"])
    if component_type not in COMPONENT_INFO:
        raise ValueError(f"unsupported component type {component_type}")
    fmt_char, component_size = COMPONENT_INFO[component_type]
    accessor_type = str(accessor["type"])
    if accessor_type not in TYPE_COMPONENTS:
        raise ValueError(f"unsupported accessor type {accessor_type}")
    components = TYPE_COMPONENTS[accessor_type]
    count = int(accessor.get("count", 0))
    packed_size = component_size * components
    stride = int(view.get("byteStride", packed_size))
    if stride < packed_size:
        raise ValueError("byteStride smaller than packed element")
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    data = buffers[buffer_index]
    if count and start + (count - 1) * stride + packed_size > len(data):
        raise ValueError("accessor reads past buffer")
    fmt = "<" + fmt_char * components
    return [struct.unpack_from(fmt, data, start + index * stride) for index in range(count)]


def _triangles_for_primitive(indices: Sequence[int], mode: int) -> Iterator[tuple[int, int, int]]:
    if mode == 4:
        for index in range(0, len(indices) - 2, 3):
            yield int(indices[index]), int(indices[index + 1]), int(indices[index + 2])
    elif mode == 5:
        for index in range(len(indices) - 2):
            a, b, c = int(indices[index]), int(indices[index + 1]), int(indices[index + 2])
            yield (a, b, c) if index % 2 == 0 else (b, a, c)
    elif mode == 6:
        for index in range(1, len(indices) - 1):
            yield int(indices[0]), int(indices[index]), int(indices[index + 1])
    else:
        raise ValueError(f"non-triangle primitive mode {mode}")


def inspect_glb(path: Path, max_triangles_to_scan: int) -> dict[str, Any]:
    doc, buffers = parse_glb(path)
    total_vertices = 0
    total_triangles = 0
    scanned_triangles = 0
    degenerate_triangles = 0
    primitive_count = 0
    bounds_min = [math.inf, math.inf, math.inf]
    bounds_max = [-math.inf, -math.inf, -math.inf]

    for mesh in doc.get("meshes", []):
        if not isinstance(mesh, dict):
            continue
        for primitive in mesh.get("primitives", []):
            primitive_count += 1
            if not isinstance(primitive, dict):
                raise ValueError("mesh primitive is not an object")
            attributes = primitive.get("attributes", {})
            if "POSITION" not in attributes:
                raise ValueError("mesh primitive has no POSITION")
            positions_raw = accessor_values(doc, buffers, int(attributes["POSITION"]))
            positions: list[tuple[float, float, float]] = []
            for raw_position in positions_raw:
                if len(raw_position) < 3:
                    raise ValueError("POSITION is not VEC3")
                position = (float(raw_position[0]), float(raw_position[1]), float(raw_position[2]))
                if not all(math.isfinite(value) for value in position):
                    raise ValueError("non-finite vertex position")
                positions.append(position)
                for axis in range(3):
                    bounds_min[axis] = min(bounds_min[axis], position[axis])
                    bounds_max[axis] = max(bounds_max[axis], position[axis])
            total_vertices += len(positions)

            if "indices" in primitive:
                raw_indices = accessor_values(doc, buffers, int(primitive["indices"]))
                indices = [int(item[0]) for item in raw_indices]
            else:
                indices = list(range(len(positions)))
            triangles = list(_triangles_for_primitive(indices, int(primitive.get("mode", 4))))
            total_triangles += len(triangles)
            if not triangles:
                raise ValueError("mesh primitive has no triangles")

            remaining = max(0, max_triangles_to_scan - scanned_triangles)
            if remaining == 0:
                sample: Sequence[tuple[int, int, int]] = []
            elif len(triangles) <= remaining:
                sample = triangles
            else:
                stride = max(1, len(triangles) // remaining)
                sample = triangles[::stride][:remaining]
            for a, b, c in sample:
                if min(a, b, c) < 0 or max(a, b, c) >= len(positions):
                    raise ValueError("triangle index outside POSITION accessor")
                pa, pb, pc = positions[a], positions[b], positions[c]
                ab = (pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2])
                ac = (pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2])
                cross = (
                    ab[1] * ac[2] - ab[2] * ac[1],
                    ab[2] * ac[0] - ab[0] * ac[2],
                    ab[0] * ac[1] - ab[1] * ac[0],
                )
                area4 = cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2
                if not math.isfinite(area4) or area4 <= 1e-18:
                    degenerate_triangles += 1
            scanned_triangles += len(sample)

    if primitive_count == 0 or total_vertices == 0 or total_triangles == 0:
        raise ValueError("GLB contains no inspectable triangle geometry")
    extents = [bounds_max[axis] - bounds_min[axis] for axis in range(3)]
    if sum(extent > 1e-6 for extent in extents) < 2:
        raise ValueError(f"geometry bounds are degenerate: {extents}")
    if degenerate_triangles:
        raise ValueError(f"found {degenerate_triangles} degenerate triangles among {scanned_triangles} scanned")
    json_text = canonical_json(doc)
    return {
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "vertices": total_vertices,
        "triangles": total_triangles,
        "primitives": primitive_count,
        "triangles_scanned": scanned_triangles,
        "degenerate_triangles": degenerate_triangles,
        "bounds_min": bounds_min,
        "bounds_max": bounds_max,
        "node_text": json_text,
    }


def _record_path(record: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value:
            return PurePosixPath(value).as_posix()
        if isinstance(value, dict):
            nested = value.get("file") or value.get("path")
            if isinstance(nested, str) and nested:
                return PurePosixPath(nested).as_posix()
    return None


def validate_source_locks(
    state: ValidationState,
    workspace: Path,
    package: Path,
    manifest: dict[str, Any],
    source_lock: dict[str, Any],
    spec_path: Path,
    city_layout_path: Path,
    city_manifest_path: Path,
    v5_manifest_path: Path,
) -> None:
    expected = {
        "expansion_spec": sha256(spec_path),
        "government_city_layout": sha256(city_layout_path),
        "government_city_manifest": sha256(city_manifest_path),
        "v5_tile_manifest": sha256(v5_manifest_path),
    }
    lock_blob = {"source_lock": source_lock, "manifest_source_locks": manifest.get("source_locks")}
    for label, digest in expected.items():
        state.check(f"source_lock.contains.{label}", recursively_contains(lock_blob, digest), digest)

    checked_paths = 0
    for value in recursively_yield(lock_blob):
        if not isinstance(value, dict):
            continue
        rel = value.get("file") or value.get("path")
        digest = value.get("sha256")
        if not isinstance(rel, str) or not isinstance(digest, str) or not SHA256_RE.fullmatch(digest.lower()):
            continue
        candidates = [Path(rel)] if Path(rel).is_absolute() else [workspace / rel, package / rel]
        existing = next((candidate for candidate in candidates if candidate.is_file()), None)
        if existing is None:
            continue
        checked_paths += 1
        state.check(f"source_lock.hash.{checked_paths}", sha256(existing) == digest.lower(), rel)
    state.check("source_lock.resolvable_records", checked_paths >= 4, checked_paths)


def _first_value(records: Sequence[dict[str, Any]], keys: Sequence[str]) -> Any:
    for record in records:
        if not isinstance(record, dict):
            continue
        for key in keys:
            if key in record:
                return record[key]
    return None


def validate_world_contract(
    state: ValidationState,
    manifest: dict[str, Any],
    layout: dict[str, Any],
    spec: dict[str, Any],
    spec_path: Path,
    baseline_layout_path: Path,
) -> None:
    contracts = [layout.get("coordinate_contract", {}), manifest.get("coordinate_contract", {})]
    tile_size = _first_value(contracts, ("tile_size_m", "cell_m"))
    if isinstance(tile_size, list):
        tile_size_ok = tile_size == [2, 2] or tile_size == [2.0, 2.0]
    else:
        tile_size_ok = tile_size == 2 or tile_size == 2.0
    state.check("coordinate.tile_size", tile_size_ok, tile_size)
    state.check("coordinate.base_walk_z", _first_value(contracts, ("base_walk_z_m", "level_0_walk_z_m", "walk_z_m")) == 1.0, _first_value(contracts, ("base_walk_z_m", "level_0_walk_z_m", "walk_z_m")))
    state.check("coordinate.elevation_step", _first_value(contracts, ("elevation_step_m", "terrain_level_step_m", "terrace_step_m")) == 1.0, _first_value(contracts, ("elevation_step_m", "terrain_level_step_m", "terrace_step_m")))
    state.check("coordinate.ocean_z", _first_value(contracts, ("ocean_z_m", "ocean_surface_z_m", "water_z_m")) == -0.18, _first_value(contracts, ("ocean_z_m", "ocean_surface_z_m", "water_z_m")))
    river_z = _first_value(contracts, ("river_surface_z_m", "river_z_m", "river_base_z_m"))
    formula = _first_value(contracts, ("river_water_z_formula", "river_surface_formula"))
    river_contract_ok = river_z == 0.62 or (isinstance(formula, str) and "0.62" in formula)
    state.check("coordinate.natural_river_z", river_contract_ok, f"river_z={river_z!r} formula={formula!r}")
    state.check("coordinate.rotations", _first_value(contracts, ("rotation_degrees", "runtime_rotations_degrees", "rotations_degrees")) == [0, 90, 180, 270], _first_value(contracts, ("rotation_degrees", "runtime_rotations_degrees", "rotations_degrees")))

    world = layout.get("world", {})
    manifest_world = manifest.get("world", {})
    state.check("world.dimensions_cells", world.get("dimensions_cells") == [256, 256] and manifest_world.get("dimensions_cells") == [256, 256], f"layout={world.get('dimensions_cells')} manifest={manifest_world.get('dimensions_cells')}")
    state.check("world.dimensions_m", world.get("dimensions_m") == [512, 512] and manifest_world.get("dimensions_m") == [512, 512], f"layout={world.get('dimensions_m')} manifest={manifest_world.get('dimensions_m')}")
    state.check("world.chunk_size", world.get("chunk_size_cells") == [16, 16] and manifest_world.get("chunk_size_cells") == [16, 16], f"layout={world.get('chunk_size_cells')} manifest={manifest_world.get('chunk_size_cells')}")
    state.check("world.chunk_grid", world.get("chunk_grid") == [16, 16] and manifest_world.get("chunk_grid") == [16, 16], f"layout={world.get('chunk_grid')} manifest={manifest_world.get('chunk_grid')}")
    state.check("world.chunk_count", world.get("terrain_chunk_count") == 256 and manifest_world.get("terrain_chunk_count") == 256, f"layout={world.get('terrain_chunk_count')} manifest={manifest_world.get('terrain_chunk_count')}")

    spec_digest = sha256(spec_path)
    city_digest = sha256(baseline_layout_path)
    state.check("layout.source_spec_binding", recursively_contains(layout.get("source_spec"), spec_digest), spec_digest)
    state.check("layout.source_city_binding", recursively_contains(layout.get("source_city"), city_digest), city_digest)
    state.check("spec.grid_cell", spec.get("grid", {}).get("cell_m") == [2.0, 2.0], spec.get("grid", {}).get("cell_m"))


def validate_blend_source(state: ValidationState, package: Path) -> None:
    path = package / "markets-and-makers-highlands-rivers-world-v1.blend"
    state.check("blend.exists", path.is_file(), path)
    if not path.is_file():
        return
    with path.open("rb") as handle:
        header = handle.read(12)
    state.check("blend.header", header.startswith(b"BLENDER"), header)
    state.check("blend.nontrivial_size", path.stat().st_size >= 1_000_000, path.stat().st_size)
    state.assets.append({"kind": "blender_source", "file": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)})


def validate_tile_contract(
    state: ValidationState,
    package: Path,
    spec: dict[str, Any],
    manifest: dict[str, Any],
    max_triangles: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    spec_tiles = records_by_id(spec.get("new_tiles"))
    generated_list = manifest.get("tiles")
    generated_tiles = records_by_id(generated_list)
    state.check("tiles.spec_exact_ids", list(spec_tiles) == EXPECTED_TILE_IDS, list(spec_tiles))
    state.check("tiles.generated_order", isinstance(generated_list, list) and [item.get("id") for item in generated_list] == EXPECTED_TILE_IDS, [item.get("id") for item in generated_list] if isinstance(generated_list, list) else type(generated_list).__name__)
    state.check("tiles.generated_exact_count", len(generated_tiles) == 24, len(generated_tiles))

    inspected: dict[str, dict[str, Any]] = {}
    for tile_id in EXPECTED_TILE_IDS:
        expected = spec_tiles.get(tile_id, {})
        actual = generated_tiles.get(tile_id, {})
        state.check(f"tile.{tile_id}.present", bool(actual), actual.get("key"))
        if not actual:
            continue
        for key in ("key", "family", "footprint_cells"):
            state.check(f"tile.{tile_id}.{key}", actual.get(key) == expected.get(key), f"actual={actual.get(key)!r} expected={expected.get(key)!r}")
        expected_delta = expected.get("elevation_delta_m", 0)
        actual_delta = actual.get("elevation_delta_m", 0)
        state.check(f"tile.{tile_id}.elevation_delta", actual_delta == expected_delta, f"actual={actual_delta} expected={expected_delta}")
        state.check(f"tile.{tile_id}.connections", canonical_json(actual.get("connections", [])) == canonical_json(expected.get("connections", [])), f"actual={actual.get('connections', [])!r}")
        if "edge_profiles" in expected:
            state.check(f"tile.{tile_id}.edge_profiles", actual.get("edge_profiles") == expected.get("edge_profiles"), actual.get("edge_profiles"))
        if expected.get("family") == "river":
            for field_name in ("water_surface_z_local_m", "water_bed_z_local_m", "nominal_speed_mps"):
                state.check(f"tile.{tile_id}.{field_name}", actual.get(field_name) == expected.get(field_name), f"actual={actual.get(field_name)!r} expected={expected.get(field_name)!r}")
            actual_flow = actual.get("flow_vector_local_xy", actual.get("flow_vector_local_xyz"))
            expected_flow = expected.get("flow_vector_local_xy", expected.get("flow_vector_local_xyz"))
            state.check(f"tile.{tile_id}.flow_vector", actual_flow == expected_flow, f"actual={actual_flow!r} expected={expected_flow!r}")
            roles = [connection.get("role") for connection in actual.get("connections", []) if isinstance(connection, dict)]
            state.check(f"tile.{tile_id}.socket_roles", bool(roles) and all(isinstance(role, str) for role in roles), roles)

        expected_glb = f"tiles/{tile_id}_{expected.get('key')}.glb"
        expected_preview = f"previews/{tile_id}_{expected.get('key')}.png"
        glb_rel = _record_path(actual, "glb")
        preview_rel = _record_path(actual, "preview")
        state.check(f"tile.{tile_id}.glb_path", glb_rel == expected_glb, glb_rel)
        state.check(f"tile.{tile_id}.preview_path", preview_rel == expected_preview, preview_rel)
        glb_path = package / expected_glb
        preview_path = package / expected_preview
        state.check(f"tile.{tile_id}.glb_exists", glb_path.is_file(), expected_glb)
        state.check(f"tile.{tile_id}.preview_exists", preview_path.is_file(), expected_preview)
        if preview_path.is_file():
            try:
                dimensions = png_dimensions(preview_path)
                state.check(f"tile.{tile_id}.preview_dimensions", dimensions == (720, 720), dimensions)
            except Exception as exc:
                state.check(f"tile.{tile_id}.preview_png", False, exc)
        if glb_path.is_file():
            try:
                info = inspect_glb(glb_path, max_triangles)
                inspected[tile_id] = info
                state.assets.append({"kind": "tile_glb", "id": tile_id, "file": expected_glb, **{key: info[key] for key in ("bytes", "sha256", "vertices", "triangles", "primitives", "bounds_min", "bounds_max")}})
                declared_triangles = actual.get("triangles_lod0")
                state.check(f"tile.{tile_id}.declared_triangles", isinstance(declared_triangles, int) and declared_triangles == info["triangles"], f"declared={declared_triangles} inspected={info['triangles']}")
                ceiling = int(expected.get("budget", {}).get("triangles_lod0_max", 0))
                state.check(f"tile.{tile_id}.triangle_budget", info["triangles"] <= ceiling, f"{info['triangles']} <= {ceiling}")
                budget = actual.get("budget", {})
                state.check(f"tile.{tile_id}.declared_budget", isinstance(budget, dict) and budget.get("triangles_lod0_max") == ceiling, budget)
                token_text = info["node_text"].lower()
                state.check(f"tile.{tile_id}.identity_in_glb", tile_id.lower() in token_text or str(expected.get("key", "")).lower() in token_text, expected.get("key"))
                state.check(f"tile.{tile_id}.no_player_building_nodes", not PLAYER_BUILDING_RE.search(info["node_text"]), "node/mesh names")
            except Exception as exc:
                state.check(f"tile.{tile_id}.geometry", False, exc)
    return generated_tiles, inspected


def validate_combined_and_world_glbs(
    state: ValidationState,
    package: Path,
    spec_tiles: dict[str, dict[str, Any]],
    max_triangles: int,
) -> dict[str, dict[str, Any]]:
    files = {
        "tile_library": "mm_highlands_rivers_tiles_v1.glb",
        "world_preview": "mm_highlands_rivers_world_v1_preview.glb",
        "world_lite": "mm_highlands_rivers_world_v1_lite.glb",
    }
    result: dict[str, dict[str, Any]] = {}
    for kind, rel in files.items():
        path = package / rel
        state.check(f"artifact.{kind}.exists", path.is_file(), rel)
        if not path.is_file():
            continue
        try:
            info = inspect_glb(path, max_triangles)
            result[kind] = info
            state.assets.append({"kind": kind, "file": rel, **{key: info[key] for key in ("bytes", "sha256", "vertices", "triangles", "primitives", "bounds_min", "bounds_max")}})
            state.check(f"artifact.{kind}.no_player_building_nodes", not PLAYER_BUILDING_RE.search(info["node_text"]), "node/mesh names")
            if kind == "tile_library":
                text = info["node_text"].lower()
                for tile_id in EXPECTED_TILE_IDS:
                    key = str(spec_tiles[tile_id].get("key", "")).lower()
                    state.check(f"artifact.tile_library.contains.{tile_id}", tile_id.lower() in text or key in text, key)
        except Exception as exc:
            state.check(f"artifact.{kind}.geometry", False, exc)
    return result


def validate_previews(state: ValidationState, package: Path) -> None:
    for rel, expected in EXPECTED_PREVIEW_DIMENSIONS.items():
        path = package / rel
        state.check(f"preview.{PurePosixPath(rel).stem}.exists", path.is_file(), rel)
        if not path.is_file():
            continue
        try:
            dimensions = png_dimensions(path)
            state.check(f"preview.{PurePosixPath(rel).stem}.dimensions", dimensions == expected, f"actual={dimensions} expected={expected}")
            state.assets.append({"kind": "preview_png", "file": rel, "bytes": path.stat().st_size, "sha256": sha256(path), "dimensions": list(dimensions)})
        except Exception as exc:
            state.check(f"preview.{PurePosixPath(rel).stem}.png", False, exc)


def validate_chunks(
    state: ValidationState,
    package: Path,
    manifest: dict[str, Any],
    layout: dict[str, Any],
    max_triangles: int,
) -> tuple[dict[str, dict[str, Any]], tuple[tuple[int, int], tuple[int, int]] | None]:
    manifest_chunks = manifest.get("chunks")
    layout_chunks = layout.get("chunks")
    state.check("chunks.manifest_is_list", isinstance(manifest_chunks, list), type(manifest_chunks).__name__)
    state.check("chunks.layout_is_list", isinstance(layout_chunks, list), type(layout_chunks).__name__)
    manifest_by_id = records_by_id(manifest_chunks)
    layout_by_id = records_by_id(layout_chunks)
    count = len(manifest_by_id)
    declared_count = (
        manifest.get("counts", {}).get("chunks")
        or manifest.get("world", {}).get("terrain_chunk_count")
        or layout.get("streaming", {}).get("terrain_chunk_count")
        or count
    )
    state.check("chunks.declared_count_matches", isinstance(declared_count, int) and declared_count == count, f"declared={declared_count} records={count}")
    if count == EXPECTED_DECLARED_CHUNKS:
        state.check("chunks.official_count", True, count)
    else:
        grid = pair(manifest.get("world", {}).get("chunk_grid") or layout.get("streaming", {}).get("chunk_grid"))
        state.check("chunks.actual_stream_set_complete", grid is not None and grid[0] * grid[1] == count, f"count={count} grid={grid}")
    state.check("chunks.layout_manifest_same_ids", set(layout_by_id) == set(manifest_by_id), f"manifest={len(manifest_by_id)} layout={len(layout_by_id)}")

    world_bounds = inclusive_rect(manifest.get("world", {}).get("bounds_cells")) or inclusive_rect(layout.get("world", {}).get("bounds_cells"))
    state.check("world.bounds_cells", world_bounds is not None, world_bounds)
    used_cells: set[tuple[int, int]] = set()
    indices: set[tuple[int, int]] = set()
    total_declared_triangles = 0
    total_inspected_triangles = 0
    total_land = 0
    total_water = 0

    for chunk_id, chunk in manifest_by_id.items():
        layout_chunk = layout_by_id.get(chunk_id)
        state.check(f"chunk.{chunk_id}.layout_binding", layout_chunk is not None and layout_chunk.get("index") == chunk.get("index") and layout_chunk.get("bounds_cells") == chunk.get("bounds_cells"), "index/bounds")
        index = pair(chunk.get("index"))
        state.check(f"chunk.{chunk_id}.index", index is not None and index not in indices, index)
        if index is not None:
            indices.add(index)
        bounds = inclusive_rect(chunk.get("bounds_cells"))
        state.check(f"chunk.{chunk_id}.bounds", bounds is not None, bounds)
        if bounds is not None:
            dimensions = (bounds[1][0] - bounds[0][0] + 1, bounds[1][1] - bounds[0][1] + 1)
            state.check(f"chunk.{chunk_id}.dimensions", dimensions == CHUNK_SIZE_CELLS, dimensions)
            if world_bounds is not None:
                state.check(f"chunk.{chunk_id}.within_world", within(bounds, world_bounds), bounds)
            chunk_cells = set(rect_cells(bounds))
            state.check(f"chunk.{chunk_id}.no_overlap", not (chunk_cells & used_cells), len(chunk_cells & used_cells))
            used_cells |= chunk_cells
        origin = pair(chunk.get("origin_m"), integers=False)
        state.check(f"chunk.{chunk_id}.origin", origin is not None, origin)
        land_cells = chunk.get("land_cells")
        water_cells = chunk.get("water_cells")
        valid_counts = all(isinstance(value, int) and 0 <= value <= 256 for value in (land_cells, water_cells))
        state.check(f"chunk.{chunk_id}.cell_counts", valid_counts and int(land_cells) + int(water_cells) <= 256 if valid_counts else False, f"land={land_cells} water={water_cells}")
        if valid_counts:
            total_land += int(land_cells)
            total_water += int(water_cells)
        elev_min, elev_max = chunk.get("elevation_min"), chunk.get("elevation_max")
        state.check(f"chunk.{chunk_id}.elevation_range", is_number(elev_min) and is_number(elev_max) and float(elev_min) <= float(elev_max), f"{elev_min}..{elev_max}")
        state.check(f"chunk.{chunk_id}.object", isinstance(chunk.get("object"), str) and bool(chunk.get("object")), chunk.get("object"))
        state.check(f"chunk.{chunk_id}.materials", isinstance(chunk.get("materials"), list) and bool(chunk.get("materials")), chunk.get("materials"))
        glb_rel = _record_path(chunk, "glb")
        state.check(f"chunk.{chunk_id}.glb_path", isinstance(glb_rel, str) and glb_rel.startswith("chunks/") and glb_rel.endswith(".glb"), glb_rel)
        if not glb_rel:
            continue
        glb_path = package / glb_rel
        state.check(f"chunk.{chunk_id}.glb_exists", glb_path.is_file(), glb_rel)
        if not glb_path.is_file():
            continue
        try:
            info = inspect_glb(glb_path, max_triangles)
            declared_triangles = chunk.get("triangles")
            state.check(f"chunk.{chunk_id}.triangles", isinstance(declared_triangles, int) and declared_triangles == info["triangles"], f"declared={declared_triangles} inspected={info['triangles']}")
            if isinstance(declared_triangles, int):
                total_declared_triangles += declared_triangles
            total_inspected_triangles += info["triangles"]
            state.check(f"chunk.{chunk_id}.no_player_building_nodes", not PLAYER_BUILDING_RE.search(info["node_text"]), "node/mesh names")
            state.assets.append({"kind": "terrain_chunk", "id": chunk_id, "file": glb_rel, **{key: info[key] for key in ("bytes", "sha256", "vertices", "triangles", "primitives", "bounds_min", "bounds_max")}})
        except Exception as exc:
            state.check(f"chunk.{chunk_id}.geometry", False, exc)

    if world_bounds is not None:
        state.check("chunks.cover_world_exactly", len(used_cells) == rect_area(world_bounds), f"covered={len(used_cells)} expected={rect_area(world_bounds)}")
    state.check("chunks.triangle_totals", total_declared_triangles == total_inspected_triangles, f"declared={total_declared_triangles} inspected={total_inspected_triangles}")
    counts = manifest.get("counts", {})
    if isinstance(counts, dict):
        if isinstance(counts.get("land_cells"), int):
            state.check("chunks.land_total", counts["land_cells"] == total_land, f"declared={counts['land_cells']} chunks={total_land}")
        if isinstance(counts.get("water_cells"), int):
            state.check("chunks.water_total", counts["water_cells"] == total_water, f"declared={counts['water_cells']} chunks={total_water}")
    return manifest_by_id, world_bounds


def _node_key(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    cell = pair(value)
    if cell is not None:
        return f"{cell[0]},{cell[1]}"
    if isinstance(value, dict):
        if isinstance(value.get("id"), (str, int)):
            return str(value["id"])
        cell = pair(value.get("cell"))
        if cell is not None:
            return f"{cell[0]},{cell[1]}"
    return None


def extract_graph(hydrology: dict[str, Any], water_cells: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    graph = hydrology.get("graph", {})
    nodes: dict[str, dict[str, Any]] = {}
    graph_nodes = graph.get("nodes", []) if isinstance(graph, dict) else []
    if isinstance(graph_nodes, list):
        for node in graph_nodes:
            if not isinstance(node, dict):
                continue
            key = _node_key(node)
            if key is not None:
                nodes[key] = node
    cell_lookup: dict[tuple[int, int], dict[str, Any]] = {}
    for record in water_cells:
        cell = pair(record.get("cell"))
        if cell is None:
            continue
        cell_lookup[cell] = record
        key = _node_key(record) or f"{cell[0]},{cell[1]}"
        nodes.setdefault(key, record)
    by_cell_key = {pair(record.get("cell")): key for key, record in nodes.items() if pair(record.get("cell")) is not None}

    raw_edges = graph.get("edges", []) if isinstance(graph, dict) else []
    edges: list[dict[str, Any]] = []
    if isinstance(raw_edges, list):
        for index, edge in enumerate(raw_edges):
            if isinstance(edge, dict):
                source_raw = edge.get("from", edge.get("source", edge.get("upstream")))
                target_raw = edge.get("to", edge.get("target", edge.get("downstream")))
                source = _node_key(source_raw)
                target = _node_key(target_raw)
                if pair(source_raw) in by_cell_key:
                    source = by_cell_key[pair(source_raw)]
                if pair(target_raw) in by_cell_key:
                    target = by_cell_key[pair(target_raw)]
                normalized = dict(edge)
                normalized.update({"from": source, "to": target, "_index": index})
                edges.append(normalized)
            elif isinstance(edge, (list, tuple)) and len(edge) >= 2:
                edges.append({"from": _node_key(edge[0]), "to": _node_key(edge[1]), "_index": index})
    adjacency = graph.get("adjacency") if isinstance(graph, dict) else None
    if not edges and isinstance(adjacency, dict):
        for source_raw, targets in adjacency.items():
            if not isinstance(targets, list):
                continue
            for target_raw in targets:
                edges.append({"from": _node_key(source_raw), "to": _node_key(target_raw), "kind": "adjacency"})
    return nodes, edges


def validate_hydrology(
    state: ValidationState,
    hydrology: dict[str, Any],
    world_bounds: tuple[tuple[int, int], tuple[int, int]] | None,
    chunk_ids: set[str],
) -> None:
    state.check("hydrology.schema", hydrology.get("schema") == HYDROLOGY_SCHEMA, hydrology.get("schema"))
    state.check("hydrology.status", hydrology.get("status") in {"PASS", "PASS_PENDING_INDEPENDENT_QA", "GENERATED"}, hydrology.get("status"))
    water_cells_raw = hydrology.get("water_cells")
    state.check("hydrology.water_cells_is_list", isinstance(water_cells_raw, list) and bool(water_cells_raw), type(water_cells_raw).__name__)
    water_cells = [record for record in water_cells_raw or [] if isinstance(record, dict)]
    seen_cells: set[tuple[int, int]] = set()
    for index, record in enumerate(water_cells):
        cell = pair(record.get("cell"))
        label = f"hydrology.water_cell.{index}"
        state.check(f"{label}.cell", cell is not None and cell not in seen_cells, cell)
        if cell is not None:
            seen_cells.add(cell)
            if world_bounds is not None:
                state.check(f"{label}.within_world", within((cell, cell), world_bounds), cell)
        for key in ("watershed", "channel", "kind", "chunk_id"):
            state.check(f"{label}.{key}", isinstance(record.get(key), str) and bool(record.get(key)), record.get(key))
        if chunk_ids:
            state.check(f"{label}.chunk_binding", record.get("chunk_id") in chunk_ids, record.get("chunk_id"))
        level = record.get("level")
        water_z = record.get("water_z_m")
        bed_z = record.get("bed_z_m")
        speed = record.get("speed_mps")
        state.check(f"{label}.level", isinstance(level, int) and 0 <= level <= 8, level)
        state.check(f"{label}.water_bed", is_number(water_z) and is_number(bed_z) and float(bed_z) < float(water_z), f"bed={bed_z} water={water_z}")
        state.check(f"{label}.speed", is_number(speed) and 0 <= float(speed) <= 5.0, speed)
        width_cells = record.get("width_cells")
        state.check(f"{label}.width_cells", is_number(width_cells) and 0 < float(width_cells) <= 4, width_cells)
        vector = pair(record.get("flow_vector"), integers=False)
        kind = str(record.get("kind", "")).lower()
        vector_optional = any(token in kind for token in ("basin", "pond"))
        state.check(f"{label}.flow_vector", vector is not None and (vector_optional or math.hypot(*vector) > 1e-6), vector)
        distance = record.get("flow_distance_m")
        state.check(f"{label}.flow_distance", is_number(distance) and float(distance) >= 0, distance)
        if isinstance(level, int) and is_number(water_z):
            expected = 0.62 + level
            if not any(token in kind for token in ("rapid", "waterfall", "mouth", "ocean", "headwork", "canal")):
                state.check(f"{label}.water_level_formula", abs(float(water_z) - expected) <= 0.005, f"actual={water_z} expected={expected}")

    nodes, edges = extract_graph(hydrology, water_cells)
    state.check("hydrology.graph.nodes", bool(nodes), len(nodes))
    state.check("hydrology.graph.edges", bool(edges), len(edges))
    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming: dict[str, list[str]] = defaultdict(list)
    edge_pairs: set[tuple[str, str]] = set()

    def node_cell(node: dict[str, Any]) -> tuple[int, int] | None:
        return pair(node.get("cell"))

    def node_height(node: dict[str, Any]) -> float | None:
        value = node.get("water_z_m", node.get("z_m"))
        return float(value) if is_number(value) else None

    for index, edge in enumerate(edges):
        source, target = edge.get("from"), edge.get("to")
        label = f"hydrology.edge.{index}"
        valid_endpoints = isinstance(source, str) and isinstance(target, str) and source in nodes and target in nodes and source != target
        state.check(f"{label}.reciprocal_endpoints", valid_endpoints, f"{source}->{target}")
        if not valid_endpoints:
            continue
        state.check(f"{label}.unique", (source, target) not in edge_pairs, f"{source}->{target}")
        edge_pairs.add((source, target))
        outgoing[source].append(target)
        incoming[target].append(source)
        source_cell, target_cell = node_cell(nodes[source]), node_cell(nodes[target])
        if source_cell is not None and target_cell is not None:
            manhattan = abs(source_cell[0] - target_cell[0]) + abs(source_cell[1] - target_cell[1])
            state.check(f"{label}.cardinal_adjacency", manhattan == 1, f"{source_cell}->{target_cell} distance={manhattan}")
        source_z, target_z = node_height(nodes[source]), node_height(nodes[target])
        edge_kind = " ".join(str(edge.get(key, "")) for key in ("kind", "tile_id", "marker")).lower()
        if source_z is not None and target_z is not None:
            actual_drop = source_z - target_z
            declared_drop = edge.get("drop_m")
            if is_number(declared_drop):
                state.check(f"{label}.declared_drop", abs(float(declared_drop) - actual_drop) <= 0.02, f"declared={declared_drop} actual={actual_drop}")
            is_headworks = any(token in edge_kind for token in ("headwork", "pump", "t74"))
            state.check(f"{label}.downhill", target_z <= source_z + (0.061 if is_headworks else 0.005), f"{source_z}->{target_z} kind={edge_kind}")
            if actual_drop > 0.25:
                marked = any(token in edge_kind for token in ("waterfall", "rapid", "mouth", "t70", "t71", "t73"))
                state.check(f"{label}.drop_marked", marked, f"drop={actual_drop} kind={edge_kind}")
            if any(token in edge_kind for token in ("waterfall", "t71")):
                state.check(f"{label}.waterfall_exact_drop", abs(actual_drop - 1.0) <= 0.05, actual_drop)
            if any(token in edge_kind for token in ("rapid", "t70")):
                state.check(f"{label}.rapid_exact_drop", abs(actual_drop - 1.0) <= 0.05, actual_drop)

    # Directed acyclic graph check.
    indegree = {node_id: len(incoming[node_id]) for node_id in nodes}
    queue = deque(node_id for node_id, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        node_id = queue.popleft()
        visited += 1
        for target in outgoing[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    state.check("hydrology.graph.acyclic", visited == len(nodes), f"visited={visited} nodes={len(nodes)}")

    def kind_for(node_id: str) -> str:
        record = nodes[node_id]
        return " ".join(str(record.get(key, "")) for key in ("kind", "hydrology_role", "tile_id")).lower()

    sources = {node_id for node_id in nodes if not incoming[node_id] or "source" in kind_for(node_id) or "t67" in kind_for(node_id)}
    mouths = {node_id for node_id in nodes if any(token in kind_for(node_id) for token in ("mouth", "ocean", "t73"))}
    headworks = {node_id for node_id in nodes if any(token in kind_for(node_id) for token in ("headwork", "canal", "t74"))}
    closed_basins = {node_id for node_id in nodes if any(token in kind_for(node_id) for token in ("closed_basin", "end_basin", "t69"))}
    terminals = {node_id for node_id in nodes if not outgoing[node_id]}
    state.check("hydrology.graph.sources", bool(sources), sorted(sources)[:10])
    state.check("hydrology.graph.mouths", bool(mouths), sorted(mouths)[:10])
    state.check("hydrology.graph.legal_terminals", terminals <= mouths | headworks | closed_basins, f"illegal={sorted(terminals - mouths - headworks - closed_basins)[:20]}")

    source_reaches_mouth = 0
    for source in sorted(sources):
        reachable: set[str] = set()
        stack = [source]
        while stack:
            node_id = stack.pop()
            if node_id in reachable:
                continue
            reachable.add(node_id)
            stack.extend(outgoing[node_id])
        reaches_legal = bool(reachable & (mouths | headworks | closed_basins))
        reaches_mouth = bool(reachable & mouths)
        source_reaches_mouth += int(reaches_mouth)
        state.check(f"hydrology.source.{source}.reaches_legal_terminal", reaches_legal, sorted(reachable & terminals))
    state.check("hydrology.graph.source_to_mouth_path", source_reaches_mouth >= 1, f"{source_reaches_mouth}/{len(sources)} sources")

    shader = hydrology.get("flow_shader_contract")
    state.check("hydrology.flow_shader_contract", isinstance(shader, dict) and bool(shader), shader)


IMMUTABLE_BUILDING_FIELDS = (
    "id",
    "key",
    "anchor_cell_sw",
    "footprint_tiles",
    "occupied_bounds_cells",
    "rotation_degrees",
    "owner_type",
    "ownership",
    "player_buildable",
    "yield_bearing",
    "customer_socket_cell",
    "service_socket_cell",
    "utility_node_cell",
    "source_front_axis",
    "source_yaw_correction_degrees",
    "source_sha256",
    "runtime_sha256",
)

IMMUTABLE_PLOT_FIELDS = (
    "id",
    "anchor_cell_sw",
    "footprint_tiles",
    "occupied_bounds_cells",
    "customer_edge",
    "service_edge",
    "utility_connection_cell",
    "surface_tile",
    "border_tiles",
    "entrance_tile",
    "utility_verge_tile",
    "owner_type",
    "ownership",
    "status",
    "purchasable",
    "leaseable",
    "structures",
)


def validate_city_and_plots(
    state: ValidationState,
    manifest: dict[str, Any],
    layout: dict[str, Any],
    baseline_layout: dict[str, Any],
    world_bounds: tuple[tuple[int, int], tuple[int, int]] | None,
) -> None:
    baseline_buildings = records_by_id(baseline_layout.get("buildings"))
    expanded_buildings = records_by_id(layout.get("buildings"))
    manifest_buildings = records_by_id(manifest.get("buildings"))
    state.check("city.baseline_building_ids", set(baseline_buildings) == set(EXPECTED_BUILDING_IDS), sorted(baseline_buildings))
    state.check("city.layout_building_ids", set(expanded_buildings) == set(EXPECTED_BUILDING_IDS), sorted(expanded_buildings))
    state.check("city.manifest_building_ids", set(manifest_buildings) == set(EXPECTED_BUILDING_IDS), sorted(manifest_buildings))
    for building_id in EXPECTED_BUILDING_IDS:
        baseline = baseline_buildings.get(building_id, {})
        expanded = expanded_buildings.get(building_id, {})
        manifest_record = manifest_buildings.get(building_id, {})
        for field_name in IMMUTABLE_BUILDING_FIELDS:
            state.check(f"city.{building_id}.{field_name}.unchanged", expanded.get(field_name) == baseline.get(field_name), f"expanded={expanded.get(field_name)!r} baseline={baseline.get(field_name)!r}")
        state.check(f"city.{building_id}.manifest_binding", manifest_record.get("key") == baseline.get("key") and manifest_record.get("anchor_cell_sw") == baseline.get("anchor_cell_sw"), manifest_record)
        ownership = str(expanded.get("owner_type", expanded.get("ownership", ""))).lower()
        state.check(f"city.{building_id}.government_owned", ownership == "government" and expanded.get("player_buildable") is False, ownership)

    baseline_plots = records_by_id(baseline_layout.get("plots"))
    layout_plots = records_by_id(flatten_plot_records(layout.get("plots")))
    manifest_plot_object = manifest.get("plots")
    manifest_plots = records_by_id(flatten_plot_records(manifest_plot_object))
    original_ids = set(baseline_plots)
    state.check("plots.baseline_original_count", len(original_ids) == EXPECTED_ORIGINAL_PLOT_COUNT, len(original_ids))
    state.check("plots.layout_total_count", len(layout_plots) == EXPECTED_TOTAL_PLOT_COUNT, len(layout_plots))
    state.check("plots.manifest_total_count", len(manifest_plots) == EXPECTED_TOTAL_PLOT_COUNT, len(manifest_plots))
    state.check("plots.layout_preserves_original_ids", original_ids <= set(layout_plots), sorted(original_ids - set(layout_plots)))
    state.check("plots.manifest_preserves_original_ids", original_ids <= set(manifest_plots), sorted(original_ids - set(manifest_plots)))

    for plot_id, baseline in baseline_plots.items():
        expanded = layout_plots.get(plot_id, {})
        for field_name in IMMUTABLE_PLOT_FIELDS:
            state.check(f"plots.{plot_id}.{field_name}.unchanged", expanded.get(field_name) == baseline.get(field_name), f"expanded={expanded.get(field_name)!r} baseline={baseline.get(field_name)!r}")

    added_ids = set(layout_plots) - original_ids
    manifest_added_ids = set(manifest_plots) - original_ids
    state.check("plots.layout_added_exactly_24", len(added_ids) == EXPECTED_ADDED_PLOT_COUNT, sorted(added_ids))
    state.check("plots.manifest_added_exactly_24", len(manifest_added_ids) == EXPECTED_ADDED_PLOT_COUNT and manifest_added_ids == added_ids, sorted(manifest_added_ids))
    if isinstance(manifest_plot_object, dict):
        state.check("plots.manifest_total_empty", manifest_plot_object.get("total_empty") == EXPECTED_TOTAL_PLOT_COUNT, manifest_plot_object.get("total_empty"))
        state.check("plots.manifest_player_owned_buildings", manifest_plot_object.get("player_owned_buildings") == 0, manifest_plot_object.get("player_owned_buildings"))

    plot_rects: dict[str, tuple[tuple[int, int], tuple[int, int]]] = {}
    for plot_id, plot in layout_plots.items():
        ownership = str(plot.get("owner_type", plot.get("ownership", ""))).lower()
        state.check(f"plot.{plot_id}.unowned", ownership == "unowned", ownership)
        state.check(f"plot.{plot_id}.available", plot.get("status") == "available" and plot.get("purchasable") is True and plot.get("leaseable") is True, f"status={plot.get('status')} purchase={plot.get('purchasable')} lease={plot.get('leaseable')}")
        state.check(f"plot.{plot_id}.empty", plot.get("structures") == [], plot.get("structures"))
        rect = rect_from_record(plot)
        state.check(f"plot.{plot_id}.bounds", rect is not None, rect)
        if rect is not None:
            plot_rects[plot_id] = rect
            if world_bounds is not None:
                state.check(f"plot.{plot_id}.within_world", within(rect, world_bounds), rect)
    plot_ids = sorted(plot_rects)
    overlaps: list[tuple[str, str]] = []
    for index, a_id in enumerate(plot_ids):
        for b_id in plot_ids[index + 1 :]:
            if rectangles_overlap(plot_rects[a_id], plot_rects[b_id]):
                overlaps.append((a_id, b_id))
    state.check("plots.no_overlap", not overlaps, overlaps[:20])

    building_rects = {building_id: rect_from_record(record) for building_id, record in expanded_buildings.items()}
    plot_building_overlap = [
        (plot_id, building_id)
        for plot_id, plot_rect in plot_rects.items()
        for building_id, building_rect in building_rects.items()
        if building_rect is not None and rectangles_overlap(plot_rect, building_rect)
    ]
    state.check("plots.no_building_overlap", not plot_building_overlap, plot_building_overlap[:20])

    for building_id, building in expanded_buildings.items():
        ownership = str(building.get("owner_type", building.get("ownership", ""))).lower()
        player_owned = ownership == "player" or building.get("player_owned") is True or building.get("player_buildable") is True
        state.check(f"buildings.{building_id}.not_player_owned", not player_owned, ownership)
    state.check("runtime.no_player_owned_buildings", manifest.get("plots", {}).get("player_owned_buildings", 0) == 0 and layout.get("streaming", {}).get("player_owned_buildings", 0) == 0, "manifest/layout counters")


def validate_required_files(state: ValidationState, package: Path, spec: dict[str, Any], chunks: dict[str, dict[str, Any]]) -> set[str]:
    required = set(REQUIRED_STATIC_FILES)
    for tile in spec.get("new_tiles", []):
        tile_id, key = tile.get("id"), tile.get("key")
        required.add(f"tiles/{tile_id}_{key}.glb")
        required.add(f"previews/{tile_id}_{key}.png")
    for chunk in chunks.values():
        glb = _record_path(chunk, "glb")
        if glb:
            required.add(glb)
    for rel in sorted(required):
        state.check(f"file.exists.{rel}", (package / rel).is_file(), rel)
    return required


def validate_artifact_hash_records(state: ValidationState, package: Path, manifest: dict[str, Any]) -> int:
    checked = 0
    for value in recursively_yield(manifest.get("artifacts")):
        if not isinstance(value, dict):
            continue
        rel = value.get("file") or value.get("path")
        digest = value.get("sha256")
        if not isinstance(rel, str) or not isinstance(digest, str):
            continue
        checked += 1
        path = package / rel
        state.check(f"artifact_hash.{checked}.exists", path.is_file(), rel)
        state.check(f"artifact_hash.{checked}.syntax", bool(SHA256_RE.fullmatch(digest.lower())), digest)
        if path.is_file() and SHA256_RE.fullmatch(digest.lower()):
            state.check(f"artifact_hash.{checked}.matches", sha256(path) == digest.lower(), rel)
    state.check("artifact_hash.records_present", checked >= 5, checked)
    return checked


def validate_checksums(state: ValidationState, package: Path, required: set[str]) -> dict[str, str]:
    checksum_path = package / "checksums.sha256"
    state.check("checksums.exists", checksum_path.is_file(), checksum_path)
    if not checksum_path.is_file():
        return {}
    try:
        records = parse_checksum_file(checksum_path)
    except Exception as exc:
        state.check("checksums.parse", False, exc)
        return {}
    state.check("checksums.parse", True, len(records))
    for rel in sorted(required - {"checksums.sha256"}):
        state.check(f"checksums.listed.{rel}", rel in records, rel)
    for rel, expected in records.items():
        pure = PurePosixPath(rel)
        safe = not pure.is_absolute() and ".." not in pure.parts
        state.check(f"checksums.safe_path.{rel}", safe, rel)
        if not safe:
            continue
        path = package / rel
        state.check(f"checksums.file_exists.{rel}", path.is_file(), rel)
        if path.is_file():
            state.check(f"checksums.hash.{rel}", sha256(path) == expected, rel)
    return records


def validate_zip(state: ValidationState, package: Path, zip_path: Path) -> None:
    state.check("zip.exists", zip_path.is_file(), zip_path)
    if not zip_path.is_file():
        return
    try:
        with zipfile.ZipFile(zip_path) as archive:
            bad_member = archive.testzip()
            state.check("zip.crc", bad_member is None, bad_member)
            members: dict[str, zipfile.ZipInfo] = {}
            unsafe: list[str] = []
            for info in archive.infolist():
                if info.is_dir():
                    continue
                pure = PurePosixPath(info.filename)
                if pure.is_absolute() or ".." in pure.parts:
                    unsafe.append(info.filename)
                    continue
                parts = list(pure.parts)
                if parts and parts[0] == PACKAGE_NAME:
                    parts = parts[1:]
                rel = PurePosixPath(*parts).as_posix()
                if rel:
                    members[rel] = info
            state.check("zip.safe_paths", not unsafe, unsafe[:10])
            ignored = {"qa-report.json", ".DS_Store"}
            disk_files = {
                path.relative_to(package).as_posix()
                for path in package.rglob("*")
                if path.is_file() and path.relative_to(package).as_posix() not in ignored and path.name != ".DS_Store"
            }
            zip_files = {rel for rel in members if rel not in ignored and not rel.endswith("/.DS_Store")}
            state.check("zip.file_parity", disk_files == zip_files, f"missing={sorted(disk_files-zip_files)[:10]} extra={sorted(zip_files-disk_files)[:10]}")
            for rel in sorted(disk_files & zip_files):
                with archive.open(members[rel]) as handle:
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                state.check(f"zip.parity.{rel}", digest.hexdigest() == sha256(package / rel), rel)
    except Exception as exc:
        state.check("zip.open", False, exc)


def validate_json_safety(state: ValidationState, *documents: dict[str, Any]) -> None:
    # Scan content values rather than serialized object keys.  The generated
    # contract intentionally contains the counter key `player_owned_buildings`
    # (which must equal zero); matching that required key would make every
    # otherwise valid package fail this node/content safety gate.
    def string_values(value: Any) -> Iterator[str]:
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for child in value.values():
                yield from string_values(child)
        elif isinstance(value, (list, tuple)):
            for child in value:
                yield from string_values(child)

    text = "\n".join(
        item
        for document in documents
        for item in string_values(document)
    )
    state.check("content.no_player_business_nodes", not PLAYER_BUILDING_RE.search(text), "manifest/layout/hydrology")


def main() -> int:
    args = parse_args()
    workspace = args.workspace.resolve()
    package = (args.package or (workspace / "outputs" / PACKAGE_NAME)).resolve()
    report_path = (args.report or (package / "qa-report.json")).resolve()
    zip_path = (args.zip_path or package.with_suffix(".zip")).resolve()
    state = ValidationState()

    manifest_path = package / "manifest.json"
    layout_path = package / "layout.json"
    hydrology_path = package / "hydrology.json"
    source_lock_path = package / "source-lock.json"
    terrain_grid_path = package / "terrain-grid.json"
    generator_qa_path = package / "qa-report-generator.json"
    spec_path = workspace / SPEC_REL
    city_layout_path = workspace / BASE_CITY_LAYOUT_REL
    city_manifest_path = workspace / BASE_CITY_MANIFEST_REL
    v5_manifest_path = workspace / V5_MANIFEST_REL

    prerequisite_paths = {
        "package": package,
        "manifest": manifest_path,
        "layout": layout_path,
        "hydrology": hydrology_path,
        "source_lock": source_lock_path,
        "terrain_grid": terrain_grid_path,
        "generator_qa": generator_qa_path,
        "spec": spec_path,
        "city_layout": city_layout_path,
        "city_manifest": city_manifest_path,
        "v5_manifest": v5_manifest_path,
    }
    for label, path in prerequisite_paths.items():
        state.check(f"prerequisite.{label}", path.is_dir() if label == "package" else path.is_file(), path)
    if state.errors:
        report = {
            "schema": "markets-and-makers.highlands-rivers-world.independent-qa.v1",
            "status": "FAIL",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "package": str(package),
            "summary": {"checks": len(state.checks), "passed": sum(check["passed"] for check in state.checks), "errors": len(state.errors), "warnings": len(state.warnings)},
            "errors": state.errors,
            "warnings": state.warnings,
            "checks": state.checks,
        }
        write_report(report_path, report)
        print(json.dumps(report["summary"], indent=2))
        return 1

    try:
        manifest = load_object(manifest_path)
        layout = load_object(layout_path)
        hydrology = load_object(hydrology_path)
        source_lock = load_object(source_lock_path)
        terrain_grid = load_object(terrain_grid_path)
        generator_qa = load_object(generator_qa_path)
        spec = load_object(spec_path)
        baseline_layout = load_object(city_layout_path)
    except Exception as exc:
        state.check("json.load", False, exc)
        manifest = layout = hydrology = source_lock = terrain_grid = generator_qa = spec = baseline_layout = {}

    state.check("schema.manifest", manifest.get("schema") == MANIFEST_SCHEMA, manifest.get("schema"))
    state.check("schema.layout", layout.get("schema") == LAYOUT_SCHEMA, layout.get("schema"))
    state.check("schema.spec", spec.get("schema") == SPEC_SCHEMA, spec.get("schema"))
    state.check("status.manifest", manifest.get("status") in {"PASS", "PASS_PENDING_INDEPENDENT_QA"}, manifest.get("status"))
    state.check("status.layout", layout.get("status") in {"PASS", "PASS_PENDING_INDEPENDENT_QA", "GENERATED"}, layout.get("status"))
    state.check("status.generator_qa", generator_qa.get("status") == "PASS", generator_qa.get("status"))
    state.check("terrain_grid.object", isinstance(terrain_grid, dict) and bool(terrain_grid), list(terrain_grid)[:10])

    validate_source_locks(state, workspace, package, manifest, source_lock, spec_path, city_layout_path, city_manifest_path, v5_manifest_path)
    validate_world_contract(state, manifest, layout, spec, spec_path, city_layout_path)
    validate_blend_source(state, package)
    generated_tiles, inspected_tiles = validate_tile_contract(state, package, spec, manifest, args.max_triangles_per_glb)
    spec_tiles = records_by_id(spec.get("new_tiles"))
    world_glbs = validate_combined_and_world_glbs(state, package, spec_tiles, args.max_triangles_per_glb)
    validate_previews(state, package)
    chunks, world_bounds = validate_chunks(state, package, manifest, layout, args.max_triangles_per_glb)
    validate_hydrology(state, hydrology, world_bounds, set(chunks))
    validate_city_and_plots(state, manifest, layout, baseline_layout, world_bounds)
    validate_json_safety(state, manifest, layout, hydrology, terrain_grid)
    required = validate_required_files(state, package, spec, chunks)
    validate_artifact_hash_records(state, package, manifest)
    checksums = validate_checksums(state, package, required)
    if not args.skip_zip and zip_path.is_file():
        validate_zip(state, package, zip_path)
    elif not args.skip_zip:
        state.warn("zip.optional", True, f"not present: {zip_path}")

    report = {
        "schema": "markets-and-makers.highlands-rivers-world.independent-qa.v1",
        "status": "PASS" if not state.errors else "FAIL",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "package": str(package),
        "bindings": {
            "expansion_spec": {"file": str(spec_path), "sha256": sha256(spec_path)},
            "government_city_layout": {"file": str(city_layout_path), "sha256": sha256(city_layout_path)},
            "government_city_manifest": {"file": str(city_manifest_path), "sha256": sha256(city_manifest_path)},
            "v5_tile_manifest": {"file": str(v5_manifest_path), "sha256": sha256(v5_manifest_path)},
        },
        "inventory": {
            "new_tile_records": len(generated_tiles),
            "inspected_tile_glbs": len(inspected_tiles),
            "chunk_records": len(chunks),
            "checksummed_files": len(checksums),
            "world_glbs": {key: {field: value[field] for field in ("bytes", "sha256", "vertices", "triangles", "primitives")} for key, value in world_glbs.items()},
        },
        "summary": {
            "checks": len(state.checks),
            "passed": sum(1 for check in state.checks if check["passed"]),
            "errors": len(state.errors),
            "warnings": len(state.warnings),
        },
        "errors": state.errors,
        "warnings": state.warnings,
        "assets": state.assets,
        "checks": state.checks,
    }
    write_report(report_path, report)
    print(json.dumps(report["summary"], indent=2))
    if state.errors:
        for error in state.errors[:50]:
            print(f"ERROR: {error}", file=sys.stderr)
        if len(state.errors) > 50:
            print(f"ERROR: ... {len(state.errors) - 50} more", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
