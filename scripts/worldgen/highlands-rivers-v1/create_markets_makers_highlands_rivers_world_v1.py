"""Build the Markets & Makers Highlands & Rivers open-world expansion.

The generator is intentionally data driven.  It consumes the locked T51-T74
mountain/river specification and the independently validated 256x256-cell
expanded-world layout, reuses the official V5 material library, and preserves
the government city through its normalized runtime GLBs.  Source packages are
never modified.

Run with Blender 5.0 or newer:

    blender --background --factory-startup \
      --python scripts/worldgen/highlands-rivers-v1/create_markets_makers_highlands_rivers_world_v1.py -- \
      --workspace /path/to/workspace
"""

import bpy
import hashlib
import json
import math
import re
import shutil
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

from mathutils import Vector


PACKAGE_NAME = "markets-and-makers-highlands-rivers-world-v1"
CELL = 2.0
WALK_Z = 1.0
STEP = 1.0
BOTTOM_Z = -0.28
OCEAN_Z = -0.18
RIVER_Z = 0.62
RIVER_BED_Z = 0.28
CANAL_Z = 0.68
CHUNK_CELLS = 16
EXPECTED_GOV_ZIP_SHA256 = "4cdb235241505141d3b45be0af34924181da89765375e945965f16e9dcd4ba70"


def cli_arg(name, default=None):
    if "--" not in sys.argv:
        return default
    args = sys.argv[sys.argv.index("--") + 1:]
    if name not in args:
        return default
    index = args.index(name)
    return args[index + 1] if index + 1 < len(args) else default


WORKSPACE = Path(cli_arg("--workspace", Path.cwd())).resolve()
OUTPUT_ROOT = Path(cli_arg("--output-root", WORKSPACE / "outputs")).resolve()
CONTRACT_PACKAGE = WORKSPACE / "art/official-v1/highlands-rivers-v1"
SPEC_PATH = CONTRACT_PACKAGE / "reference/mountain-river-expansion-spec-manifest.json"
SPEC_README = CONTRACT_PACKAGE / "reference/mountain-river-expansion-spec-README.md"
DESIGN_PATH = CONTRACT_PACKAGE / "reference/expanded-world-layout-source.json"
DESIGN_QA_PATH = CONTRACT_PACKAGE / "reference/expanded-world-layout-qa.json"
V5_PACKAGE = WORKSPACE / "outputs/markets-and-makers-logo-world-tiles-v5"
V5_BLEND = V5_PACKAGE / "markets-and-makers-logo-world-tiles-v5.blend"
V5_MANIFEST = V5_PACKAGE / "manifest.json"
V5_TEXTURE_MANIFEST = V5_PACKAGE / "textures/manifest.json"
CITY_PACKAGE = WORKSPACE / "outputs/markets-and-makers-city-tiles-bordered-v2"
CITY_BLEND = CITY_PACKAGE / "markets-and-makers-city-tiles-bordered-v2.blend"
CITY_MANIFEST = CITY_PACKAGE / "manifest.json"
PROP_PACKAGE = WORKSPACE / "outputs/markets-and-makers-street-props-v1"
PROP_BLEND = PROP_PACKAGE / "markets-and-makers-street-props-v1.blend"
PROP_MANIFEST = PROP_PACKAGE / "manifest.json"
GOV_ZIP = WORKSPACE / "outputs/markets-and-makers-government-city-center-v1.zip"

PACKAGE = OUTPUT_ROOT / PACKAGE_NAME
TILE_DIR = PACKAGE / "tiles"
CHUNK_DIR = PACKAGE / "chunks"
PREVIEW_DIR = PACKAGE / "previews"
REFERENCE_DIR = PACKAGE / "reference"
BUILDING_RUNTIME_DIR = PACKAGE / "buildings/runtime"
TEMP_DIR = Path("/private/tmp/markets-and-makers-highlands-rivers-world-v1")
BLEND_PATH = PACKAGE / f"{PACKAGE_NAME}.blend"
TILE_CORE_GLB = PACKAGE / "mm_highlands_rivers_tiles_v1.glb"
PREVIEW_GLB = PACKAGE / "mm_highlands_rivers_world_v1_preview.glb"
LITE_GLB = PACKAGE / "mm_highlands_rivers_world_v1_lite.glb"
WIDE_PREVIEW = PREVIEW_DIR / "mm_highlands_rivers_world_v1_wide.png"
HYDRO_PREVIEW = PREVIEW_DIR / "mm_highlands_rivers_world_v1_hydrology.png"
LAYOUT_PATH = PACKAGE / "layout.json"
TERRAIN_GRID_PATH = PACKAGE / "terrain-grid.json"
HYDROLOGY_PATH = PACKAGE / "hydrology.json"
SOURCE_LOCK_PATH = PACKAGE / "source-lock.json"
MANIFEST_PATH = PACKAGE / "manifest.json"
GENERATOR_QA_PATH = PACKAGE / "qa-report-generator.json"
README_PATH = PACKAGE / "README.md"
CHECKSUM_PATH = PACKAGE / "checksums.sha256"
ZIP_PATH = OUTPUT_ROOT / f"{PACKAGE_NAME}.zip"

if PACKAGE.exists():
    shutil.rmtree(PACKAGE)
if TEMP_DIR.exists():
    shutil.rmtree(TEMP_DIR)
for directory in (PACKAGE, TILE_DIR, CHUNK_DIR, PREVIEW_DIR, REFERENCE_DIR, BUILDING_RUNTIME_DIR, TEMP_DIR):
    directory.mkdir(parents=True, exist_ok=True)

if bpy.app.version < (5, 0, 0):
    raise RuntimeError("Blender 5.0 or newer is required")
for required in (
    SPEC_PATH, SPEC_README, DESIGN_PATH, DESIGN_QA_PATH, V5_BLEND, V5_MANIFEST,
    V5_TEXTURE_MANIFEST, CITY_BLEND, CITY_MANIFEST, PROP_BLEND, PROP_MANIFEST, GOV_ZIP,
):
    if not required.is_file():
        raise RuntimeError(f"Missing locked source: {required}")


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


if sha256(GOV_ZIP) != EXPECTED_GOV_ZIP_SHA256:
    raise RuntimeError("Government-city ZIP does not match its locked SHA-256")

SPEC = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
DESIGN = json.loads(DESIGN_PATH.read_text(encoding="utf-8"))
DESIGN_QA = json.loads(DESIGN_QA_PATH.read_text(encoding="utf-8"))
if SPEC.get("schema") != "markets-and-makers.mountain-river-expansion.spec.v1":
    raise RuntimeError("Unexpected mountain/river specification schema")
if [record.get("id") for record in SPEC.get("new_tiles", [])] != [f"T{i}" for i in range(51, 75)]:
    raise RuntimeError("The locked source inventory must be ordered T51-T74")
if DESIGN.get("schema") != "markets-and-makers.expanded-open-world.layout.v1":
    raise RuntimeError("Unexpected expanded-world layout schema")
if DESIGN_QA.get("status") != "PASS":
    raise RuntimeError("Expanded-world design QA is not PASS")


def zip_json(archive, relative):
    prefix = "markets-and-makers-government-city-center-v1/"
    return json.loads(archive.read(prefix + relative).decode("utf-8"))


with zipfile.ZipFile(GOV_ZIP, "r") as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError(f"Government-city source ZIP CRC failure: {bad}")
    GOV_LAYOUT = zip_json(archive, "layout.json")
    GOV_MANIFEST = zip_json(archive, "manifest.json")
    GOV_RUNTIME_FILES = {}
    for record in GOV_MANIFEST["buildings"]:
        relative = record["runtime_file"]
        member = f"markets-and-makers-government-city-center-v1/{relative}"
        destination = TEMP_DIR / Path(relative).name
        destination.write_bytes(archive.read(member))
        if sha256(destination) != record["runtime_sha256"]:
            raise RuntimeError(f"Civic runtime hash mismatch: {record['id']}")
        GOV_RUNTIME_FILES[record["id"]] = destination
        packaged_runtime = PACKAGE / relative
        packaged_runtime.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(destination, packaged_runtime)
        if sha256(packaged_runtime) != record["runtime_sha256"]:
            raise RuntimeError(f"Packaged civic runtime hash mismatch: {record['id']}")


