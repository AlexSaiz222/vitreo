"""Vitreo - bake lightmaps (docs/04, part 5). Run after build_greenhouse.py.

Pipeline:  build_greenhouse.py  ->  bake_lightmaps.py  ->  export (pnpm models:export)

What it does
- Gives the static, light-receiving meshes one shared lightmap UV ("UVMap_Light",
  TEXCOORD_0 in glTF) packed into a single atlas.
- Bakes LIGHT ONLY (Cycles Diffuse, direct + indirect, no colour): the app multiplies
  the token colour by the lightmap, so tokens, wet soil and selection dimming still work.
- Three atlases on the same UVs: day (sun + sky), night (moon + soft warm interior)
  and lamp (grow light alone; the app adds it when growLight is on).
- Stores them as 8-bit sRGB PNGs, normalised; the scale to recover linear light is
  written to lightmaps.json ("intensity": multiply the decoded texture by it).
- Tags baked objects with the custom property "lightmap" = True (glTF extras).
Moving parts (vent, fan blades, door leaf), glass, foliage and small devices are not baked.
"""
import bpy, bmesh, json, math, os
import numpy as np

RES = int(os.environ.get("VITREO_LM_RES", "2048"))
MARGIN_PX = 16
SAMPLES = int(os.environ.get("VITREO_LM_SAMPLES", "512"))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.path.dirname(bpy.data.filepath)
OUT = os.path.join(os.path.dirname(HERE), "textures")
# gutter is thin and half-open: its bake came out as a black stripe -> dynamic/probe light
BAKE = ["base", "gravel", "path", "steps", "floor_main", "frame_main",
        "decor_ground"]
# Hidden while baking: the vent moves (its shadow would stay printed on the rafters),
# and the preview page under the plinth (the app draws its own contact shadow).
HIDE = ["vent_window", "preview_page"]
# Foliage casts no hard shadow into the bake (it only adds soft occlusion through
# bounced light): hard leaf shadows looked like dark stains on soil and sand.
SOFT = ("foliage_", "decor_plants")
UV = "UVMap_Light"


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def objects():
    pots = sorted(o.name for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(("pot_", "soil_")))
    return [bpy.data.objects[n] for n in BAKE + pots if n in bpy.data.objects]


def setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "NONE"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if kind == "NONE" or any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                break
        except Exception:
            continue
    sc.cycles.device = "GPU" if prefs.compute_device_type != "NONE" else "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.render.bake.use_pass_color = False
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.margin = MARGIN_PX
    try:
        sc.render.bake.margin_type = "EXTEND"
    except Exception:
        pass
    sc.render.bake.use_clear = True
    sc.render.bake.target = "IMAGE_TEXTURES"


def make_uvs(objs):
    for o in objs:
        me = o.data
        if me.users > 1:
            o.data = me.copy()
            me = o.data
        old = me.uv_layers.get(UV)
        if old:
            me.uv_layers.remove(old)
        uv = me.uv_layers.new(name=UV)
        me.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=1.2 * MARGIN_PX / RES)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        o["lightmap"] = True


def target_image(name):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    return bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=True)


def attach(objs, img):
    mats = {s.material for o in objs for s in o.material_slots if s.material}
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get("lm_target") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "lm_target"
        n.image = img
        nt.nodes.active = n
    return mats


def detach(mats):
    for m in mats:
        n = m.node_tree.nodes.get("lm_target")
        if n:
            m.node_tree.nodes.remove(n)


