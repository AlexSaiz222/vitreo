"""Vitreo - export the diorama to glTF (docs/04, part 7).

Exports the collections the app reads (structure, plants, helpers, devices, decor)
from assets/blender/vitreo.blend to assets/export/vitreo.glb, with the
settings of docs/04. The preview collection (camera, sun, page) stays out.
Nothing is saved to the .blend.

Inside Blender: run it from the Scripting tab with vitreo.blend open.
From a terminal (no window):

    blender -b assets/blender/vitreo.blend --python assets/blender/scripts/export_vitreo.py
    blender -b ... --python ... -- --out some/other/path.glb

Then `pnpm models` checks the naming contract and optimises it for the app.
"""
import os
import sys

import bpy

COLLECTIONS = ("structure", "plants", "helpers", "devices", "decor")
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else None
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..")) if HERE else None

# docs/04, "Exportar desde Blender".
SETTINGS = dict(
    export_format="GLB",
    use_selection=True,
    export_extras=True,              # the "lightmap" mark of baked objects (docs/04, part 5)
    export_yup=True,
    export_apply=True,               # apply modifiers (bevels)
    export_normals=True,
    export_texcoords=True,
    export_vertex_color="ACTIVE",    # the "tone" colour attribute -> COLOR_0
    export_attributes=True,          # custom attributes starting with "_" (_WIND)
    export_morph=True,               # shape keys: wilt, open
    export_morph_normal=True,
    export_materials="EXPORT",       # names only matter: the app uses the tokens
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_draco_mesh_compression_enable=False,  # pnpm models compresses
)


def output_path():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" in argv:
        return os.path.abspath(argv[argv.index("--out") + 1])
    if REPO is None:
        raise RuntimeError("Run as a file (or pass -- --out <path>) so the repository is known")
    return os.path.join(REPO, "assets", "export", "vitreo.glb")


def main():
    out = output_path()
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for name in COLLECTIONS:
        collection = bpy.data.collections.get(name)
        if collection is None:
            print(f"! collection '{name}' not found, skipped")
            continue
        for obj in collection.all_objects:
            obj.select_set(True)
            count += 1

    # Option names change between Blender versions: keep the known ones and
    # say which are missing, rather than failing or silently ignoring them.
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    settings = {k: v for k, v in SETTINGS.items() if k in known}
    for missing in sorted(set(SETTINGS) - set(settings)):
        print(f"! this Blender has no export option '{missing}': check docs/04")

    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, **settings)
    print(f"Exported {count} objects to {out}")


if __name__ == "__main__":
    main()