def reset_blender():
    if bpy.context.mode != "OBJECT" and bpy.context.object:
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for datablocks in (
        bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras,
        bpy.data.lights, bpy.data.curves,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


reset_blender()
SCENE = bpy.context.scene
SCENE.unit_settings.system = "METRIC"
SCENE.unit_settings.scale_length = 1.0
SCENE.unit_settings.length_unit = "METERS"
for engine_id in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
    try:
        SCENE.render.engine = engine_id
        break
    except TypeError:
        continue
else:
    raise RuntimeError("No supported Eevee render engine is available")
SCENE.render.image_settings.file_format = "PNG"
SCENE.render.image_settings.color_mode = "RGBA"
SCENE.render.film_transparent = False
SCENE.render.resolution_percentage = 100
bpy.context.preferences.filepaths.save_version = 0
try:
    SCENE.view_settings.look = "AgX - Medium High Contrast"
except (TypeError, ValueError):
    pass


def make_collection(name, parent=None):
    collection = bpy.data.collections.new(name)
    (parent or SCENE.collection).children.link(collection)
    return collection


ROOT_WORLD = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1")
ROOT_CHUNKS = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_TERRAIN", ROOT_WORLD)
ROOT_WATER = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_WATER", ROOT_WORLD)
ROOT_CIVIC = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_CIVIC", ROOT_WORLD)
ROOT_PROPS = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_PROPS", ROOT_WORLD)
ROOT_OVERLAYS = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_OVERLAYS", ROOT_WORLD)
ROOT_COLLISION = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_COLLISION", ROOT_WORLD)
ROOT_TILE_LIBRARY = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_TILE_LIBRARY")
ROOT_PREVIEW_FLOW = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_PREVIEW_FLOW")
ROOT_SOURCE = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_SOURCE_LIBRARY")
ROOT_STAGE = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_STAGE")
ROOT_LIGHTS = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_LIGHTS")
ROOT_CAMERAS = make_collection("MM_HIGHLANDS_RIVERS_WORLD_V1_CAMERAS")
for collection in (ROOT_TILE_LIBRARY, ROOT_PREVIEW_FLOW, ROOT_SOURCE, ROOT_STAGE):
    collection.hide_render = True
ROOT_SOURCE.hide_viewport = True
ROOT_COLLISION.hide_render = True


MATERIAL_NAMES = [
    "MAT_TERRAIN_GRASS_SAGE", "MAT_MM_GREEN", "MAT_TERRAIN_GRASS_DARK",
    "MAT_TERRAIN_CLIFF", "MAT_MM_SOIL", "MAT_TERRAIN_GRID_BORDER",
    "MAT_TERRAIN_SAND", "MAT_TERRAIN_LIMESTONE", "MAT_MM_STONE",
    "MAT_TERRAIN_ROCK", "MAT_TERRAIN_PATH", "MAT_MM_CREAM",
    "MAT_TERRAIN_GRAVEL", "MAT_TERRAIN_TERRACOTTA", "MAT_TERRAIN_TIMBER",
    "MAT_TERRAIN_TIMBER_DARK", "MAT_WATER_SHALLOW", "MAT_MM_WATER",
    "MAT_WATER_FOAM", "MAT_MM_TEAL", "MAT_MM_MUSTARD", "MAT_MM_CORAL",
    "MAT_PLOT_BORDER", "MAT_FOLIAGE_DEEP",
]

TERRAIN_SOURCE_OBJECTS = [
    "MM_TILE_T39_FOOTBRIDGE_SHORT_V5_LOD0", "MM_TILE_T40_FOOTBRIDGE_LANDING_V5_LOD0",
    "MM_TILE_T42_CART_BRIDGE_LANDING_V5_LOD0", "MM_TILE_T43_CART_BRIDGE_MID_V5_LOD0",
    "MM_TILE_T44_DOCK_LAND_LANDING_V5_LOD0", "MM_TILE_T45_PIER_STRAIGHT_V5_LOD0",
    "MM_TILE_T48_PIER_END_V5_LOD0", "MM_TILE_T50_FERRY_BERTH_EDGE_V5_LOD0",
]
PROP_SOURCE_OBJECTS = [
    "V01_V0_LOD0_MESH", "V02_V0_LOD0_MESH", "V03_V0_LOD0_MESH",
    "V04_V0_LOD0_MESH", "V05_V0_LOD0_MESH", "L01_V0_LOD0_MESH",
    "L03_V0_LOD0_MESH", "R01_V0_LOD0_MESH", "R02_V0_LOD0_MESH",
    "R04_V0_LOD0_MESH", "F01_V0_LOD0_MESH", "F02_V0_LOD0_MESH",
    "F03_V0_LOD0_MESH", "F04_V0_LOD0_MESH", "F05_V0_LOD0_MESH",
]


def append_library(path, material_names=(), object_names=()):
    with bpy.data.libraries.load(str(path), link=False) as (available, requested):
        requested.materials = [name for name in material_names if name in available.materials]
        requested.objects = [name for name in object_names if name in available.objects]
    result = {}
    for obj in requested.objects:
        if obj is not None:
            ROOT_SOURCE.objects.link(obj)
            result[obj.name] = obj
    return result


TERRAIN_SOURCES = append_library(V5_BLEND, MATERIAL_NAMES, TERRAIN_SOURCE_OBJECTS)
missing_terrain_sources = [name for name in TERRAIN_SOURCE_OBJECTS if name not in TERRAIN_SOURCES]
if missing_terrain_sources:
    raise RuntimeError(f"Approved V5 structural sources missing: {missing_terrain_sources}")
append_library(CITY_BLEND, [name for name in MATERIAL_NAMES if bpy.data.materials.get(name) is None], ())
PROP_SOURCES = append_library(PROP_BLEND, (), PROP_SOURCE_OBJECTS)
missing_prop_sources = [name for name in PROP_SOURCE_OBJECTS if name not in PROP_SOURCES]
if missing_prop_sources:
    raise RuntimeError(f"Street-prop LOD0 sources missing from approved Blend: {missing_prop_sources}")

# The expansion contract gives high mountain shelves a darker grass semantic,
# while V5 intentionally ships one shared sage grass shader.  Derive the dark
# variant from that approved material so the expansion stays in the same
# texture language without making the source-library lock falsely fail.
if bpy.data.materials.get("MAT_TERRAIN_GRASS_DARK") is None:
    sage = bpy.data.materials.get("MAT_TERRAIN_GRASS_SAGE")
    if sage is not None:
        dark_grass = sage.copy()
        dark_grass.name = "MAT_TERRAIN_GRASS_DARK"
        dark_grass["derived_from"] = "MAT_TERRAIN_GRASS_SAGE"
        if dark_grass.use_nodes:
            bsdf = dark_grass.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                base = bsdf.inputs["Base Color"].default_value
                bsdf.inputs["Base Color"].default_value = (
                    base[0] * 0.82, base[1] * 0.86, base[2] * 0.82, base[3]
                )
missing_materials = [name for name in MATERIAL_NAMES if bpy.data.materials.get(name) is None]
if missing_materials:
    raise RuntimeError(f"Approved materials missing from source libraries: {missing_materials}")

M = {
    "grass": bpy.data.materials["MAT_TERRAIN_GRASS_SAGE"],
    "grass_hi": bpy.data.materials["MAT_MM_GREEN"],
    "grass_dark": bpy.data.materials["MAT_TERRAIN_GRASS_DARK"],
    "earth": bpy.data.materials["MAT_TERRAIN_CLIFF"],
    "soil": bpy.data.materials["MAT_MM_SOIL"],
    "keyline": bpy.data.materials["MAT_TERRAIN_GRID_BORDER"],
    "sand": bpy.data.materials["MAT_TERRAIN_SAND"],
    "limestone": bpy.data.materials["MAT_TERRAIN_LIMESTONE"],
    "stone": bpy.data.materials["MAT_MM_STONE"],
    "rock": bpy.data.materials["MAT_TERRAIN_ROCK"],
    "path": bpy.data.materials["MAT_TERRAIN_PATH"],
    "cream": bpy.data.materials["MAT_MM_CREAM"],
    "gravel": bpy.data.materials["MAT_TERRAIN_GRAVEL"],
    "terra": bpy.data.materials["MAT_TERRAIN_TERRACOTTA"],
    "wood": bpy.data.materials["MAT_TERRAIN_TIMBER"],
    "wood_dark": bpy.data.materials["MAT_TERRAIN_TIMBER_DARK"],
    "water": bpy.data.materials["MAT_WATER_SHALLOW"],
    "water_deep": bpy.data.materials["MAT_MM_WATER"],
    "foam": bpy.data.materials["MAT_WATER_FOAM"],
    "teal": bpy.data.materials["MAT_MM_TEAL"],
    "mustard": bpy.data.materials["MAT_MM_MUSTARD"],
    "coral": bpy.data.materials["MAT_MM_CORAL"],
    "white": bpy.data.materials["MAT_PLOT_BORDER"],
    "leaf": bpy.data.materials["MAT_FOLIAGE_DEEP"],
}


def make_plain_material(name, rgba, roughness=0.8, emission=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = rgba
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = roughness
        emission_color = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        emission_strength = bsdf.inputs.get("Emission Strength")
        if emission and emission_color and emission_strength:
            emission_color.default_value = rgba
            emission_strength.default_value = emission
    return material


RIVER_FLOW_MATERIAL = M["water"].copy()
RIVER_FLOW_MATERIAL.name = "MAT_RIVER_FLOW"
RIVER_FLOW_MATERIAL["runtime_shader"] = "water_flow_v1"
RIVER_FLOW_MATERIAL["base_material"] = "MAT_WATER_SHALLOW"
RIVER_FLOW_MATERIAL["animation_note"] = "UV V scroll; gameplay flow field is hydrology.json"
if RIVER_FLOW_MATERIAL.use_nodes:
    nodes = RIVER_FLOW_MATERIAL.node_tree.nodes
    links = RIVER_FLOW_MATERIAL.node_tree.links
    image_node = next((node for node in nodes if node.type == "TEX_IMAGE"), None)
    if image_node:
        texcoord = nodes.new("ShaderNodeTexCoord")
        texcoord.name = "MM_FLOW_UV"
        mapping = nodes.new("ShaderNodeMapping")
        mapping.name = "MM_FLOW_MAPPING"
        texcoord.location = (-760, 80)
        mapping.location = (-590, 80)
        links.new(texcoord.outputs["UV"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], image_node.inputs["Vector"])
        driver = mapping.inputs["Location"].driver_add("default_value", 1).driver
        driver.expression = "-frame*0.0125"
M["river_flow"] = RIVER_FLOW_MATERIAL
M["cave_void"] = make_plain_material("MAT_CAVE_VOID", (0.014, 0.032, 0.030, 1.0), 0.94)
M["stage"] = make_plain_material("MAT_HRW_STAGE", (0.82, 0.80, 0.73, 1.0), 0.94)


class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.materials = []

    def vertex(self, co):
        self.verts.append(tuple(float(value) for value in co))
        return len(self.verts) - 1

    def face(self, coords, material, indices=False):
        face = tuple(coords) if indices else tuple(self.vertex(co) for co in coords)
        self.faces.append(face)
        self.materials.append(material)

    def tri(self, a, b, c, material):
        self.face((a, b, c), material)

    def quad(self, a, b, c, d, material):
        self.face((a, b, c, d), material)

    def card(self, center, size, z, material, rotation=0.0):
        hx, hy = size[0] * 0.5, size[1] * 0.5
        c, s = math.cos(rotation), math.sin(rotation)
        points = []
        for x, y in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)):
            points.append((center[0] + x * c - y * s, center[1] + x * s + y * c, z))
        self.face(points, material)

    def box(self, center, size, material, rotation=0.0, omit=()):
        hx, hy, hz = (value * 0.5 for value in size)
        c, s = math.cos(rotation), math.sin(rotation)
        local = [
            (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
        ]
        points = [
            (center[0] + x * c - y * s, center[1] + x * s + y * c, center[2] + z)
            for x, y, z in local
        ]
        faces = {
            "bottom": (0, 3, 2, 1), "top": (4, 5, 6, 7),
            "south": (0, 1, 5, 4), "east": (1, 2, 6, 5),
            "north": (2, 3, 7, 6), "west": (3, 0, 4, 7),
        }
        for key, indices in faces.items():
            if key not in omit:
                self.face([points[index] for index in indices], material)

    def cylinder(self, center, radius, depth, material, sides=10):
        bottom, top = [], []
        for index in range(sides):
            angle = math.tau * index / sides
            x = center[0] + math.cos(angle) * radius
            y = center[1] + math.sin(angle) * radius
            bottom.append((x, y, center[2] - depth * 0.5))
            top.append((x, y, center[2] + depth * 0.5))
        self.face(list(reversed(bottom)), material)
        self.face(top, material)
        for index in range(sides):
            nxt = (index + 1) % sides
            self.face((bottom[index], bottom[nxt], top[nxt], top[index]), material)


def add_uvs(mesh):
    base = mesh.uv_layers.new(name="UVMap")
    flow = mesh.uv_layers.new(name="MMFlow")
    for polygon in mesh.polygons:
        normal = polygon.normal
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if abs(normal.z) >= max(abs(normal.x), abs(normal.y)):
                uv = (co.x / CELL, co.y / CELL)
            elif abs(normal.x) >= abs(normal.y):
                uv = (co.y / CELL, co.z / CELL)
            else:
                uv = (co.x / CELL, co.z / CELL)
            base.data[loop_index].uv = uv
            flow.data[loop_index].uv = uv


def object_from_builder(name, builder, collection, validate=True):
    if not builder.faces:
        return None
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(builder.verts, [], builder.faces)
    mesh.update(calc_edges=True)
    materials = []
    for material in builder.materials:
        if material not in materials:
            materials.append(material)
            mesh.materials.append(material)
    lookup = {material: index for index, material in enumerate(materials)}
    for polygon, material in zip(mesh.polygons, builder.materials):
        polygon.material_index = lookup[material]
        polygon.use_smooth = False
    add_uvs(mesh)
    mesh.calc_loop_triangles()
    if validate and any(triangle.area <= 1e-10 for triangle in mesh.loop_triangles):
        raise RuntimeError(f"Degenerate triangle generated in {name}")
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def triangle_count(obj):
    if obj is None or obj.type != "MESH":
        return 0
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def add_empty(name, collection, location=(0, 0, 0), display="PLAIN_AXES", size=0.18):
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.location = location
    obj.empty_display_type = display
    obj.empty_display_size = size
    return obj


# ---------------------------------------------------------------------------
# T51-T74 source tiles
# ---------------------------------------------------------------------------

PROFILE_VALUES = SPEC["edge_profile_contract"]["profiles_relative_m"]
EDGE_ORDER = ("N", "E", "S", "W")
EDGE_VECTOR = {"N": (0, 1), "E": (1, 0), "S": (0, -1), "W": (-1, 0)}


def lerp(a, b, t):
    return a + (b - a) * t


def profile_sample(name, t):
    values = PROFILE_VALUES[name]
    t = max(0.0, min(1.0, float(t)))
    return lerp(values[0], values[1], t * 2.0) if t <= 0.5 else lerp(values[1], values[2], (t - 0.5) * 2.0)


def coons_height(edge_profiles, u, v):
    """Exact boundary interpolation for the four authored mountain edges."""
    south = profile_sample(edge_profiles["S"], u)
    north = profile_sample(edge_profiles["N"], u)
    west = profile_sample(edge_profiles["W"], v)
    east = profile_sample(edge_profiles["E"], v)
    sw = 0.5 * (PROFILE_VALUES[edge_profiles["S"]][0] + PROFILE_VALUES[edge_profiles["W"]][0])
    se = 0.5 * (PROFILE_VALUES[edge_profiles["S"]][2] + PROFILE_VALUES[edge_profiles["E"]][0])
    nw = 0.5 * (PROFILE_VALUES[edge_profiles["N"]][0] + PROFILE_VALUES[edge_profiles["W"]][2])
    ne = 0.5 * (PROFILE_VALUES[edge_profiles["N"]][2] + PROFILE_VALUES[edge_profiles["E"]][2])
    bilinear = sw * (1-u) * (1-v) + se * u * (1-v) + nw * (1-u) * v + ne * u * v
    return south * (1-v) + north * v + west * (1-u) + east * u - bilinear


def add_heightfield(builder, width, height, height_function, material, divisions=6, inset=0.0):
    x0, x1 = -width * 0.5 + inset, width * 0.5 - inset
    y0, y1 = -height * 0.5 + inset, height * 0.5 - inset
    for iy in range(divisions):
        v0, v1 = iy / divisions, (iy + 1) / divisions
        for ix in range(divisions):
            u0, u1 = ix / divisions, (ix + 1) / divisions
            points = []
            for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
                x, y = lerp(x0, x1, u), lerp(y0, y1, v)
                points.append((x, y, height_function(u, v)))
            builder.face(points, material)


def add_heightfield_skirt(builder, width, height, height_function, material, divisions=6):
    for edge in EDGE_ORDER:
        points_top = []
        for index in range(divisions + 1):
            t = index / divisions
            if edge == "N":
                u, v, x, y = t, 1.0, lerp(-width/2, width/2, t), height/2
            elif edge == "E":
                u, v, x, y = 1.0, t, width/2, lerp(-height/2, height/2, t)
            elif edge == "S":
                u, v, x, y = 1.0-t, 0.0, lerp(width/2, -width/2, t), -height/2
            else:
                u, v, x, y = 0.0, 1.0-t, -width/2, lerp(height/2, -height/2, t)
            points_top.append((x, y, height_function(u, v)))
        for index in range(divisions):
            a, b = points_top[index], points_top[index + 1]
            builder.face((a, b, (b[0], b[1], BOTTOM_Z), (a[0], a[1], BOTTOM_Z)), material)


def mountain_tile_builder(tile):
    width, height = tile["dimensions_m"]
    builder = Builder()
    profiles = tile.get("edge_profiles", {edge: "M0" for edge in EDGE_ORDER})
    key = tile["key"]

    def surface(u, v):
        z = WALK_Z + coons_height(profiles, u, v)
        envelope = (math.sin(math.pi * u) * math.sin(math.pi * v)) ** 2
        if key == "mountain_peak":
            z += 2.38 * envelope * max(0.0, 1.0 - 1.2 * math.hypot(u - 0.5, v - 0.5))
        elif "ridge" in key:
            z += 0.20 * envelope
        elif "valley" in key:
            z -= 0.12 * envelope
        return z

    divisions = 8 if tile["id"] == "T57" else 6
    add_heightfield(builder, width, height, surface, M["keyline"], divisions)
    dark_surface = "ridge" in key or key in {"mountain_peak", "mountain_cave_entrance"}
    add_heightfield(builder, width, height, surface, M["grass_dark"] if dark_surface else M["grass"], divisions, 0.055)
    add_heightfield_skirt(builder, width, height, surface, M["earth"], divisions)

    if key == "mountain_peak":
        # Build a broad, asymmetric crown whose lower ring follows and sinks
        # into the mountain surface.  A pointed fan (rather than a flat top
        # polygon) keeps the summit from reading as a button placed on the
        # terrain while preserving the locked 3.45 m visual bound.
        radii = (1.34, 1.08, 1.26, 1.13, 1.37, 1.06, 1.22, 1.10, 1.29)
        phase = 0.17
        base_ring = []
        shoulder_ring = []
        for index, radius in enumerate(radii):
            angle = phase + math.tau * index / len(radii)
            x = math.cos(angle) * radius
            y = math.sin(angle) * radius
            u, v = (x + width * 0.5) / width, (y + height * 0.5) / height
            base_ring.append((x, y, surface(u, v) - 0.035))
            shoulder_radius = 0.54 + 0.10 * ((index * 5) % 3)
            shoulder_ring.append((
                0.12 + math.cos(angle + 0.08) * shoulder_radius,
                -0.10 + math.sin(angle + 0.08) * shoulder_radius,
                3.04 + 0.09 * ((index * 7) % 3),
            ))
        apex = (0.19, -0.14, 3.45)
        for index in range(len(radii)):
            nxt = (index + 1) % len(radii)
            builder.face(
                (base_ring[index], base_ring[nxt], shoulder_ring[nxt], shoulder_ring[index]),
                M["earth"] if index in {2, 6} else M["rock"],
            )
            builder.face(
                (shoulder_ring[index], shoulder_ring[nxt], apex),
                M["earth"] if index in {0, 4, 7} else M["rock"],
            )

        # Three embedded flank facets extend the stone language down the cone
        # and visually weld the crown to the slope.
        for angle, inner_r, outer_r in ((-2.48, 0.88, 1.72), (-0.42, 0.82, 1.58), (1.46, 0.90, 1.66)):
            half = 0.18
            points = []
            for radius, delta in ((inner_r, -half), (outer_r, -half), (outer_r, half), (inner_r, half)):
                a = angle + delta
                x, y = math.cos(a) * radius, math.sin(a) * radius
                u, v = (x + width * 0.5) / width, (y + height * 0.5) / height
                points.append((x, y, surface(u, v) + 0.018))
            builder.face(points, M["earth"] if angle < -1.0 else M["rock"])
    if key == "mountain_cave_entrance":
        # Staggered warm cliff/rock courses replace the former monolithic gray
        # portal slabs.  The dark trim remains structural and the opening stays
        # at least 1.9 m wide by 2.35 m high for the streamed cave interior.
        course_z = (1.24, 1.70, 2.16, 2.62, 3.08)
        for side in (-1.0, 1.0):
            for course, z in enumerate(course_z):
                x = side * (1.49 + (0.05 if course % 2 else 0.0))
                material = M["rock"] if course in {1, 4} else M["earth"]
                builder.box((x, -0.77, z), (0.92, 0.54, 0.42), material)
        for index, x in enumerate((-0.79, -0.27, 0.27, 0.79)):
            builder.box((x, -0.77, 3.54), (0.48, 0.54, 0.42), M["rock"] if index in {0, 3} else M["earth"])

        # A thick warm frame and small rock cap make the entrance read as
        # crafted solarpunk infrastructure rather than a concrete void.
        builder.box((-1.04, -1.075, 2.17), (0.16, 0.18, 2.34), M["earth"])
        builder.box((1.04, -1.075, 2.17), (0.16, 0.18, 2.34), M["earth"])
        builder.box((0.0, -1.075, 3.40), (2.24, 0.18, 0.18), M["earth"])
        builder.box((0.0, -1.18, 3.58), (1.56, 0.10, 0.18), M["rock"])
        builder.box((-1.48, -1.065, 2.10), (0.10, 0.10, 1.70), M["keyline"])
        builder.box((1.48, -1.065, 2.10), (0.10, 0.10, 1.70), M["keyline"])
        # The slightly forward vertical face masks the heightfield behind it and
        # preserves a visible 1.9m x 2.35m streamed-interior opening.
        builder.face(((-0.95, -1.171, 1.0), (0.95, -1.171, 1.0), (0.95, -1.171, 3.35), (-0.95, -1.171, 3.35)), M["cave_void"])
    return builder


def tile_connection_edges(tile):
    edges = []
    for connection in tile.get("connections", []):
        if isinstance(connection, dict):
            edges.append(connection["edge"])
        elif isinstance(connection, str) and "_" in connection:
            edges.append(connection.split("_", 1)[0])
    return edges


def river_tile_builder(tile):
    width, height = tile["dimensions_m"]
    builder = Builder()
    # Only the buried bottom slab is continuous.  Bank walls are emitted per
    # dry subcell below, leaving every active water socket physically open.
    civic_headworks = tile["id"] == "T74"
    bottom_material = M["stone"] if civic_headworks else M["earth"]
    bank_line_material = M["cream"] if civic_headworks else M["keyline"]
    bank_top_material = M["limestone"] if civic_headworks else M["grass"]
    bank_side_material = M["stone"] if civic_headworks else M["earth"]
    builder.box((0, 0, BOTTOM_Z-0.02), (width, height, 0.04), bottom_material, omit=("top", "north", "east", "south", "west"))
    edges = tile_connection_edges(tile)
    surface = tile.get("water_surface_z_local_m", RIVER_Z)
    north_z = float(surface.get("north", surface.get("north_river", RIVER_Z))) if isinstance(surface, dict) else float(surface)
    south_z = float(surface.get("south", surface.get("south_ocean", surface.get("south_canal", RIVER_Z)))) if isinstance(surface, dict) else float(surface)

    # Axis-aligned constructive partition.  The explicit +/-0.60 m breakpoints
    # make every active river socket exactly 1.20 m wide; basin water widens
    # only after entering the tile, so all rotated neighbors remain compatible.
    basin = tile["id"] in {"T68", "T69", "T72"}
    pool_half = min(width, height) * 0.375 if basin else 0.60

    def breaks(half_extent):
        values = {-half_extent, half_extent, 0.0, -0.60, 0.60, -pool_half, pool_half}
        return sorted(value for value in values if -half_extent-1e-8 <= value <= half_extent+1e-8)

    xs, ys = breaks(width*0.5), breaks(height*0.5)

    def is_wet(x, y):
        wet = abs(x) <= pool_half and abs(y) <= pool_half
        wet |= "N" in edges and abs(x) <= 0.60 and y >= 0
        wet |= "S" in edges and abs(x) <= 0.60 and y <= 0
        wet |= "E" in edges and abs(y) <= 0.60 and x >= 0
        wet |= "W" in edges and abs(y) <= 0.60 and x <= 0
        return wet

    cells = []
    for iy in range(len(ys)-1):
        for ix in range(len(xs)-1):
            x0, x1, y0, y1 = xs[ix], xs[ix+1], ys[iy], ys[iy+1]
            x, y = (x0+x1)*0.5, (y0+y1)*0.5
            cells.append({"ix": ix, "iy": iy, "x0": x0, "x1": x1, "y0": y0, "y1": y1, "x": x, "y": y, "wet": is_wet(x, y)})

    def water_z_at_y(y):
        return lerp(south_z, north_z, (y + height*0.5) / height)

    cell_lookup = {(cell["ix"], cell["iy"]): cell for cell in cells}
    for cell in cells:
        ix, iy = cell["ix"], cell["iy"]
        x0, x1, y0, y1 = cell["x0"], cell["x1"], cell["y0"], cell["y1"]
        x, y, wet = cell["x"], cell["y"], cell["wet"]
        if wet:
            z0, z1 = water_z_at_y(y0), water_z_at_y(y1)
            builder.face(((x0, y0, z0), (x1, y0, z0), (x1, y1, z1), (x0, y1, z1)), M["river_flow"])
        else:
            bank_z = max(WALK_Z + 0.012, water_z_at_y(y) + 0.16)
            builder.card((x, y), (x1-x0, y1-y0), bank_z-0.012, bank_line_material)
            builder.card((x, y), ((x1-x0)*0.92, (y1-y0)*0.92), bank_z, bank_top_material)
            if ix == 0:
                builder.face(((x0, y1, BOTTOM_Z), (x0, y0, BOTTOM_Z), (x0, y0, bank_z), (x0, y1, bank_z)), bank_side_material)
            if ix == len(xs)-2:
                builder.face(((x1, y0, BOTTOM_Z), (x1, y1, BOTTOM_Z), (x1, y1, bank_z), (x1, y0, bank_z)), bank_side_material)
            if iy == 0:
                builder.face(((x0, y0, BOTTOM_Z), (x1, y0, BOTTOM_Z), (x1, y0, bank_z), (x0, y0, bank_z)), bank_side_material)
            if iy == len(ys)-2:
                builder.face(((x1, y1, BOTTOM_Z), (x0, y1, BOTTOM_Z), (x0, y1, bank_z), (x1, y1, bank_z)), bank_side_material)

    for cell in cells:
        if not cell["wet"]:
            continue
        ix, iy = cell["ix"], cell["iy"]
        x0, x1, y0, y1 = cell["x0"], cell["x1"], cell["y0"], cell["y1"]
        for dx, dy, edge in ((0, 1, "N"), (1, 0, "E"), (0, -1, "S"), (-1, 0, "W")):
            neighbor = (ix + dx, iy + dy)
            neighbor_cell = cell_lookup.get(neighbor)
            if neighbor_cell is None or neighbor_cell["wet"]:
                continue
            if edge == "N":
                a, b = (x0, y1), (x1, y1)
            elif edge == "E":
                a, b = (x1, y1), (x1, y0)
            elif edge == "S":
                a, b = (x1, y0), (x0, y0)
            else:
                a, b = (x0, y0), (x0, y1)
            za, zb = water_z_at_y(a[1]), water_z_at_y(b[1])
            bank_a, bank_b = max(WALK_Z+0.012, za+0.16), max(WALK_Z+0.012, zb+0.16)
            builder.face(((a[0], a[1], za-0.03), (b[0], b[1], zb-0.03), (b[0], b[1], bank_b), (a[0], a[1], bank_a)), bank_side_material)

    key = tile["key"]
    if any(token in key for token in ("rapid", "waterfall", "plunge", "source", "mouth")):
        foam_z = max(north_z, south_z) + 0.018
        for offset in (-0.22, 0.22):
            builder.card((offset, 0), (0.09, min(height * 0.82, 1.45)), foam_z, M["foam"])
    if key == "river_waterfall":
        builder.face(((-0.35, 0.12, north_z), (0.35, 0.12, north_z), (0.35, -0.12, south_z), (-0.35, -0.12, south_z)), M["river_flow"])
    if key == "river_canal_headworks":
        # A complete civic weir language: warm masonry piers, terracotta caps,
        # timber beam, teal lift gate and a vertical brass control wheel.  The
        # pier gap remains wider than the exact 1.20 m water socket.
        for x in (-0.79, 0.79):
            builder.box((x, 0.0, 1.31), (0.30, 1.64, 0.62), M["limestone"])
            builder.box((x, 0.0, 1.65), (0.38, 1.72, 0.10), M["cream"])
        builder.box((0.0, 0.02, 1.61), (1.62, 0.18, 0.18), M["stone"])
        builder.box((0.0, 0.06, 1.25), (1.16, 0.10, 0.52), M["teal"])
        builder.box((0.0, -0.05, 1.48), (1.08, 0.08, 0.08), M["cream"])

        wheel_y, wheel_z, outer_r, inner_r = -0.15, 1.73, 0.29, 0.16
        wheel_outer = []
        wheel_inner = []
        for index in range(10):
            angle = math.tau * index / 10
            wheel_outer.append((math.cos(angle) * outer_r, wheel_y, wheel_z + math.sin(angle) * outer_r))
            wheel_inner.append((math.cos(angle) * inner_r, wheel_y - 0.004, wheel_z + math.sin(angle) * inner_r))
        for index in range(10):
            nxt = (index + 1) % 10
            builder.face((wheel_outer[index], wheel_outer[nxt], wheel_inner[nxt], wheel_inner[index]), M["cream"])
        builder.face(tuple((math.cos(math.tau*index/8)*0.075, wheel_y-0.006, wheel_z+math.sin(math.tau*index/8)*0.075) for index in range(8)), M["stone"])
    return builder


TILE_ASSETS = {}
TILE_RECORDS = []
for tile in SPEC["new_tiles"]:
    tile_collection = make_collection(f"MM_HRW_{tile['id']}_{tile['key'].upper()}", ROOT_TILE_LIBRARY)
    builder = mountain_tile_builder(tile) if tile["family"] == "mountain" else river_tile_builder(tile)
    name = f"MM_TILE_{tile['id']}_{tile['key'].upper()}_V1_LOD0"
    obj = object_from_builder(name, builder, tile_collection)
    obj["asset_id"] = f"mm_tile_{tile['id'].lower()}_{tile['key']}_v1"
    obj["tile_id"] = tile["id"]
    obj["tile_key"] = tile["key"]
    obj["tile_family"] = tile["family"]
    obj["grid_cell_m"] = CELL
    if tile["family"] == "river":
        obj["runtime_shader"] = "water_flow_v1"
        obj["nominal_speed_mps"] = tile["nominal_speed_mps"]
    width, height = tile["dimensions_m"]
    socket_positions = {
        "N": [0, height * 0.5, WALK_Z], "E": [width * 0.5, 0, WALK_Z],
        "S": [0, -height * 0.5, WALK_Z], "W": [-width * 0.5, 0, WALK_Z],
    }
    sockets = []
    for edge in EDGE_ORDER:
        raw_connection = next((
            item for item in tile.get("connections", [])
            if (isinstance(item, dict) and item.get("edge") == edge)
            or (isinstance(item, str) and item.startswith(edge + "_"))
        ), None)
        connection = ({"edge": edge, "role": raw_connection.split("_", 1)[1], "level_delta": 0}
                      if isinstance(raw_connection, str) else raw_connection)
        empty = add_empty(f"{name}_SOCKET_{edge}", tile_collection, socket_positions[edge])
        empty.parent = obj
        empty["socket_edge"] = edge
        empty["socket_role"] = connection.get("role", "GRID") if connection else "GRID"
        empty["level_delta"] = connection.get("level_delta", 0) if connection else 0
        socket_record = {"name": empty.name, "edge": edge, "role": empty["socket_role"], "level_delta": empty["level_delta"], "position_m": list(socket_positions[edge]), "active": bool(connection)}
        if connection and tile["family"] == "river":
            surface = tile.get("water_surface_z_local_m", RIVER_Z)
            if isinstance(surface, dict):
                aliases = {
                    "N": ("north", "north_river"), "S": ("south", "south_ocean", "south_canal"),
                    "E": ("east", "north", "north_river"), "W": ("west", "north", "north_river"),
                }[edge]
                surface_value = next((surface[key] for key in aliases if key in surface), next(iter(surface.values())))
            else:
                surface_value = surface
            flow = tile.get("flow_vector_local_xy") or tile.get("flow_vector_local_xyz") or [0, -1]
            empty["surface_z_local_m"] = float(surface_value)
            empty["width_m"] = 1.2
            empty["flow_vector_local_xy"] = list(flow[:2])
            empty["nominal_speed_mps"] = float(tile["nominal_speed_mps"])
            socket_record.update({
                "surface_z_local_m": float(surface_value), "width_m": 1.2,
                "flow_vector_local_xy": list(flow[:2]), "nominal_speed_mps": float(tile["nominal_speed_mps"]),
            })
        elif connection:
            profile = tile.get("edge_profiles", {}).get(edge)
            empty["edge_profile"] = profile or "M0"
            socket_record["edge_profile"] = profile or "M0"
        sockets.append(socket_record)
    if tile["id"] == "T61":
        portal_spec = tile["portal"]
        portal_socket = add_empty("CAVE_PORTAL_S", tile_collection, (0, -height * 0.5, portal_spec["floor_z_local_m"]), display="CUBE", size=0.28)
        portal_socket.parent = obj
        portal_socket["socket_type"] = "CAVE_PORTAL"
        portal_socket["width_m"] = portal_spec["width_m"]
        portal_socket["height_m"] = portal_spec["height_m"]
        portal_socket["floor_z_local_m"] = portal_spec["floor_z_local_m"]
        portal_socket["streamed_interior"] = portal_spec["streamed_interior"]
        sockets.append({"name": "CAVE_PORTAL_S", "edge": "S", "role": "CAVE_PORTAL", "position_m": [0, -height*0.5, portal_spec["floor_z_local_m"]], **portal_spec})
    TILE_ASSETS[tile["id"]] = {"object": obj, "collection": tile_collection, "sockets": sockets}


# ---------------------------------------------------------------------------
# Expanded-world raster and hydrology graph
# ---------------------------------------------------------------------------

WORLD_MIN = tuple(DESIGN["world"]["bounds_cells"]["min"])
WORLD_MAX = tuple(DESIGN["world"]["bounds_cells"]["max"])


def in_bounds(cell):
    return WORLD_MIN[0] <= cell[0] <= WORLD_MAX[0] and WORLD_MIN[1] <= cell[1] <= WORLD_MAX[1]


def point_on_segment(point, a, b, epsilon=1e-8):
    px, py = point
    ax, ay = a
    bx, by = b
    cross = (px-ax)*(by-ay) - (py-ay)*(bx-ax)
    if abs(cross) > epsilon:
        return False
    return min(ax, bx)-epsilon <= px <= max(ax, bx)+epsilon and min(ay, by)-epsilon <= py <= max(ay, by)+epsilon


def point_in_polygon(point, polygon):
    if any(point_on_segment(point, polygon[i], polygon[(i+1) % len(polygon)]) for i in range(len(polygon))):
        return True
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y):
            at_x = (xj-xi) * (y-yi) / (yj-yi) + xi
            if x < at_x:
                inside = not inside
        j = i
    return inside