def lights(mode):
    """Set the preview lights for one atlas."""
    sc = bpy.context.scene
    ob = bpy.data.objects
    sun, lamp, bounce = ob["preview_sun"], ob["preview_lamp"], ob.get("preview_bounce")
    strip = bpy.data.materials["light_strip"].node_tree.nodes["Principled BSDF"]
    bg = sc.world.node_tree.nodes["Background"]
    if bounce:
        bounce.hide_render = True                       # Cycles computes the real bounce
    moon = ob.get("bake_moon")
    glow = ob.get("bake_nightglow")
    if moon is None:
        ld = bpy.data.lights.new("bake_moon", "SUN")
        moon = bpy.data.objects.new("bake_moon", ld)
        moon.rotation_euler = sun.rotation_euler.copy()
        bpy.data.collections["preview"].objects.link(moon)
    if glow is None:
        ld = bpy.data.lights.new("bake_nightglow", "AREA")
        glow = bpy.data.objects.new("bake_nightglow", ld)
        glow.location = lamp.location.copy()
        ld.shape, ld.size, ld.size_y = "RECTANGLE", lamp.data.size, 0.2
        bpy.data.collections["preview"].objects.link(glow)
    moon.data.color, moon.data.energy, moon.data.angle = lin("9fb0d0"), 0.35, math.radians(12)
    glow.data.color, glow.data.energy = lin("ffd9a8"), 1.6
    sun.hide_render = mode != "day"
    moon.hide_render = mode != "night"
    glow.hide_render = mode != "night"
    lamp.hide_render = mode != "lamp"
    strip.inputs["Emission Strength"].default_value = 2.5 if mode == "lamp" else 0.0
    lamp.data.energy = 1.5 if mode == "lamp" else lamp.data.energy
    if mode == "day":
        bg.inputs[0].default_value, bg.inputs[1].default_value = (*lin("f4ece1"), 1.0), 0.62
    elif mode == "night":
        bg.inputs[0].default_value, bg.inputs[1].default_value = (*lin("1c2433"), 1.0), 0.35
    else:
        bg.inputs[1].default_value = 0.0


def restore_preview():
    ob = bpy.data.objects
    for n in ("preview_sun", "preview_lamp", "preview_bounce"):
        if ob.get(n):
            ob[n].hide_render = False
    for n in ("bake_moon", "bake_nightglow"):
        if ob.get(n):
            ob[n].hide_render = True
    lights("day")
    ob["preview_sun"].hide_render = False
    ob["preview_lamp"].hide_render = False
    if ob.get("preview_bounce"):
        ob["preview_bounce"].hide_render = False
    bpy.data.materials["light_strip"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.5
    ob["preview_lamp"].data.energy = 3.2


def save_8bit(img, path):
    px = np.empty(RES * RES * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)[:, :3]
    peak = float(np.percentile(px.max(axis=1), 99.5)) or 1.0
    scale = 0.95 / peak
    v = np.clip(px * scale, 0, 1)
    v = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)   # sRGB encode
    out = bpy.data.images.new(os.path.basename(path), RES, RES, alpha=False)
    out.colorspace_settings.name = "Non-Color"            # already encoded: write as is
    rgba = np.ones((RES * RES, 4), dtype=np.float32)
    rgba[:, :3] = v
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    return 1.0 / scale


def hide_for_bake(on):
    for n in HIDE:
        o = bpy.data.objects.get(n)
        if o:
            o.hide_render = on
    for o in bpy.data.objects:
        if o.name.startswith(SOFT):
            o.visible_shadow = not on


def bake(modes=("day", "night", "lamp")):
    os.makedirs(OUT, exist_ok=True)
    setup_cycles()
    objs = objects()
    make_uvs(objs)
    hide_for_bake(True)
    meta_path = os.path.join(OUT, "lightmaps.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    meta.update({"uv": UV, "resolution": RES, "colorSpace": "srgb", "objects": [o.name for o in objs]})
    for mode in modes:
        lights(mode)
        img = target_image("lm_" + mode)
        mats = attach(objs, img)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, use_clear=True, margin=MARGIN_PX)
        detach(mats)
        meta.setdefault("atlases", {})[mode] = {
            "file": "lightmap_%s.png" % mode,
            "intensity": round(save_8bit(img, os.path.join(OUT, "lightmap_%s.png" % mode)), 5)}
    json.dump(meta, open(meta_path, "w"), indent=2)
    hide_for_bake(False)
    restore_preview()
    return meta


if __name__ == "__main__":
    bake()
