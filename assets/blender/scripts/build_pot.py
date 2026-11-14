"""Vitreo - pot exercise (docs/04, part 1): terracotta pot, soil and a seedling.

Run from Blender's Scripting tab (or via MCP). Rebuilds plant_<PLANT_ID> inside
the "plants" collection and a throwaway "preview" collection (floor, sun, camera).
Units: metres, Z up. Pot base at the object origin.

Naming contract (docs/04, part 3):
  plant_<id>  (empty) -> pot_<id>, soil_<id>, foliage_<id> (shape key "wilt")
Foliage colour attribute "wind": R = how much it sways (0 base, 1 tip).
"""
import bpy, bmesh, math
from mathutils import Matrix, Vector

PLANT_ID = "basil_01"

# Same numbers as apps/web/src/scene/dimensions.ts (POT) and Pot.tsx.
POT_HEIGHT = 0.21
SOIL_DEPTH = 0.02
SOIL_TOP = POT_HEIGHT - SOIL_DEPTH
SOIL_RADIUS = 0.129
SEGMENTS = 32

# apps/web/src/styles/tokens.css (--scene-*)
PALETTE = {
    "terracotta": "#bb7547", "soilDry": "#b39a7c", "soilWet": "#3a281e",
    "leafLight": "#abac68", "leafMid": "#849050", "leafDeep": "#687a3f",
    "frame": "#f1ece3", "sky": "#f3ece2", "sun": "#ffdbba",
}
# Preview only: the app tints the soil from the moisture reading.
SOIL_PREVIEW_MOISTURE = 0.75

# Pot profile (radius, height), from the bottom centre, up the outside, over
# the rolled rim and down the inner wall. Close pairs are support loops that
# keep corners crisp under the Subdivision modifier.
POT_PROFILE = [
    (0.0, 0.0), (0.07, 0.0), (0.092, 0.0), (0.098, 0.002), (0.100, 0.008),
    (0.101, 0.020), (0.108, 0.070), (0.116, 0.120), (0.124, 0.162),
    (0.126, 0.168), (0.132, 0.171), (0.141, 0.172), (0.145, 0.176),
    (0.146, 0.182), (0.147, 0.198), (0.146, 0.206), (0.142, 0.210),
    (0.136, 0.210), (0.131, 0.207), (0.129, 0.200), (0.126, 0.175),
    (0.124, 0.165), (0.09, 0.164), (0.0, 0.164),
]

# Basil seedling (ref-03): short stem, two broad leaves and a smaller new one.
# It stays narrower than the pot mouth so the soil reads from the iso camera.
STEM = dict(height=0.055, r0=0.0065, r1=0.005, sides=8, rings=5)
LEAVES = [
    dict(angle=0.78, length=0.088, width=0.068, lift=0.72, mat=1),
    dict(angle=0.78 + math.pi, length=0.088, width=0.068, lift=0.72, mat=1),
    dict(angle=2.2, length=0.06, width=0.05, lift=1.1, mat=2),
]
LEAF_THICKNESS = 0.010


def lin(v):
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def rgb(hex_):
    h = hex_.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def rgba(hex_, mix_with=None, t=0.0):
    c = rgb(hex_)
    if mix_with:
        c = [a + (b - a) * t for a, b in zip(c, rgb(mix_with))]
    return (*[lin(v) for v in c], 1.0)


def material(name, color, roughness=0.85):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = color
    return m