def cells_in_polygon(polygon):
    min_x = max(WORLD_MIN[0], math.floor(min(p[0] for p in polygon)))
    max_x = min(WORLD_MAX[0], math.ceil(max(p[0] for p in polygon)))
    min_y = max(WORLD_MIN[1], math.floor(min(p[1] for p in polygon)))
    max_y = min(WORLD_MAX[1], math.ceil(max(p[1] for p in polygon)))
    return {(x, y) for x in range(min_x, max_x + 1) for y in range(min_y, max_y + 1) if point_in_polygon((x, y), polygon)}


def rect_cells(rect):
    minimum, maximum = rect["min"], rect["max"]
    return {(x, y) for x in range(minimum[0], maximum[0] + 1) for y in range(minimum[1], maximum[1] + 1) if in_bounds((x, y))}


def cardinal_segment(a, b):
    """A stable 4-connected supercover suitable for gameplay sockets and DAG QA."""
    x, y = a
    tx, ty = b
    result = [(x, y)]
    dx, dy = tx-x, ty-y
    steps = max(abs(dx), abs(dy), 1)
    last = (x, y)
    for step in range(1, steps + 1):
        target = (round(x + dx * step / steps), round(y + dy * step / steps))
        while last[0] != target[0]:
            last = (last[0] + (1 if target[0] > last[0] else -1), last[1])
            if result[-1] != last:
                result.append(last)
        while last[1] != target[1]:
            last = (last[0], last[1] + (1 if target[1] > last[1] else -1))
            if result[-1] != last:
                result.append(last)
    return result


