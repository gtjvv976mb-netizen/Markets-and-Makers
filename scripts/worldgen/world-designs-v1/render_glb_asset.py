#!/usr/bin/env python3
"""Render one decoded GLB on a consistent Full-HD studio stage in Blender."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--name", required=True)
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(values)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def combined_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum


def add_area(name: str, location: tuple[float, float, float], energy: float, size: float, color: tuple[float, float, float]) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, Vector((0.0, 0.0, 1.0)))


def main() -> None:
    args = arguments()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input), import_shading="NORMALS")

    imported = list(bpy.context.scene.objects)
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No meshes imported from {args.input}")

    minimum, maximum = combined_bounds(meshes)
    center = (minimum + maximum) * 0.5
    container = bpy.data.objects.new("MM_ASSET_ROOT", None)
    bpy.context.collection.objects.link(container)
    imported_set = set(imported)
    for obj in imported:
        if obj.parent not in imported_set:
            world_matrix = obj.matrix_world.copy()
            obj.parent = container
            obj.matrix_world = world_matrix
    container.location = (-center.x, -center.y, -minimum.z)
    bpy.context.view_layer.update()
    minimum, maximum = combined_bounds(meshes)
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    for obj in meshes:
        obj.visible_shadow = True

    # A slightly warm, logo-compatible studio stage makes every asset readable
    # while preserving the authored PBR colours and silhouettes.
    world = bpy.data.worlds.new("MM_SOLARPUNK_STUDIO")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.82, 0.89, 0.86, 1.0)
    background.inputs["Strength"].default_value = 0.42
    bpy.context.scene.world = world

    bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y, size.z) * 12.0, location=(0, 0, -0.015))
    stage = bpy.context.object
    stage.name = "MM_STUDIO_GROUND"
    material = bpy.data.materials.new("MM_WARM_STONE_STAGE")
    material.diffuse_color = (0.78, 0.74, 0.63, 1.0)
    material.roughness = 0.9
    stage.data.materials.append(material)

    extent = max(size.x, size.y, size.z, 0.1)
    add_area("MM_KEY", (-extent * 4.0, -extent * 4.5, extent * 6.0), 650.0, extent * 4.0, (1.0, 0.78, 0.48))
    add_area("MM_FILL", (extent * 4.0, -extent * 2.0, extent * 3.0), 360.0, extent * 3.0, (0.48, 0.9, 0.88))
    add_area("MM_RIM", (extent * 2.0, extent * 4.0, extent * 5.0), 500.0, extent * 3.0, (0.82, 0.96, 0.72))

    camera_data = bpy.data.cameras.new("MM_FHD_CAMERA")
    camera = bpy.data.objects.new("MM_FHD_CAMERA", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = center + Vector((extent * 4.8, -extent * 6.2, extent * 4.4))
    look_at(camera, center)
    camera_data.type = "ORTHO"
    camera_data.lens = 55
    bpy.context.scene.camera = camera
    bpy.context.view_layer.update()
    camera_inverse = camera.matrix_world.inverted()
    camera_points = [camera_inverse @ (obj.matrix_world @ Vector(corner)) for obj in meshes for corner in obj.bound_box]
    projected_center_x = (min(point.x for point in camera_points) + max(point.x for point in camera_points)) * 0.5
    projected_center_y = (min(point.y for point in camera_points) + max(point.y for point in camera_points)) * 0.5
    camera_axes = camera.matrix_world.to_3x3()
    camera.location += (camera_axes @ Vector((1.0, 0.0, 0.0))) * projected_center_x
    camera.location += (camera_axes @ Vector((0.0, 1.0, 0.0))) * projected_center_y
    bpy.context.view_layer.update()
    camera_inverse = camera.matrix_world.inverted()
    camera_points = [camera_inverse @ (obj.matrix_world @ Vector(corner)) for obj in meshes for corner in obj.bound_box]
    vertical_span = max(point.y for point in camera_points) - min(point.y for point in camera_points)
    horizontal_span = max(point.x for point in camera_points) - min(point.x for point in camera_points)
    camera_data.ortho_scale = max(horizontal_span, vertical_span * (1920 / 1080), 0.5) * 1.16

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.filepath = str(args.output)
    scene.render.use_file_extension = True
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.25
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 64
    scene.render.use_compositing = True
    scene.render.use_sequencer = False

    # Contact shadows and a high sample count keep fine foliage and railings
    # stable at 1080p without the cost of offline path tracing.
    scene.render.image_settings.compression = 38
    scene.render.film_transparent = False
    scene.render.filepath = str(args.output)
    bpy.ops.render.render(write_still=True)
    print(f"MM_RENDER_OK {args.name} {args.output} {size.x:.5f} {size.y:.5f} {size.z:.5f}")


if __name__ == "__main__":
    main()