def collection(name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
    return col


def remove(name):
    o = bpy.data.objects.get(name)
    if o:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            bpy.data.meshes.remove(data) if isinstance(data, bpy.types.Mesh) else None


def link(obj, col, parent=None):
    col.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def smooth(mesh):
    for p in mesh.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- geometry

def lathe_mesh(name, profile, segments):
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
                   angle=2 * math.pi, steps=segments, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def soil_mesh(name):
    """Slightly domed, gently lumpy disc; its sides hide inside the pot wall."""
    rings = [(0.35, 0.0038), (0.70, 0.0026), (0.92, 0.0010), (1.0, -0.002), (1.0, -0.018)]
    verts = [(0.0, 0.0, 0.004)]
    for frac, dz in rings:
        for j in range(SEGMENTS):
            a = 2 * math.pi * j / SEGMENTS
            lump = 0.0009 * math.sin(3 * a + frac * 7) * math.sin(5 * a) if frac < 1 else 0
            r = SOIL_RADIUS * frac
            verts.append((r * math.cos(a), r * math.sin(a), dz + lump))
    verts.append((0.0, 0.0, -0.018))
    faces = []
    ring = lambda i, j: 1 + i * SEGMENTS + j % SEGMENTS
    for j in range(SEGMENTS):
        faces.append((0, ring(0, j), ring(0, j + 1)))
    for i in range(len(rings) - 1):
        for j in range(SEGMENTS):
            faces.append((ring(i, j), ring(i + 1, j), ring(i + 1, j + 1), ring(i, j + 1)))
    bottom = len(verts) - 1
    last = len(rings) - 1
    for j in range(SEGMENTS):
        faces.append((bottom, ring(last, j + 1), ring(last, j)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    return mesh


def foliage_geometry(w):
    """Stem + leaves as one mesh. w = wilt (0 healthy, 1 wilted); the vertex
    count never changes, so w=1 can be stored as a shape key."""
    verts, faces, mats, wind = [], [], [], []
    H = STEM["height"] * (1 - 0.12 * w)
    bend = 0.03 * w
    sides, rings = STEM["sides"], STEM["rings"]

    def stem_point(t):
        return Vector((bend * t * t, 0.0, H * t))

    for i in range(rings):
        t = i / (rings - 1)
        c = stem_point(t)
        r = STEM["r0"] + (STEM["r1"] - STEM["r0"]) * t
        for j in range(sides):
            a = 2 * math.pi * j / sides
            verts.append(c + Vector((r * math.cos(a), r * math.sin(a), 0)))
            wind.append(0.4 * t)
    for i in range(rings - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides)); mats.append(0)
    cap = len(verts)
    verts.append(stem_point(1) + Vector((0, 0, 0.002))); wind.append(0.4)
    top0 = (rings - 1) * sides
    for j in range(sides):
        faces.append((top0 + j, top0 + (j + 1) % sides, cap)); mats.append(0)

    tip = stem_point(1)
    R, S = 10, 12
    for leaf in LEAVES:
        L = leaf["length"] * (1 - 0.08 * w)
        W = leaf["width"]
        lift = leaf["lift"] * (1 - w) - 0.12 * w
        cup = 0.45 * (1 - 0.6 * w)
        arch = 0.12 + 0.22 * w
        rot = Matrix.Rotation(leaf["angle"], 3, "Z") @ Matrix.Rotation(-lift, 3, "Y")

        def local(theta, phi):
            s = (1 - math.cos(theta)) / 2
            taper = 1 - 0.5 * s ** 3
            y = W / 2 * math.sin(theta) * math.cos(phi) * taper
            z = LEAF_THICKNESS / 2 * math.sin(theta) * math.sin(phi)
            z += cup * W * 0.5 * (y / (W / 2)) ** 2
            z -= arch * L * s * s
            return Vector((L * s, y, z)), s

        base = len(verts)
        p, s = local(0, 0)
        verts.append(tip + rot @ p); wind.append(0.4)
        for k in range(1, R):
            theta = math.pi * k / R
            for j in range(S):
                p, s = local(theta, 2 * math.pi * j / S)
                verts.append(tip + rot @ p); wind.append(0.4 + 0.6 * s)
        p, s = local(math.pi, 0)
        verts.append(tip + rot @ p); wind.append(1.0)
        end = len(verts) - 1
        ring = lambda k, j: base + 1 + (k - 1) * S + j % S
        for j in range(S):
            faces.append((base, ring(1, j + 1), ring(1, j))); mats.append(leaf["mat"])
        for k in range(1, R - 1):
            for j in range(S):
                faces.append((ring(k, j), ring(k, j + 1), ring(k + 1, j + 1), ring(k + 1, j)))
                mats.append(leaf["mat"])
        for j in range(S):
            faces.append((ring(R - 1, j), ring(R - 1, j + 1), end)); mats.append(leaf["mat"])
    return verts, faces, mats, wind


def foliage_mesh(name):
    verts, faces, mats, wind = foliage_geometry(0.0)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    for poly, m in zip(mesh.polygons, mats):
        poly.material_index = m
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh); bm.free()
    attr = mesh.color_attributes.new("wind", "BYTE_COLOR", "POINT")
    for i, value in enumerate(wind):
        attr.data[i].color = (value, 0.0, 0.0, 1.0)
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("wind")
    return mesh


# ---------------------------------------------------------------- scene

def build_plant(plant_id=PLANT_ID):
    plants = collection("plants")
    for prefix in ("foliage_", "soil_", "pot_", "plant_"):
        remove(prefix + plant_id)

    mat_pot = material("terracotta", rgba(PALETTE["terracotta"]), 0.85)
    mat_soil = material("soil_" + plant_id, rgba(PALETTE["soilDry"], PALETTE["soilWet"], SOIL_PREVIEW_MOISTURE), 0.95)
    mat_stem = material("leaf_deep", rgba(PALETTE["leafDeep"]), 0.8)
    mat_leaf = material("leaf_mid", rgba(PALETTE["leafMid"]), 0.75)
    mat_leaf2 = material("leaf_light", rgba(PALETTE["leafLight"]), 0.75)

    root = bpy.data.objects.new("plant_" + plant_id, None)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.08
    link(root, plants)

    pot_mesh = lathe_mesh("pot_" + plant_id, POT_PROFILE, SEGMENTS)
    smooth(pot_mesh)
    pot = link(bpy.data.objects.new("pot_" + plant_id, pot_mesh), plants, root)
    pot.data.materials.append(mat_pot)
    sub = pot.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2

    soil_m = soil_mesh("soil_" + plant_id)
    smooth(soil_m)
    soil = link(bpy.data.objects.new("soil_" + plant_id, soil_m), plants, root)
    soil.location.z = SOIL_TOP
    soil.data.materials.append(mat_soil)

    fol_m = foliage_mesh("foliage_" + plant_id)
    smooth(fol_m)
    fol = link(bpy.data.objects.new("foliage_" + plant_id, fol_m), plants, root)
    fol.location.z = SOIL_TOP + 0.002
    for m in (mat_stem, mat_leaf, mat_leaf2):
        fol.data.materials.append(m)
    fol.shape_key_add(name="Basis", from_mix=False)
    key = fol.shape_key_add(name="wilt", from_mix=False)
    wilted = foliage_geometry(1.0)[0]
    for i, v in enumerate(wilted):
        key.data[i].co = v
    key.value = 0.0
    return root


def build_preview():
    """Floor, sun and an orthographic iso camera to judge the look. Not exported."""
    col = collection("preview")
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=1.6)
    floor = bpy.context.active_object
    floor.name = "preview_floor"
    for c in floor.users_collection:
        c.objects.unlink(floor)
    col.objects.link(floor)
    floor.data.materials.append(material("preview_floor", rgba(PALETTE["frame"]), 0.9))

    sun_data = bpy.data.lights.get("preview_sun") or bpy.data.lights.new("preview_sun", "SUN")
    sun_data.color = [lin(v) for v in rgb(PALETTE["sun"])]
    sun_data.energy = 2.2
    sun_data.angle = math.radians(9)
    sun = bpy.data.objects.new("preview_sun", sun_data)
    sun.rotation_euler = (math.radians(58), 0, math.radians(-25))
    col.objects.link(sun)

    cam_data = bpy.data.cameras.get("preview_cam") or bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.5
    cam = bpy.data.objects.new("preview_cam", cam_data)
    target = Vector((0, 0, 0.12))
    cam.location = target + Vector((2, -2, 2))
    cam.rotation_euler = (math.radians(54.7356), 0, math.radians(45))
    col.objects.link(cam)
    scene.camera = cam

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs["Color"].default_value = rgba(PALETTE["sky"])
        bg.inputs["Strength"].default_value = 0.7

    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1200
    scene.view_settings.view_transform = "Standard"
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue


def main():
    for name in ("Cube", "Light", "Camera"):
        o = bpy.data.objects.get(name)
        if o and o.users_collection and o.users_collection[0].name == "Collection":
            bpy.data.objects.remove(o, do_unlink=True)
    root = build_plant()
    build_preview()
    tris = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for child in root.children:
        ev = child.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
    return {"plant": root.name, "children": [c.name for c in root.children], "triangles": tris}


if __name__ == "__main__":
    print(main())