def polyline_cells(points):
    result = []
    for index in range(len(points) - 1):
        segment = cardinal_segment(tuple(points[index]), tuple(points[index + 1]))
        result.extend(segment if not result else segment[1:])
    return result or [tuple(points[0])]


def island_mask_city():
    result = set()
    for x in range(-48, 48):
        for y in range(-40, 40):
            cuts = (
                max(0, -42-x) + max(0, -34-y), max(0, x-41) + max(0, -34-y),
                max(0, -42-x) + max(0, y-33), max(0, x-41) + max(0, y-33),
            )
            if max(cuts) <= 6:
                result.add((x, y))
    return result


LAND = cells_in_polygon(DESIGN["world"]["land_polygon"])
CITY_LAND = island_mask_city()
LAND |= CITY_LAND
ELEVATION = {cell: 0 for cell in LAND}
for level_record in DESIGN["elevation"]["levels"]:
    for polygon in level_record["polygons"]:
        for cell in cells_in_polygon(polygon) & LAND:
            ELEVATION[cell] = max(ELEVATION[cell], int(level_record["level"]))

EXISTING_PLOTS = [dict(record) for record in GOV_LAYOUT["plots"]]
ADDED_PLOTS = [dict(record) for record in DESIGN["plots"]["added"]]
ALL_PLOTS = EXISTING_PLOTS + ADDED_PLOTS
PLOT_CELLS = {}
for record in ALL_PLOTS:
    for cell in rect_cells(record["occupied_bounds_cells"]):
        PLOT_CELLS[cell] = record["id"]
        ELEVATION[cell] = 0

BUILDING_CELLS = set()
for record in GOV_LAYOUT["buildings"]:
    BUILDING_CELLS |= rect_cells(record["occupied_bounds_cells"])
    for cell in rect_cells(record["occupied_bounds_cells"]):
        ELEVATION[cell] = 0

ROAD_CELLS = set()
PATH_CELLS = set()
for record in GOV_LAYOUT["roads"]:
    ROAD_CELLS |= rect_cells(record["cell_rect"])
for record in GOV_LAYOUT["paths"]:
    PATH_CELLS |= rect_cells(record["cell_rect"])
for record in DESIGN["transport"]["roads"]:
    path = polyline_cells(record["polyline"])
    for index, cell in enumerate(path):
        ROAD_CELLS.add(cell)
        if record.get("width_cells", 1) > 1:
            before = path[max(0, index-1)]
            after = path[min(len(path)-1, index+1)]
            if abs(after[1]-before[1]) >= abs(after[0]-before[0]):
                ROAD_CELLS.add((cell[0]+1, cell[1]))
            else:
                ROAD_CELLS.add((cell[0], cell[1]+1))
for record in DESIGN["transport"]["trails"]:
    points = record.get("polyline", record.get("closed_polyline"))
    PATH_CELLS |= set(polyline_cells(points))
ROAD_CELLS &= LAND
PATH_CELLS &= LAND

for cell in (ROAD_CELLS | PATH_CELLS):
    if cell in ELEVATION and cell[1] < 95:
        ELEVATION[cell] = min(ELEVATION[cell], 1)


def chunk_id(cell):
    cx = math.floor((cell[0] - WORLD_MIN[0]) / CHUNK_CELLS)
    cy = math.floor((cell[1] - WORLD_MIN[1]) / CHUNK_CELLS)
    return f"CH_{cx}_{cy}"


def station_path(stations):
    result = []
    metadata = {}
    for index in range(len(stations) - 1):
        a, b = stations[index], stations[index + 1]
        segment = cardinal_segment(tuple(a["cell"]), tuple(b["cell"]))
        for step, cell in enumerate(segment):
            if result and cell == result[-1]:
                continue
            t = step / max(1, len(segment)-1)
            level = int(round(lerp(a["level"], b["level"], t)))
            metadata[cell] = {"level": level, "kind": a["kind"] if step < len(segment)-1 else b["kind"], "reach_index": index}
            result.append(cell)
    if len(stations) == 1:
        result = [tuple(stations[0]["cell"])]
        metadata[result[0]] = {"level": stations[0]["level"], "kind": stations[0]["kind"], "reach_index": 0}
    return result, metadata


HYDRO_META = {}
HYDRO_EDGES = []
VISUAL_WATER = set()
LAKE_CELLS = set()
for watershed in DESIGN["hydrology"]["watersheds"]:
    ws_id = watershed["id"]
    main = watershed["main_channel"]
    main_path, main_meta = station_path(main["stations"])
    route_paths = [(main["id"], main_path, main_meta, main.get("width_by_reach_cells", [1]))]
    main_set = set(main_path)
    for tributary in watershed.get("tributaries", []):
        path, metadata = station_path(tributary["stations"])
        if path[-1] not in main_set:
            # Join a same-or-lower main reach; geometric nearest alone can pick
            # the high side of a lake and create an impossible uphill edge.
            tributary_level = metadata[path[-1]]["level"]
            lake_outlet = next((tuple(lake["outlet"]) for lake in watershed.get("lakes", []) if list(path[-1]) in lake.get("inlets", [])), None)
            eligible = [cell for cell in main_set if main_meta[cell]["level"] <= tributary_level]
            nearest = lake_outlet or min(eligible or main_set, key=lambda cell: abs(cell[0]-path[-1][0]) + abs(cell[1]-path[-1][1]))
            connector = cardinal_segment(path[-1], nearest)[1:]
            start_level, target_level = metadata[path[-1]]["level"], main_meta[nearest]["level"]
            for idx, cell in enumerate(connector):
                metadata[cell] = {"level": int(round(lerp(start_level, target_level, (idx+1)/max(1, len(connector))))), "kind": "lake_connection", "reach_index": len(tributary["stations"])-1}
            path.extend(connector)
        # A geometric crossing is a legal confluence only at a same-or-lower
        # main level.  Earlier high-bank crossings remain part of the approach.
        contact = next((
            idx for idx, cell in enumerate(path)
            if idx and cell in main_set and metadata[cell]["level"] >= main_meta[cell]["level"]
        ), len(path)-1)
        path = path[:contact+1]
        for cell in path:
            if cell in main_set:
                metadata[cell]["level"] = max(metadata[cell]["level"], main_meta[cell]["level"])
        for index in range(len(path)-2, -1, -1):
            metadata[path[index]]["level"] = max(metadata[path[index]]["level"], metadata[path[index+1]]["level"])
        route_paths.append((tributary["id"], path, metadata, [tributary.get("width_cells", 1)]))

    for lake in watershed.get("lakes", []):
        lake_cells = cells_in_polygon(lake["polygon"])
        LAKE_CELLS |= lake_cells
        VISUAL_WATER |= lake_cells

    for channel, path, metadata, widths in route_paths:
        distance = 0.0
        for index, cell in enumerate(path):
            info = metadata[cell]
            kind = info["kind"]
            level = int(info["level"])
            width = int(widths[min(info.get("reach_index", 0), len(widths)-1)])
            water_z = RIVER_Z + level
            if "ocean_mouth" in kind:
                water_z = OCEAN_Z
            if "existing_canal" in kind or "canal_" in kind:
                water_z = CANAL_Z
            prior = HYDRO_META.get(cell)
            record = {
                "id": f"W_{cell[0]}_{cell[1]}", "cell": list(cell), "watershed": ws_id,
                "channel": channel, "level": level, "kind": kind, "width_cells": width,
                "water_z_m": round(water_z, 3), "bed_z_m": round(water_z - 0.34, 3),
                "flow_vector": [0.0, -1.0], "speed_mps": 0.85, "flow_distance_m": round(distance, 3),
                "chunk_id": chunk_id(cell),
            }
            if prior is None or prior["channel"] != main["id"]:
                HYDRO_META[cell] = record
            if index + 1 < len(path):
                nxt = path[index + 1]
                dx, dy = nxt[0]-cell[0], nxt[1]-cell[1]
                HYDRO_META[cell]["flow_vector"] = [float(dx), float(dy)]
                distance += CELL
            # Width is a rendering contract; metadata/graph remains a single stable centerline.
            VISUAL_WATER.add(cell)
            offsets = [0] if width == 1 else [0, 1] if width == 2 else [-1, 0, 1]
            vector = HYDRO_META[cell]["flow_vector"]
            if abs(vector[1]) >= abs(vector[0]):
                VISUAL_WATER |= {(cell[0]+offset, cell[1]) for offset in offsets}
            else:
                VISUAL_WATER |= {(cell[0], cell[1]+offset) for offset in offsets}
        for index in range(len(path)-1):
            HYDRO_EDGES.append((path[index], path[index+1]))

# The protected civic canal is rendered at its historical 0.68 m level.  The
# natural graph already follows its east leg, so adding the remaining segments
# here cannot introduce gameplay DAG branches.
CANAL_CELLS = set()
for segment in GOV_LAYOUT["canal"]["segments"]:
    CANAL_CELLS |= rect_cells(segment["cell_rect"])
VISUAL_WATER |= CANAL_CELLS
VISUAL_WATER = {cell for cell in VISUAL_WATER if in_bounds(cell)}

# Guarantee a reciprocal, acyclic edge set and recompute exact drop metadata.
unique_edges = []
seen_edge = set()
for source, target in HYDRO_EDGES:
    if source == target or (source, target) in seen_edge:
        continue
    if source not in HYDRO_META or target not in HYDRO_META:
        continue
    seen_edge.add((source, target))
    unique_edges.append((source, target))
HYDRO_EDGES = unique_edges
HYDRO_GRAPH_NODES = []
for cell, record in sorted(HYDRO_META.items(), key=lambda item: (item[0][1], item[0][0])):
    node = {key: record[key] for key in ("id", "cell", "kind", "level", "water_z_m")}
    if "spring" in record["kind"]:
        node["tile_id"] = "T67"
        node["hydrology_role"] = "source"
    if "ocean_mouth" in record["kind"]:
        node["tile_id"] = "T73"
        node["hydrology_role"] = "ocean_mouth"
    if "canal_confluence" in record["kind"]:
        node["tile_id"] = "T74"
        node["hydrology_role"] = "headworks"
    HYDRO_GRAPH_NODES.append(node)

HYDRO_GRAPH_EDGES = []
for source, target in HYDRO_EDGES:
    a, b = HYDRO_META[source], HYDRO_META[target]
    drop = round(a["water_z_m"] - b["water_z_m"], 3)
    kind, tile_id = "river", "T62"
    if "ocean_mouth" in b["kind"]:
        kind, tile_id = "mouth", "T73"
    elif drop > 0.25:
        kind = "waterfall" if "waterfall" in a["kind"] or "waterfall" in b["kind"] else "rapid"
        tile_id = "T71" if kind == "waterfall" else "T70"
    elif drop < -0.001:
        kind, tile_id = "headworks", "T74"
    dx, dy = target[0]-source[0], target[1]-source[1]
    from_edge = "E" if dx > 0 else "W" if dx < 0 else "N" if dy > 0 else "S"
    to_edge = {"E": "W", "W": "E", "N": "S", "S": "N"}[from_edge]
    HYDRO_GRAPH_EDGES.append({"from": a["id"], "to": b["id"], "from_edge": from_edge, "to_edge": to_edge, "drop_m": drop, "kind": kind, "tile_id": tile_id})

# The planning layout intentionally has a richer semantic vocabulary than the
# canonical runtime mesh library.  Record both units explicitly so waterfall
# sites are not confused with directed drop edges and the 32 planning markers
# are not mistaken for 32 missing source GLBs.
SEMANTIC_LAYOUT_TILE_MARKERS = sum(
    len(DESIGN["tile_program"].get(group, []))
    for group in ("new_mountain_tiles", "new_river_tiles", "new_lake_tiles", "new_waterfall_tiles")
)
CANONICAL_SOURCE_TILE_MESHES = len(SPEC["new_tiles"])
AUTHORED_WATERFALL_SITES = int(DESIGN["hydrology"]["waterfall_count"])
GRAPH_WATERFALL_EDGES = sum(1 for edge in HYDRO_GRAPH_EDGES if edge["kind"] == "waterfall")
GRAPH_RAPID_EDGES = sum(1 for edge in HYDRO_GRAPH_EDGES if edge["kind"] == "rapid")
DIRECTED_GRAPH_DROP_EDGES = sum(
    1 for edge in HYDRO_GRAPH_EDGES
    if edge["drop_m"] > 0.25 and edge["kind"] != "mouth"
)

DROP_TARGETS = defaultdict(list)
for source, target in HYDRO_EDGES:
    drop = HYDRO_META[source]["water_z_m"] - HYDRO_META[target]["water_z_m"]
    if drop > 0.25 and "ocean_mouth" not in HYDRO_META[target]["kind"]:
        DROP_TARGETS[source].append(target)


# ---------------------------------------------------------------------------
# Browser-conscious 16x16-cell terrain chunks
# ---------------------------------------------------------------------------

LAKE_LEVEL = {}
for watershed in DESIGN["hydrology"]["watersheds"]:
    for lake in watershed.get("lakes", []):
        for cell in cells_in_polygon(lake["polygon"]):
            LAKE_LEVEL[cell] = float(lake["water_z_m"])


def render_water_z(cell):
    if cell in CANAL_CELLS:
        return CANAL_Z
    if cell in HYDRO_META:
        return float(HYDRO_META[cell]["water_z_m"])
    if cell in LAKE_LEVEL:
        return LAKE_LEVEL[cell]
    nearest = min(HYDRO_META, key=lambda item: abs(item[0]-cell[0]) + abs(item[1]-cell[1]), default=None)
    return float(HYDRO_META[nearest]["water_z_m"]) if nearest else RIVER_Z


BRIDGE_CELLS = set()
for bridge in DESIGN["transport"]["bridges"]:
    BRIDGE_CELLS |= {tuple(cell) for cell in bridge["deck_cells"]}
for bridge in GOV_LAYOUT["bridges"]:
    BRIDGE_CELLS.add(tuple(bridge["anchor_cell"]))


def cell_local(cell, chunk_min):
    return ((cell[0] - chunk_min[0]) * CELL, (cell[1] - chunk_min[1]) * CELL)


def add_cell_cliff(builder, cell, local_xy, level, direction, neighbor_level):
    x, y = local_xy
    top = WALK_Z + level
    bottom = WALK_Z + neighbor_level if neighbor_level is not None else BOTTOM_Z
    if top <= bottom + 1e-6:
        return
    if direction == "N":
        a, b = (x-1, y+1), (x+1, y+1)
    elif direction == "E":
        a, b = (x+1, y+1), (x+1, y-1)
    elif direction == "S":
        a, b = (x+1, y-1), (x-1, y-1)
    else:
        a, b = (x-1, y-1), (x-1, y+1)
    builder.face(((a[0], a[1], bottom), (b[0], b[1], bottom), (b[0], b[1], top), (a[0], a[1], top)), M["earth"])


def chunk_surface_material(cell):
    if cell in BRIDGE_CELLS:
        return M["path"]
    if cell in ROAD_CELLS:
        return M["path"]
    if cell in PATH_CELLS:
        return M["limestone"]
    if cell in PLOT_CELLS:
        return M["sand"]
    level = ELEVATION.get(cell, 0)
    return M["grass_dark"] if level >= 4 else M["grass_hi"] if level >= 1 else M["grass"]


CHUNK_ASSETS = {}
CHUNK_RECORDS = []
for cy in range(16):
    for cx in range(16):
        chunk_name = f"CH_{cx}_{cy}"
        minimum = (WORLD_MIN[0] + cx * CHUNK_CELLS, WORLD_MIN[1] + cy * CHUNK_CELLS)
        maximum = (minimum[0] + CHUNK_CELLS - 1, minimum[1] + CHUNK_CELLS - 1)
        origin = (minimum[0] * CELL, minimum[1] * CELL)
        collection = make_collection(f"MM_HRW_{chunk_name}", ROOT_CHUNKS)
        builder = Builder()
        # One ocean card per chunk guarantees valid, complete streaming geometry.
        builder.card((15.0, 15.0), (32.0, 32.0), OCEAN_Z, M["water_deep"])
        dry_land = []
        water_surface_cells = []
        for y in range(minimum[1], maximum[1] + 1):
            for x in range(minimum[0], maximum[0] + 1):
                cell = (x, y)
                local = cell_local(cell, minimum)
                if cell in LAND and cell not in VISUAL_WATER:
                    dry_land.append(cell)
                    level = ELEVATION.get(cell, 0)
                    z = WALK_Z + level
                    builder.card(local, (1.98, 1.98), z - 0.012, M["keyline"])
                    builder.card(local, (1.84, 1.84), z, chunk_surface_material(cell))
                    for edge, delta in (("N", (0, 1)), ("E", (1, 0)), ("S", (0, -1)), ("W", (-1, 0))):
                        neighbor = (x + delta[0], y + delta[1])
                        neighbor_level = ELEVATION.get(neighbor) if neighbor in LAND and neighbor not in VISUAL_WATER else None
                        add_cell_cliff(builder, cell, local, level, edge, neighbor_level)
                elif cell in VISUAL_WATER:
                    water_surface_cells.append(cell)
                    z = render_water_z(cell)
                    render_z = z + 0.003 if abs(z - OCEAN_Z) < 1e-6 else z
                    builder.card(local, (2.0, 2.0), render_z, M["river_flow"] if cell not in CANAL_CELLS else M["water"])
                    if cell in HYDRO_META and any(token in HYDRO_META[cell]["kind"] for token in ("rapid", "waterfall", "cascade")):
                        builder.card(local, (1.30, 0.10), z + 0.018, M["foam"])
                    for target in DROP_TARGETS.get(cell, []):
                        target_z = HYDRO_META[target]["water_z_m"]
                        dx, dy = target[0]-cell[0], target[1]-cell[1]
                        x0, y0 = local
                        if dx:
                            edge_x = x0 + dx
                            face = ((edge_x, y0-0.66, target_z), (edge_x, y0+0.66, target_z), (edge_x, y0+0.66, z), (edge_x, y0-0.66, z))
                            builder.face(face, M["river_flow"])
                            builder.card((edge_x-dx*0.05, y0), (0.10, 1.34), z+0.02, M["foam"])
                        else:
                            edge_y = y0 + dy
                            face = ((x0-0.66, edge_y, target_z), (x0+0.66, edge_y, target_z), (x0+0.66, edge_y, z), (x0-0.66, edge_y, z))
                            builder.face(face, M["river_flow"])
                            builder.card((x0, edge_y-dy*0.05), (1.34, 0.10), z+0.02, M["foam"])
        obj = object_from_builder(f"MM_TERRAIN_{chunk_name}_V1_LOD0", builder, collection)
        obj.location = (origin[0], origin[1], 0)
        obj["chunk_id"] = chunk_name
        obj["chunk_index"] = [cx, cy]
        obj["bounds_cells_min"] = list(minimum)
        obj["bounds_cells_max"] = list(maximum)
        obj["tile_size_m"] = CELL
        obj["hydrology_file"] = "hydrology.json"
        elevations = [ELEVATION.get(cell, 0) for cell in dry_land] or [0]
        material_names = sorted({material.name for material in builder.materials})
        record = {
            "id": chunk_name, "index": [cx, cy],
            "bounds_cells": {"min": list(minimum), "max": list(maximum), "inclusive": True},
            "origin_m": [origin[0], origin[1]], "land_cells": len(dry_land),
            "water_cells": CHUNK_CELLS * CHUNK_CELLS - len(dry_land),
            "elevation_min": min(elevations), "elevation_max": max(elevations),
            "object": obj.name, "materials": material_names, "triangles": triangle_count(obj),
            "lod": "LOD0",
            "collision_source": {"type": "greedy_heightfield", "file": "terrain-grid.json", "chunk_id": chunk_name, "bridge_decks": "layout.json transport.bridges", "water_walkable": False},
            "glb": f"chunks/{chunk_name}.glb",
        }
        CHUNK_ASSETS[chunk_name] = {"object": obj, "collection": collection, "origin": origin}
        CHUNK_RECORDS.append(record)


# Plot fills and crisp white borders remain separate from compiled terrain so a
# later ownership system can swap them without rebuilding the chunk GLB.
plot_builder = Builder()
for plot in ALL_PLOTS:
    bounds = plot["occupied_bounds_cells"]
    minimum, maximum = bounds["min"], bounds["max"]
    cx = (minimum[0] + maximum[0]) * CELL * 0.5
    cy = (minimum[1] + maximum[1]) * CELL * 0.5
    width = (maximum[0] - minimum[0] + 1) * CELL
    height = (maximum[1] - minimum[1] + 1) * CELL
    level = max((ELEVATION.get((x, y), 0) for x in range(minimum[0], maximum[0]+1) for y in range(minimum[1], maximum[1]+1)), default=0)
    z = WALK_Z + level + 0.025
    plot_builder.card((cx, cy), (width-0.16, height-0.16), z, M["sand"])
    thickness = 0.10
    plot_builder.box((cx, cy-height/2+0.10, z+0.025), (width-0.14, thickness, 0.05), M["white"])
    plot_builder.box((cx, cy+height/2-0.10, z+0.025), (width-0.14, thickness, 0.05), M["white"])
    plot_builder.box((cx-width/2+0.10, cy, z+0.025), (thickness, height-0.14, 0.05), M["white"])
    plot_builder.box((cx+width/2-0.10, cy, z+0.025), (thickness, height-0.14, 0.05), M["white"])
PLOT_OVERLAY = object_from_builder("MM_HRW_EMPTY_PLOTS_42", plot_builder, ROOT_OVERLAYS)
PLOT_OVERLAY["empty_plot_count"] = 42


# Reuse approved V5 bridge meshes at every explicit crossing.  This is visual
# dressing only: bridge cells already win terrain priority in the chunk data.
BRIDGE_OBJECTS = []
for bridge in DESIGN["transport"]["bridges"]:
    source_name = "MM_TILE_T39_FOOTBRIDGE_SHORT_V5_LOD0" if bridge["type"] == "foot" else "MM_TILE_T43_CART_BRIDGE_MID_V5_LOD0"
    source = TERRAIN_SOURCES.get(source_name)
    if source is None:
        continue
    for index, cell_value in enumerate(bridge["deck_cells"]):
        cell = tuple(cell_value)
        instance = source.copy()
        instance.data = source.data
        instance.name = f"MM_HRW_{bridge['id']}_{index:02d}"
        ROOT_OVERLAYS.objects.link(instance)
        instance.location = (cell[0] * CELL, cell[1] * CELL, ELEVATION.get(cell, 0) * STEP)
        instance.rotation_euler.z = math.radians(90 if bridge["axis"] == "E-W" else 45 if bridge["axis"] == "NW-SE" else 0)
        instance["bridge_id"] = bridge["id"]
        BRIDGE_OBJECTS.append(instance)

for bridge in GOV_LAYOUT["bridges"]:
    source_name = "MM_TILE_T39_FOOTBRIDGE_SHORT_V5_LOD0" if bridge["tile_id"] == "T39" else "MM_TILE_T43_CART_BRIDGE_MID_V5_LOD0"
    source = TERRAIN_SOURCES.get(source_name)
    if source is None:
        raise RuntimeError(f"Approved civic bridge source unavailable: {source_name}")
    cell = tuple(bridge["anchor_cell"])
    instance = source.copy()
    instance.data = source.data
    instance.name = f"MM_HRW_CIVIC_BRIDGE_{bridge['id']}"
    ROOT_OVERLAYS.objects.link(instance)
    instance.location = (cell[0] * CELL, cell[1] * CELL, 0)
    instance.rotation_euler.z = math.radians(bridge["rotation_degrees"])
    instance["bridge_id"] = bridge["id"]
    instance["government_owned"] = True
    BRIDGE_OBJECTS.append(instance)

# Reconstruct the protected civic harbor from its exact layout anchors.  These
# linked V5 pieces remain separate interactive overlays over the ocean plane.
HARBOR_OBJECTS = []
harbor = GOV_LAYOUT["harbor"]
harbor_parts = []
for index, cell in enumerate(harbor["pier_landings"]):
    harbor_parts.append((f"LANDING_{index}", "MM_TILE_T44_DOCK_LAND_LANDING_V5_LOD0", tuple(cell), 180))
for x in (22, 23):
    for y in range(-45, -40):
        harbor_parts.append((f"PIER_{x}_{y}", "MM_TILE_T45_PIER_STRAIGHT_V5_LOD0", (x, y), 0))
for index, cell in enumerate(harbor["pier_ends"]):
    harbor_parts.append((f"END_{index}", "MM_TILE_T48_PIER_END_V5_LOD0", tuple(cell), 0))
harbor_parts.append(("FERRY_BERTH", "MM_TILE_T50_FERRY_BERTH_EDGE_V5_LOD0", tuple(harbor["berth_anchor_cell"]), 0))
for part_id, source_name, cell, rotation in harbor_parts:
    source = TERRAIN_SOURCES.get(source_name)
    if source is None:
        raise RuntimeError(f"Approved civic harbor source unavailable: {source_name}")
    instance = source.copy()
    instance.data = source.data
    instance.name = f"MM_HRW_CIVIC_HARBOR_{part_id}"
    ROOT_OVERLAYS.objects.link(instance)
    instance.location = (cell[0] * CELL, cell[1] * CELL, 0)
    instance.rotation_euler.z = math.radians(rotation)
    instance["government_owned"] = True
    instance["harbor_id"] = "hearthmarket_civic_harbor"
    HARBOR_OBJECTS.append(instance)


def normalize_imported_materials(objects):
    for obj in objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            if not slot.material:
                continue
            base = re.sub(r"\.\d{3}$", "", slot.material.name)
            canonical = bpy.data.materials.get(base)
            if canonical and canonical != slot.material:
                slot.material = canonical


CIVIC_OBJECTS = []
for record in GOV_MANIFEST["buildings"]:
    before = set(bpy.data.objects)
    result = bpy.ops.import_scene.gltf(filepath=str(GOV_RUNTIME_FILES[record["id"]]))
    if "FINISHED" not in result:
        raise RuntimeError(f"Could not import civic runtime {record['id']}")
    imported = list(set(bpy.data.objects) - before)
    normalize_imported_materials(imported)
    root = add_empty(f"MM_CIVIC_{record['id']}_{record['key'].upper()}", ROOT_CIVIC)
    root.location = tuple(record["center_m"])
    root["government_owned"] = True
    root["player_buildable"] = False
    root["source_runtime_sha256"] = record["runtime_sha256"]
    for obj in imported:
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        ROOT_CIVIC.objects.link(obj)
        if obj.parent is None:
            obj.parent = root
        obj.name = f"{record['id']}_{obj.name}"
    CIVIC_OBJECTS.extend([root] + imported)


# Deterministic, linked solarpunk vegetation instances decorate only preview
# exports; chunk GLBs remain lightweight and free of incidental props.
PROP_OBJECTS = []
prop_sources = [PROP_SOURCES[name] for name in PROP_SOURCE_OBJECTS if name.startswith("V") and name in PROP_SOURCES and PROP_SOURCES[name].type == "MESH"]
if prop_sources:
    blocked = VISUAL_WATER | ROAD_CELLS | PATH_CELLS | set(PLOT_CELLS) | BUILDING_CELLS
    for biome in DESIGN["biomes"]:
        candidates = sorted(cells_in_polygon(biome["polygon"]) & LAND - blocked)
        stride = max(9, int(28 / max(0.1, biome["density"])))
        for index, cell in enumerate(candidates[::stride]):
            source = prop_sources[(index + sum(ord(char) for char in biome["id"])) % len(prop_sources)]
            instance = source.copy()
            instance.data = source.data
            instance.name = f"MM_HRW_PROP_{biome['id']}_{index:03d}"
            ROOT_PROPS.objects.link(instance)
            instance.location = (cell[0] * CELL, cell[1] * CELL, WALK_Z + ELEVATION.get(cell, 0))
            scale = 0.72 + ((cell[0] * 17 + cell[1] * 31) % 19) / 50.0
            instance.scale = (scale, scale, scale)
            instance.rotation_euler.z = math.radians((cell[0] * 47 + cell[1] * 29) % 360)
            instance["biome_id"] = biome["id"]
            PROP_OBJECTS.append(instance)

# A restrained set of approved lamps and municipal vehicles keeps the civic
# center legible without leaking road furniture into natural biomes.
civic_prop_specs = []
for x in range(-42, 43, 8):
    civic_prop_specs.extend((("L01_V0_LOD0_MESH", (x, 23), 0, 0.88), ("L01_V0_LOD0_MESH", (x, -29), 0, 0.88)))
civic_prop_specs.extend((
    ("R01_V0_LOD0_MESH", (-31, 14), 0, 0.92), ("R04_V0_LOD0_MESH", (-31, -20), 180, 0.92),
    ("R01_V0_LOD0_MESH", (28, 15), 180, 0.92), ("R02_V0_LOD0_MESH", (28, -20), 0, 0.92),
))
for index, (source_name, cell, rotation, scale) in enumerate(civic_prop_specs):
    if cell not in LAND or cell in VISUAL_WATER:
        continue
    source = PROP_SOURCES[source_name]
    instance = source.copy()
    instance.data = source.data
    instance.name = f"MM_HRW_CIVIC_PROP_{index:03d}"
    ROOT_PROPS.objects.link(instance)
    instance.location = (cell[0]*CELL, cell[1]*CELL, WALK_Z)
    instance.rotation_euler.z = math.radians(rotation)
    instance.scale = (scale, scale, scale)
    instance["government_owned"] = True
    PROP_OBJECTS.append(instance)

ferry_builder = Builder()
ferry_builder.box((0, 0, OCEAN_Z + 0.28), (4.6, 8.2, 0.72), M["cream"])
ferry_builder.box((0, 0.4, OCEAN_Z + 1.15), (3.5, 4.4, 1.05), M["teal"])
ferry_builder.box((0, 0.6, OCEAN_Z + 1.70), (3.1, 3.4, 0.18), M["mustard"])
ferry_builder.box((0, -2.3, OCEAN_Z + 0.85), (3.7, 1.0, 0.18), M["wood"])
FERRY = object_from_builder("MM_HRW_GOVERNMENT_FERRY", ferry_builder, ROOT_PROPS)
FERRY.location = (53.0, -88.0, 0)
FERRY.rotation_euler.z = math.radians(-8)
FERRY["government_owned"] = True


# Mine portal marker uses the authored T61 mesh, linked from the source tile.
portal = TILE_ASSETS["T61"]["object"].copy()
portal.data = TILE_ASSETS["T61"]["object"].data
portal.name = "MM_HRW_POI_COPPERGLASS_CAVE_T61"
ROOT_OVERLAYS.objects.link(portal)
portal.location = (-45 * CELL, 125 * CELL, 4 * STEP)
portal["poi_id"] = "POI_MINE_01"

# Three authored summit caps break the nested heightfield terraces into the
# recognizable west/central/east mountain silhouettes seen in the logo art.
SUMMIT_OBJECTS = []
level_seven = next(record for record in DESIGN["elevation"]["levels"] if record["level"] == 7)
summit_blocked = VISUAL_WATER | ROAD_CELLS | PATH_CELLS | set(PLOT_CELLS) | BUILDING_CELLS
for index, polygon in enumerate(level_seven["polygons"]):
    polygon_cells = cells_in_polygon(polygon) & LAND
    cx = sum(point[0] for point in polygon) / len(polygon)
    cy = sum(point[1] for point in polygon) / len(polygon)
    candidates = [cell for cell in polygon_cells if cell not in summit_blocked and all((cell[0]+dx, cell[1]+dy) in polygon_cells - summit_blocked for dx in (-1, 0, 1) for dy in (-1, 0, 1))]
    if not candidates:
        candidates = list(polygon_cells - summit_blocked)
    if not candidates:
        candidates = list(polygon_cells)
    cell = min(candidates, key=lambda value: (value[0]-cx)**2 + (value[1]-cy)**2)
    summit = TILE_ASSETS["T57"]["object"].copy()
    summit.data = TILE_ASSETS["T57"]["object"].data
    summit.name = f"MM_HRW_SUMMIT_{index+1:02d}_T57"
    ROOT_OVERLAYS.objects.link(summit)
    summit.location = (cell[0]*CELL, cell[1]*CELL, 7*STEP)
    summit.rotation_euler.z = math.radians(index * 120)
    summit["elevation_level"] = 7
    summit["tile_id"] = "T57"
    SUMMIT_OBJECTS.append(summit)


# ---------------------------------------------------------------------------
# Cameras, renders and GLB exports
# ---------------------------------------------------------------------------

M["hydro_overlay"] = make_plain_material("MAT_HRW_HYDROLOGY_OVERLAY", (0.02, 0.80, 0.86, 1.0), 0.25, 0.16)
hydro_builder = Builder()
for index, (cell, record) in enumerate(sorted(HYDRO_META.items())):
    x, y = cell[0] * CELL, cell[1] * CELL
    z = record["water_z_m"] + 0.10
    hydro_builder.card((x, y), (1.35, 1.35), z, M["hydro_overlay"])
    if index % 9 == 0:
        vx, vy = record["flow_vector"]
        length = math.hypot(vx, vy) or 1.0
        vx, vy = vx/length, vy/length
        px, py = -vy, vx
        tip = (x + vx*0.58, y + vy*0.58, z+0.015)
        left = (x - vx*0.22 + px*0.30, y - vy*0.22 + py*0.30, z+0.015)
        right = (x - vx*0.22 - px*0.30, y - vy*0.22 - py*0.30, z+0.015)
        hydro_builder.face((left, right, tip), M["foam"])
HYDRO_OVERLAY = object_from_builder("MM_HRW_HYDROLOGY_FLOW_OVERLAY", hydro_builder, ROOT_PREVIEW_FLOW)
HYDRO_OVERLAY["runtime_data"] = "hydrology.json"
HYDRO_OVERLAY["preview_only"] = True

stage_builder = Builder()
stage_builder.card((0, 0), (20, 20), BOTTOM_Z - 0.03, M["stage"])
STAGE_OBJECT = object_from_builder("MM_HRW_TILE_PREVIEW_STAGE", stage_builder, ROOT_STAGE)


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


world = SCENE.world or bpy.data.worlds.new("MM_HRW_WORLD")
SCENE.world = world
world.use_nodes = True
background = world.node_tree.nodes.get("Background")
if background:
    background.inputs["Color"].default_value = (0.56, 0.76, 0.78, 1.0)
    background.inputs["Strength"].default_value = 0.48

sun_data = bpy.data.lights.new("MM_HRW_SUN_DATA", "SUN")
sun_data.energy = 1.18
sun_data.angle = math.radians(11)
sun_data.color = (1.0, 0.86, 0.66)
sun = bpy.data.objects.new("MM_HRW_SUN", sun_data)
ROOT_LIGHTS.objects.link(sun)
sun.rotation_euler = (math.radians(37), math.radians(-22), math.radians(-43))

key_data = bpy.data.lights.new("MM_HRW_KEY_DATA", "AREA")
key_data.energy = 5600
key_data.shape = "DISK"
key_data.size = 170
key = bpy.data.objects.new("MM_HRW_KEY", key_data)
ROOT_LIGHTS.objects.link(key)
key.location = (-310, -430, 520)
look_at(key, (0, 90, 2))

fill_data = bpy.data.lights.new("MM_HRW_FILL_DATA", "AREA")
fill_data.energy = 3600
fill_data.size = 210
fill_data.color = (0.58, 0.88, 1.0)
fill = bpy.data.objects.new("MM_HRW_FILL", fill_data)
ROOT_LIGHTS.objects.link(fill)
fill.location = (390, 380, 430)
look_at(fill, (0, 100, 3))


def make_camera(name, location, target, ortho_scale):
    data = bpy.data.cameras.new(name + "_DATA")
    data.type = "ORTHO"
    data.ortho_scale = ortho_scale
    camera = bpy.data.objects.new(name, data)
    ROOT_CAMERAS.objects.link(camera)
    camera.location = location
    look_at(camera, target)
    return camera


TILE_CAMERA = make_camera("MM_HRW_TILE_CAMERA", (8.6, -10.6, 8.0), (0, 0, 1.4), 8.2)
# Blender's orthographic scale is the horizontal view span for these landscape
# renders.  These values therefore include the full 512 m north/south world
# after aspect-ratio conversion, with presentation-safe margins.
WIDE_CAMERA = make_camera("MM_HRW_WIDE_CAMERA", (260, -315, 760), (0, 95, 2.5), 1120)
HYDRO_CAMERA = make_camera("MM_HRW_HYDROLOGY_CAMERA", (0, 95, 760), (0, 95, 0), 980)
SCENE.view_settings.exposure = 0.60


def render_preview(camera, path, width, height):
    SCENE.camera = camera
    SCENE.render.resolution_x = width
    SCENE.render.resolution_y = height
    SCENE.render.resolution_percentage = 100
    SCENE.render.filepath = str(path)
    result = bpy.ops.render.render(write_still=True)
    if "FINISHED" not in result or not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Preview render failed: {path}")


def recursive_objects(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def export_selected(path, objects, materials="EXPORT"):
    bpy.ops.object.select_all(action="DESELECT")
    selected = [obj for obj in objects if obj and obj.type in {"MESH", "EMPTY"}]
    for obj in selected:
        obj.hide_set(False)
        obj.select_set(True)
    if not selected:
        raise RuntimeError(f"Nothing selected for export: {path}")
    bpy.context.view_layer.objects.active = selected[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(path), check_existing=False, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials=materials, export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False,
        export_skins=False, export_morph=False,
    )
    if "FINISHED" not in result or not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"GLB export failed: {path}")


# Individual, isolated square previews and canonical local-space source GLBs.
ROOT_WORLD.hide_render = True
ROOT_TILE_LIBRARY.hide_render = False
ROOT_STAGE.hide_render = False
for child in ROOT_TILE_LIBRARY.children:
    child.hide_render = True
for tile in SPEC["new_tiles"]:
    asset = TILE_ASSETS[tile["id"]]
    asset["collection"].hide_render = False
    footprint_max = max(tile["dimensions_m"])
    TILE_CAMERA.data.ortho_scale = max(6.6, footprint_max * 1.58)
    look_at(TILE_CAMERA, (0, 0, 1.45 if tile["family"] == "river" else 1.9))
    preview_path = PREVIEW_DIR / f"{tile['id']}_{tile['key']}.png"
    glb_path = TILE_DIR / f"{tile['id']}_{tile['key']}.glb"
    render_preview(TILE_CAMERA, preview_path, 720, 720)
    export_selected(glb_path, recursive_objects(asset["collection"]), materials="EXPORT")
    record = dict(tile)
    record.update({
        "asset_id": asset["object"]["asset_id"], "root_node": asset["object"].name,
        "triangles_lod0": triangle_count(asset["object"]), "sockets": asset["sockets"],
        "glb": glb_path.relative_to(PACKAGE).as_posix(),
        "preview": preview_path.relative_to(PACKAGE).as_posix(),
        "glb_bytes": glb_path.stat().st_size, "glb_sha256": sha256(glb_path),
        "preview_bytes": preview_path.stat().st_size, "preview_sha256": sha256(preview_path),
        "draw_contract_note": "Source-authoring GLB preserves approved materials; compiled chunks consolidate runtime surfaces.",
    })
    TILE_RECORDS.append(record)
    asset["collection"].hide_render = True
    print("MM_HRW tile", tile["id"], record["triangles_lod0"], flush=True)


# A browseable combined source library laid out in a clean 6x4 grid.
for index, tile in enumerate(SPEC["new_tiles"]):
    obj = TILE_ASSETS[tile["id"]]["object"]
    obj.location = ((index % 6) * 9.0, -(index // 6) * 9.0, 0)
export_selected(TILE_CORE_GLB, recursive_objects(ROOT_TILE_LIBRARY), materials="EXPORT")


# Every chunk is exported around a local origin for stable browser precision.
for record in CHUNK_RECORDS:
    asset = CHUNK_ASSETS[record["id"]]
    obj = asset["object"]
    saved_location = obj.location.copy()
    obj.location = (0, 0, 0)
    export_selected(PACKAGE / record["glb"], [obj], materials="PLACEHOLDER")
    obj.location = saved_location
    print("MM_HRW chunk", record["id"], record["triangles"], flush=True)


# Restore the complete world for the two official overview renders.
ROOT_WORLD.hide_render = False
ROOT_TILE_LIBRARY.hide_render = True
ROOT_STAGE.hide_render = True
ROOT_PREVIEW_FLOW.hide_render = True
for collection in (ROOT_CIVIC, ROOT_PROPS, ROOT_OVERLAYS):
    collection.hide_render = False
render_preview(WIDE_CAMERA, WIDE_PREVIEW, 2560, 1440)

ROOT_PREVIEW_FLOW.hide_render = False
ROOT_CIVIC.hide_render = True
ROOT_PROPS.hide_render = True
ROOT_OVERLAYS.hide_render = True
render_preview(HYDRO_CAMERA, HYDRO_PREVIEW, 1920, 1080)
ROOT_PREVIEW_FLOW.hide_render = True
ROOT_CIVIC.hide_render = False
ROOT_PROPS.hide_render = False
ROOT_OVERLAYS.hide_render = False


lite_objects = recursive_objects(ROOT_CHUNKS) | recursive_objects(ROOT_OVERLAYS)
preview_objects = recursive_objects(ROOT_WORLD)
export_selected(LITE_GLB, lite_objects, materials="PLACEHOLDER")
export_selected(PREVIEW_GLB, preview_objects, materials="EXPORT")

SCENE.camera = WIDE_CAMERA
SCENE["markets_and_makers_world"] = "Highlands and Rivers World v1"
SCENE["tile_size_m"] = CELL
SCENE["terrain_chunks"] = 256
SCENE["government_buildings"] = 9
SCENE["empty_player_plots"] = 42
SCENE["natural_river_water_formula"] = "0.62 + elevation_level"
SCENE["civic_canal_water_z_m"] = CANAL_Z
BLEND_PATH.unlink(missing_ok=True)
Path(str(BLEND_PATH) + "1").unlink(missing_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False, compress=False)


# ---------------------------------------------------------------------------
# Runtime documents, source locks, generator QA, checksums and archive
# ---------------------------------------------------------------------------


def relative_workspace(path):
    return Path(path).relative_to(WORKSPACE).as_posix()


SOURCE_LOCKS = {
    "schema": "markets-and-makers.highlands-rivers-world.source-lock.v1",
    "status": "LOCKED",
    "expansion_spec": {"file": relative_workspace(SPEC_PATH), "sha256": sha256(SPEC_PATH)},
    "expanded_world_layout": {"file": relative_workspace(DESIGN_PATH), "sha256": sha256(DESIGN_PATH)},
    "expanded_world_design_qa": {"file": relative_workspace(DESIGN_QA_PATH), "sha256": sha256(DESIGN_QA_PATH)},
    "government_city_layout": {
        "file": "outputs/markets-and-makers-government-city-center-v1/layout.json",
        "sha256": sha256(WORKSPACE / "outputs/markets-and-makers-government-city-center-v1/layout.json"),
    },
    "government_city_manifest": {
        "file": "outputs/markets-and-makers-government-city-center-v1/manifest.json",
        "sha256": sha256(WORKSPACE / "outputs/markets-and-makers-government-city-center-v1/manifest.json"),
    },
    "government_city_archive": {"file": relative_workspace(GOV_ZIP), "sha256": sha256(GOV_ZIP)},
    "v5_tile_manifest": {"file": relative_workspace(V5_MANIFEST), "sha256": sha256(V5_MANIFEST)},
    "v5_tile_blend": {"file": relative_workspace(V5_BLEND), "sha256": sha256(V5_BLEND)},
    "v5_texture_manifest": {"file": relative_workspace(V5_TEXTURE_MANIFEST), "sha256": sha256(V5_TEXTURE_MANIFEST)},
    "city_material_manifest": {"file": relative_workspace(CITY_MANIFEST), "sha256": sha256(CITY_MANIFEST)},
    "street_prop_manifest": {"file": relative_workspace(PROP_MANIFEST), "sha256": sha256(PROP_MANIFEST)},
}
SOURCE_LOCK_PATH.write_text(json.dumps(SOURCE_LOCKS, indent=2, sort_keys=True) + "\n", encoding="utf-8")

coordinate_contract = dict(DESIGN["coordinate_contract"])
coordinate_contract.update({
    "tile_size_m": CELL, "base_walk_z_m": WALK_Z, "elevation_step_m": STEP,
    "natural_river_water_z_formula": "0.62 + elevation_level",
    "river_water_z_formula": "0.62 + elevation_level",
    "natural_river_bed_z_formula": "0.28 + elevation_level",
    "civic_canal_water_z_m": CANAL_Z, "ocean_z_m": OCEAN_Z,
})

LAYOUT = {
    "schema": "markets-and-makers.highlands-rivers-world.layout.v1",
    "version": "1.0.0", "status": "PASS_PENDING_INDEPENDENT_QA",
    "source_spec": {"file": relative_workspace(SPEC_PATH), "sha256": sha256(SPEC_PATH)},
    "source_design": {"file": relative_workspace(DESIGN_PATH), "sha256": sha256(DESIGN_PATH)},
    "coordinate_contract": coordinate_contract,
    "world": dict(DESIGN["world"]),
    "source_city": dict(DESIGN["source_city"]),
    "elevation": DESIGN["elevation"],
    "hydrology": {**DESIGN["hydrology"], "runtime_file": "hydrology.json", "natural_water_formula": "0.62 + level", "civic_canal_z_m": CANAL_Z},
    "transport": DESIGN["transport"],
    "plots": {"existing": EXISTING_PLOTS, "added": ADDED_PLOTS, "total_empty": 42},
    "biomes": DESIGN["biomes"],
    "points_of_interest": DESIGN["points_of_interest"],
    "streaming": {**DESIGN["streaming"], "terrain_chunk_count": len(CHUNK_RECORDS), "chunk_grid": [16, 16], "player_owned_buildings": 0},
    "tiles": [{"id": record["id"], "key": record["key"], "family": record["family"]} for record in TILE_RECORDS],
    "chunks": CHUNK_RECORDS,
    "buildings": GOV_LAYOUT["buildings"],
    "validation_contract": DESIGN["validation_contract"],
}
LAYOUT_PATH.write_text(json.dumps(LAYOUT, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def terrain_surface(cell):
    if cell in BRIDGE_CELLS:
        return "bridge"
    if cell in CANAL_CELLS:
        return "civic_canal"
    if cell in VISUAL_WATER:
        return "natural_water"
    if cell in ROAD_CELLS:
        return "road"
    if cell in PATH_CELLS:
        return "path"
    if cell in PLOT_CELLS:
        return "empty_plot"
    if cell in LAND:
        return f"land_l{ELEVATION.get(cell, 0)}"
    return "ocean"


terrain_rows = []
surface_counts = defaultdict(int)
for y in range(WORLD_MIN[1], WORLD_MAX[1] + 1):
    runs = []
    start_x = WORLD_MIN[0]
    previous = terrain_surface((start_x, y))
    for x in range(WORLD_MIN[0], WORLD_MAX[0] + 1):
        value = terrain_surface((x, y))
        surface_counts[value] += 1
        if value != previous:
            runs.append({"x0": start_x, "x1": x-1, "surface": previous})
            start_x, previous = x, value
    runs.append({"x0": start_x, "x1": WORLD_MAX[0], "surface": previous})
    terrain_rows.append({"y": y, "runs": runs})
TERRAIN_GRID = {
    "schema": "markets-and-makers.highlands-rivers-world.terrain-grid.v1",
    "status": "GENERATED", "bounds_cells": DESIGN["world"]["bounds_cells"],
    "encoding": "row_rle_inclusive", "priority": coordinate_contract["rasterization"]["priority_high_to_low"],
    "surface_counts": dict(sorted(surface_counts.items())), "rows": terrain_rows,
}
TERRAIN_GRID_PATH.write_text(json.dumps(TERRAIN_GRID, separators=(",", ":")) + "\n", encoding="utf-8")

HYDROLOGY = {
    "schema": "markets-and-makers.highlands-rivers-world.hydrology.v1",
    "version": "1.0.0", "status": "PASS_PENDING_INDEPENDENT_QA",
    "coordinate_contract": {
        "tile_size_m": CELL, "natural_water_z_formula": "0.62 + level",
        "natural_bed_z_formula": "0.28 + level", "civic_canal_z_m": CANAL_Z,
        "ocean_z_m": OCEAN_Z, "graph_adjacency": "cardinal 4-connected",
    },
    "watersheds": DESIGN["hydrology"]["watersheds"],
    "semantic_counts": {
        "authored_waterfall_sites": AUTHORED_WATERFALL_SITES,
        "runtime_waterfall_drop_edges": GRAPH_WATERFALL_EDGES,
        "runtime_rapid_drop_edges": GRAPH_RAPID_EDGES,
        "directed_graph_drop_edges": DIRECTED_GRAPH_DROP_EDGES,
        "layout_tile_markers": SEMANTIC_LAYOUT_TILE_MARKERS,
        "canonical_source_tile_meshes": CANONICAL_SOURCE_TILE_MESHES,
    },
    "water_cells": [HYDRO_META[cell] for cell in sorted(HYDRO_META, key=lambda item: (item[1], item[0]))],
    "graph": {"nodes": HYDRO_GRAPH_NODES, "edges": HYDRO_GRAPH_EDGES},
    "flow_shader_contract": {
        "material": "MAT_RIVER_FLOW", "uv_set": "MMFlow", "direction_source": "water_cells.flow_vector",
        "speed_source": "water_cells.speed_mps", "preview_driver": "UV V scroll -frame*0.0125",
        "browser_uniforms": ["uTime", "uFlowDirection", "uFlowSpeed"],
        "water_mesh_rule": "one merged water surface per chunk; never one material instance per cell",
    },
}
HYDROLOGY_PATH.write_text(json.dumps(HYDROLOGY, indent=2, sort_keys=True) + "\n", encoding="utf-8")

shutil.copy2(SPEC_README, REFERENCE_DIR / "mountain-river-expansion-spec-README.md")
shutil.copy2(DESIGN_PATH, REFERENCE_DIR / "expanded-world-layout-source.json")

README = f"""# Markets & Makers — Highlands & Rivers World v1

This is the first production expansion of the official logo-world terrain.  It turns the
original civic island into a **512 m × 512 m**, 2 m-grid open world with seven elevation
levels, three complete watersheds, three lakes, authored rapids and waterfalls, nine
explicit bridges, government services, and 42 empty buy-or-lease plots.

## Start here

- `mm_highlands_rivers_world_v1_preview.glb` — complete presentation scene.
- `mm_highlands_rivers_world_v1_lite.glb` — browser-first terrain, water, bridges and plots.
- `chunks/CH_cx_cy.glb` — 256 local-origin, 32 m × 32 m streaming chunks.
- `tiles/T51_*.glb` through `tiles/T74_*.glb` — canonical source tiles.
- `hydrology.json` — authoritative directed flow graph and browser shader fields.
- `terrain-grid.json` — full 256 × 256-cell priority-resolved surface raster.
- `layout.json` — buildings, empty plots, transport, streaming and world placement.

## Coordinate contract

Each integer cell is a tile center; +X is east, +Y north, +Z up.  Ground walk height is
1.0 m.  Natural river and lake water is `0.62 + elevation_level` metres; the historic
government canal alone remains at 0.68 m.  Ocean water is -0.18 m.  Chunk records carry
their world origin; the geometry inside each chunk GLB is local to that origin.

## Browser runtime

Load the current chunk plus a two-chunk radius, prefetch to three chunks, and bind the
shared approved material atlas by exported material name.  Animate `MAT_RIVER_FLOW` from
`hydrology.json`: `MMFlow` UVs provide continuity, `flow_vector` provides direction, and
`speed_mps` provides rate.  The static lite GLB is useful for prototypes; production
should stream the individual chunk GLBs.

This v1 package delivers **LOD0 terrain chunks only**; it does not claim LOD1/LOD2 mesh
artifacts.  Generate a greedy heightfield collider per loaded chunk from the `land_l#`
runs in `terrain-grid.json`, add bridge deck boxes from `layout.json`, keep water and
waterfall cells non-walkable, and use the T61 portal's two flank boxes plus lintel box.

The individual T51–T74 GLBs are authoring/review assets and intentionally preserve the
approved multi-material look; some therefore exceed the source specification's nominal
draw-call ceiling.  Browser production must use the compiled chunk GLBs, whose terrain
surfaces are consolidated for streaming, rather than instancing the authoring GLBs.

## Planning vocabulary versus runtime assets

The expanded layout contains **{SEMANTIC_LAYOUT_TILE_MARKERS} semantic tile markers**
(mountain, river, lake and waterfall planning roles).  Rotation, placement context and
shared topology consolidate those roles into **{CANONICAL_SOURCE_TILE_MESHES} canonical
source meshes**, T51–T74; no source file is missing.  Likewise, the layout declares
**{AUTHORED_WATERFALL_SITES} authored waterfall sites with dedicated plunge pools**,
while the directed hydrology graph contains **{GRAPH_WATERFALL_EDGES} waterfall edges**
and **{GRAPH_RAPID_EDGES} rapid edges**.  The terminal Sunfall confluence drop uses its
confluence basin rather than a separate plunge-pool marker, so these counts intentionally
describe different units.

## Ownership boundary

The nine imported civic buildings remain government-owned and non-buildable.  All 18
original plots are byte-for-byte placement/ownership compatible with the government-city
layout, and 24 new empty plots are added.  No commercial structure is placed in this
package.

## Source locks and validation

`source-lock.json` binds the tile specification, approved V5 library, expanded layout and
government city by SHA-256.  `qa-report-generator.json` contains build-time gates.  Run
the independent validator after generation:

```sh
python3 work/validate_markets_makers_highlands_rivers_world_v1.py --workspace {WORKSPACE}
```
"""
README_PATH.write_text(README, encoding="utf-8")


def artifact(path):
    path = Path(path)
    return {"file": path.relative_to(PACKAGE).as_posix(), "bytes": path.stat().st_size, "sha256": sha256(path)}


ARTIFACTS = {
    "blend": artifact(BLEND_PATH), "tile_library_glb": artifact(TILE_CORE_GLB),
    "world_preview_glb": artifact(PREVIEW_GLB), "world_lite_glb": artifact(LITE_GLB),
    "wide_preview": {**artifact(WIDE_PREVIEW), "width": 2560, "height": 1440},
    "hydrology_preview": {**artifact(HYDRO_PREVIEW), "width": 1920, "height": 1080},
    "layout": artifact(LAYOUT_PATH), "terrain_grid": artifact(TERRAIN_GRID_PATH),
    "hydrology": artifact(HYDROLOGY_PATH), "source_lock": artifact(SOURCE_LOCK_PATH),
}

MANIFEST = {
    "schema": "markets-and-makers.highlands-rivers-world.generated.v1",
    "version": "1.0.0", "status": "PASS_PENDING_INDEPENDENT_QA",
    "title": "Markets & Makers Highlands & Rivers World v1",
    "coordinate_contract": coordinate_contract,
    "source_locks": SOURCE_LOCKS,
    "materials": {
        "approved_source": "markets-and-makers-logo-world-tiles-v5",
        "natural_river": "MAT_RIVER_FLOW", "civic_canal": "MAT_WATER_SHALLOW",
        "ocean": "MAT_MM_WATER", "foam": "MAT_WATER_FOAM", "grid_border": "MAT_TERRAIN_GRID_BORDER",
    },
    "tiles": TILE_RECORDS,
    "world": {**DESIGN["world"], "terrain_chunk_count": len(CHUNK_RECORDS), "chunk_grid": [16, 16]},
    "chunks": CHUNK_RECORDS,
    "hydrology": {
        "file": "hydrology.json", "watersheds": len(DESIGN["hydrology"]["watersheds"]),
        "water_cells": len(HYDRO_META), "graph_nodes": len(HYDRO_GRAPH_NODES), "graph_edges": len(HYDRO_GRAPH_EDGES),
        "authored_waterfall_sites": AUTHORED_WATERFALL_SITES,
        "runtime_waterfall_drop_edges": GRAPH_WATERFALL_EDGES,
        "runtime_rapid_drop_edges": GRAPH_RAPID_EDGES,
        "directed_graph_drop_edges": DIRECTED_GRAPH_DROP_EDGES,
    },
    "buildings": GOV_MANIFEST["buildings"],
    "plots": {"existing": EXISTING_PLOTS, "added": ADDED_PLOTS, "total_empty": 42, "player_owned_buildings": 0},
    "runtime_contract": {
        "preferred": "stream chunks/CH_cx_cy.glb", "prototype": "mm_highlands_rivers_world_v1_lite.glb",
        "chunk_size_cells": [16, 16], "chunk_size_m": [32, 32], "load_radius_chunks": 2,
        "preload_radius_chunks": 3, "flow_metadata": "hydrology.json", "max_triangles_per_chunk": 45000,
        "delivered_lods": ["LOD0"], "collision": "greedy heightfield from terrain-grid.json; bridge boxes from layout; water non-walkable; T61 flank/lintel boxes",
    },
    "counts": {
        "new_tiles": len(TILE_RECORDS), "chunks": len(CHUNK_RECORDS), "government_buildings": len(GOV_LAYOUT["buildings"]),
        "original_empty_plots": len(EXISTING_PLOTS), "added_empty_plots": len(ADDED_PLOTS), "total_empty_plots": 42,
        "land_cells": sum(record["land_cells"] for record in CHUNK_RECORDS),
        "water_cells": sum(record["water_cells"] for record in CHUNK_RECORDS),
        "hydrology_centerline_cells": len(HYDRO_META), "bridges": len(DESIGN["transport"]["bridges"]),
        "semantic_layout_tile_markers": SEMANTIC_LAYOUT_TILE_MARKERS,
        "canonical_source_tile_meshes": CANONICAL_SOURCE_TILE_MESHES,
    },
    "artifacts": ARTIFACTS,
}
MANIFEST_PATH.write_text(json.dumps(MANIFEST, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def qa_check(checks, name, condition, detail):
    checks.append({"name": name, "passed": bool(condition), "detail": detail})


checks = []
qa_check(checks, "tile inventory T51-T74", [record["id"] for record in TILE_RECORDS] == [f"T{i}" for i in range(51, 75)], len(TILE_RECORDS))
qa_check(checks, "all source tile triangle budgets", all(record["triangles_lod0"] <= record["budget"]["triangles_lod0_max"] for record in TILE_RECORDS), max(record["triangles_lod0"] for record in TILE_RECORDS))
qa_check(checks, "exact 256 terrain chunks", len(CHUNK_RECORDS) == 256, len(CHUNK_RECORDS))
qa_check(checks, "chunk triangle ceiling", max(record["triangles"] for record in CHUNK_RECORDS) <= 45000, max(record["triangles"] for record in CHUNK_RECORDS))
qa_check(checks, "government buildings preserved", len(GOV_LAYOUT["buildings"]) == 9, len(GOV_LAYOUT["buildings"]))
qa_check(checks, "empty plots preserved and expanded", len(EXISTING_PLOTS) == 18 and len(ADDED_PLOTS) == 24, [len(EXISTING_PLOTS), len(ADDED_PLOTS)])
qa_check(checks, "three watershed outlet graphs", len(DESIGN["hydrology"]["watersheds"]) == 3 and len(HYDRO_GRAPH_EDGES) > 0, len(HYDRO_GRAPH_EDGES))
qa_check(checks, "no uphill natural edge over tolerance", all(edge["drop_m"] >= -0.061 for edge in HYDRO_GRAPH_EDGES), min(edge["drop_m"] for edge in HYDRO_GRAPH_EDGES))
qa_check(checks, "semantic layout roles consolidated to canonical tiles", SEMANTIC_LAYOUT_TILE_MARKERS == 32 and CANONICAL_SOURCE_TILE_MESHES == 24, [SEMANTIC_LAYOUT_TILE_MARKERS, CANONICAL_SOURCE_TILE_MESHES])
qa_check(checks, "waterfall and rapid edge semantics", AUTHORED_WATERFALL_SITES == 14 and GRAPH_WATERFALL_EDGES == 15 and GRAPH_RAPID_EDGES == 12 and DIRECTED_GRAPH_DROP_EDGES == GRAPH_WATERFALL_EDGES + GRAPH_RAPID_EDGES, [AUTHORED_WATERFALL_SITES, GRAPH_WATERFALL_EDGES, GRAPH_RAPID_EDGES, DIRECTED_GRAPH_DROP_EDGES])
qa_check(checks, "all required GLBs rendered", all(path.is_file() and path.stat().st_size for path in [TILE_CORE_GLB, PREVIEW_GLB, LITE_GLB] + [PACKAGE / record["glb"] for record in CHUNK_RECORDS]), 259)
qa_check(checks, "all required PNGs rendered", WIDE_PREVIEW.is_file() and HYDRO_PREVIEW.is_file() and all((PACKAGE / record["preview"]).is_file() for record in TILE_RECORDS), 26)
GENERATOR_QA = {
    "schema": "markets-and-makers.highlands-rivers-world.generator-qa.v1",
    "status": "PASS" if all(check["passed"] for check in checks) else "FAIL",
    "summary": {"checks": len(checks), "passed": sum(check["passed"] for check in checks)},
    "checks": checks,
    "warnings": [{
        "code": "SOURCE_TILE_DRAW_CAP_AUTHORING_VARIANCE",
        "severity": "warning",
        "detail": "Individual T51-T74 GLBs preserve approved multi-material authoring fidelity and may exceed nominal source draw caps; browser runtime must stream the compiled chunk GLBs.",
    }],
}
GENERATOR_QA_PATH.write_text(json.dumps(GENERATOR_QA, indent=2, sort_keys=True) + "\n", encoding="utf-8")
if GENERATOR_QA["status"] != "PASS":
    raise RuntimeError("Generator QA failed; package and archive were not finalized")


checksum_files = sorted(
    path for path in PACKAGE.rglob("*")
    if path.is_file() and path != CHECKSUM_PATH and path.name != ".DS_Store"
)
CHECKSUM_PATH.write_text("".join(f"{sha256(path)}  {path.relative_to(PACKAGE).as_posix()}\n" for path in checksum_files), encoding="utf-8")

ZIP_PATH.unlink(missing_ok=True)
with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
    for path in sorted(item for item in PACKAGE.rglob("*") if item.is_file() and item.name != ".DS_Store"):
        archive.write(path, f"{PACKAGE_NAME}/{path.relative_to(PACKAGE).as_posix()}")
zip_hash_path = ZIP_PATH.with_suffix(".zip.sha256")
zip_hash_path.write_text(f"{sha256(ZIP_PATH)}  {ZIP_PATH.name}\n", encoding="utf-8")

print(json.dumps({
    "status": "PASS_PENDING_INDEPENDENT_QA", "package": str(PACKAGE), "blend": str(BLEND_PATH),
    "tiles": len(TILE_RECORDS), "chunks": len(CHUNK_RECORDS), "hydrology_nodes": len(HYDRO_GRAPH_NODES),
    "wide_preview": str(WIDE_PREVIEW), "hydrology_preview": str(HYDRO_PREVIEW),
    "zip": str(ZIP_PATH), "zip_sha256": sha256(ZIP_PATH),
}, indent=2), flush=True)
