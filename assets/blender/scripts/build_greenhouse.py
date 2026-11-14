"""Vitreo - parametric greenhouse diorama.

Visual target: referencias/ref-03-objetivo.png (docs/02).
Naming contract: docs/04 (structure / plants / helpers / devices / preview).

Run inside Blender with assets/blender/vitreo.blend open. It rebuilds the
collections structure, plants, helpers and preview from scratch, so it is
safe to re-run. Units are metres at real scale. To resize, change P.
The soil and the materials come from exercises/pot_basil_01.blend; the pots
(pot_mesh, D134) and the plants (plant_mesh, one per species) are generated here.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix

P = dict(
    L=0.86, W=0.52, EAVE=0.34, RIDGE=0.56,      # greenhouse body
    PROFILE=0.016, BAYS=4, RAIL=0.13,           # frame
    DOOR_W=0.18, DOOR_H=0.0,                    # door post centres; the door rises to the eave
    MARGIN_X=0.17, MARGIN_Y=0.13,               # plinth around the greenhouse (centred)
    BASE_H=0.06, RIM_W=0.04, RIM_H=0.015, PATH_W=0.17,
    FLOOR_T=0.008,
    PLANT_DX=0.26, PLANT_DY=0.12,
    SEED_H=0.055,                               # stem height of the seedlings
    PURLIN=0.45,                                # roof cross bar, fraction of the slope from the eave
    VENT_BAY=2, VENT_OPEN_DEG=35, VENT_SIDE=-1,  # vent fills one roof panel: purlin -> ridge
)
# Same ids and layout as apps/web/src/scene/zones.ts (three.js z = -Blender y).
# 3 x 2 layout (D63). y = -1 is the front row (towards the camera).
PLANTS = [("basil_01", -1, -1), ("chives_01", 0, -1), ("parsley_01", 1, -1),
          ("lettuce_01", -1, 1), ("tomato_01", 0, 1), ("strawberry_01", 1, 1)]
KIND = {"basil_01": "basil", "parsley_01": "parsley", "lettuce_01": "lettuce",
        "strawberry_01": "strawberry", "chives_01": "chives", "tomato_01": "tomato"}
POT_SCALE = {"tomato_01": 1.2}             # dwarf cherry tomato: a slightly larger pot
# Per plant: (scale, tilt x deg, tilt y deg). Basil and strawberry lead; the others
# stay a touch smaller, all leaning a little so none looks like a placed clone.
PLANT_LOOK = {"basil_01": (1.36, 4, -3), "parsley_01": (1.2, -3, 5),
              "lettuce_01": (1.24, 2, 2), "strawberry_01": (1.26, -5, -4),
              "chives_01": (1.18, 3, -2), "tomato_01": (1.16, -2, 3)}
POT_YAW = {"basil_01": 20, "parsley_01": 140, "lettuce_01": 75, "strawberry_01": 250,
           "chives_01": 310, "tomato_01": 190}
SEED_YAW = {"basil_01": 35, "parsley_01": -20, "lettuce_01": 70, "strawberry_01": 10, "chives_01": 0, "tomato_01": 30}  # degrees, so they are not clones
# Colours from apps/web/src/styles/tokens.css (--scene-*); floor/page/new leaf are local.
HEX = dict(frame="f2ece2", plinth="edd5b8", tray="cbaa87", path="e6ceb1",
           glass="d6e6ea", floor="f4efe6", page="faf9f6",
           leaf_deep="687a3f", leaf_mid="849050", leaf_new="97a05a", leaf_light="abac68",
           petal="f7f2e8", pistil="e6c97a", berry="c4604f",
           unripe="a3ad66", chive_flower="c4a6c8", stake="c8b38c",
           sun_preview="ffe2bf", sky_preview="f4ece1")
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if "__file__" in globals() else os.path.dirname(bpy.data.filepath)
PLANT_SRC = os.path.join(HERE, "exercises", "pot_basil_01.blend")


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def _principled(m):
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    if b is None:
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        b = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(b.outputs[0], out.inputs[0])
    return nt, b


def material(name, hexcol, alpha=1.0, rough=0.85):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt, b = _principled(m)
    b.inputs["Base Color"].default_value = (*lin(hexcol), 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.0 if alpha == 1.0 else 0.5
    b.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    m.use_backface_culling = alpha == 1.0
    return m


def glass_material():
    """Preview glass: faint tint, glossy, more opaque at grazing angles (reads as glass).
    The app draws glass with its own shader; this is for Blender renders/bakes."""
    m = bpy.data.materials.get("glass") or bpy.data.materials.new("glass")
    nt, b = _principled(m)
    b.inputs["Base Color"].default_value = (*lin(HEX["glass"]), 1.0)
    b.inputs["Roughness"].default_value = 0.06
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.9
    for nm in ("glass_facing", "glass_alpha"):
        old = nt.nodes.get(nm)
        if old:
            nt.nodes.remove(old)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.name = "glass_facing"
    lw.inputs["Blend"].default_value = 0.35
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.name = "glass_alpha"
    mr.inputs["To Min"].default_value = 0.16
    mr.inputs["To Max"].default_value = 0.62
    nt.links.new(lw.outputs["Facing"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], b.inputs["Alpha"])
    for nm in ("glass_noise", "glass_rough"):
        old = nt.nodes.get(nm)
        if old:
            nt.nodes.remove(old)
    gn = nt.nodes.new("ShaderNodeTexNoise")
    gn.name = "glass_noise"
    gn.inputs["Scale"].default_value = 18.0
    gr = nt.nodes.new("ShaderNodeMapRange")
    gr.name = "glass_rough"
    gr.inputs["To Min"].default_value = 0.035
    gr.inputs["To Max"].default_value = 0.075
    nt.links.new(gn.outputs["Fac"], gr.inputs["Value"])
    nt.links.new(gr.outputs["Result"], b.inputs["Roughness"])
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    m.use_backface_culling = False
    return m


def tone_material(name, rough=0.85):
    """Material whose base colour is the 'tone' colour attribute (COLOR_0 in glTF)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt, b = _principled(m)
    ca = nt.nodes.get("tone") or nt.nodes.new("ShaderNodeVertexColor")
    ca.name, ca.layer_name = "tone", "tone"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.0
    m.use_backface_culling = True
    return m


def bake_tone(me, cid_layer, palette):
    """Copy a per-vertex palette index into the 'tone' colour attribute."""
    ids = [d.value for d in me.attributes[cid_layer].data]
    tone = me.color_attributes.new("tone", "BYTE_COLOR", "CORNER")
    for poly in me.polygons:
        c = (*lin(palette[ids[poly.vertices[0]]]), 1.0)
        for li in poly.loop_indices:
            tone.data[li].color = c
    me.attributes.remove(me.attributes[cid_layer])
    me.color_attributes.active_color = me.color_attributes["tone"]
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def micro_variation(m, amount=0.035, scale=60.0):
    """Very subtle procedural colour noise (Blender look only; the app uses tokens)."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    if nt.nodes.get("mv_mix"):
        return m
    base = tuple(b.inputs["Base Color"].default_value)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.name = "mv_noise"
    tex.inputs["Scale"].default_value = scale
    mix = nt.nodes.new("ShaderNodeMix")
    mix.name, mix.data_type = "mv_mix", "RGBA"
    mix.inputs["Factor"].default_value = 1.0
    mix.blend_type = "OVERLAY"
    nt.links.new(tex.outputs["Fac"], mix.inputs[7])
    mix.inputs[6].default_value = base
    mix.inputs["Factor"].default_value = amount
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    r0 = b.inputs["Roughness"].default_value             # roughness varies more than colour
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.name = "mv_rough"
    mr.inputs["To Min"].default_value = max(0.0, r0 - 0.1)
    mr.inputs["To Max"].default_value = min(1.0, r0 + 0.06)
    nt.links.new(tex.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])
    return m


def leaf_material():
    """Single leaf material; per-leaf tone comes from the 'tone' colour attribute."""
    m = bpy.data.materials.get("leaf") or bpy.data.materials.new("leaf")
    nt, b = _principled(m)
    ca = nt.nodes.get("tone") or nt.nodes.new("ShaderNodeVertexColor")
    ca.name, ca.layer_name = "tone", "tone"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.0
    m.use_backface_culling = True
    return m


def collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return c


def _box(bm, origin, ax, ay, az, mat=0):
    vs = [bm.verts.new(origin + ax * sx + ay * sy + az * sz) for sx, sy, sz in
          [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
           (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
        bm.faces.new([vs[i] for i in f]).material_index = mat
    return vs


def aabb(bm, mn, mx, mat=0):
    mn, mx = Vector(mn), Vector(mx)
    h = (mx - mn) / 2
    _box(bm, (mn + mx) / 2, Vector((h.x, 0, 0)), Vector((0, h.y, 0)), Vector((0, 0, h.z)), mat)


def beam(bm, p1, p2, s=None, mat=0):
    """Square profile from p1 to p2, extended s/2 at both ends so joints overlap."""
    s = s or P["PROFILE"]
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    half = d.length / 2 + s / 2
    d.normalize()
    up = Vector((0, 0, 1))
    u = Vector((1, 0, 0)) if abs(d.dot(up)) > 0.99 else d.cross(up).normalized()
    v = u.cross(d).normalized()
    _box(bm, (p1 + p2) / 2, d * half, u * (s / 2), v * (s / 2), mat)


def member(bm, p1, p2, w, h, nrm=None, mat=0, cut1=None, cut2=None):
    """Rectangular profile from p1 to p2 (no extension): h along nrm, w across.
    cut1/cut2 = (axis, value): trim that end flush to the plane coord[axis] == value
    (e.g. a plumb cut of a rafter against the eave beam or the ridge)."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    half = d.length / 2
    d.normalize()
    nrm = Vector((0, 0, 1)) if nrm is None else Vector(nrm)
    v = (nrm - d * nrm.dot(d)).normalized()
    u = d.cross(v).normalized()
    vs = _box(bm, (p1 + p2) / 2, d * half, u * (w / 2), v * (h / 2), mat)
    for idx, cut in (((0, 3, 4, 7), cut1), ((1, 2, 5, 6), cut2)):
        if cut:
            ax, val = cut
            for i in idx:
                co = vs[i].co
                vs[i].co = co + d * ((val - co[ax]) / d[ax])
    return vs


def pane(bm, pts, mat=0):
    bm.faces.new([bm.verts.new(Vector(p)) for p in pts]).material_index = mat


def tube(bm, pts, r, seg=8, mat=0):
    """Round tube swept along a polyline (hoses, cables, rods). Parallel-transport
    frames, so the section never flips or twists at the bends."""
    pts = [Vector(p) for p in pts]
    tans = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
    a = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    u = tans[0].cross(a).normalized()
    rings = []
    for i, p in enumerate(pts):
        if i:
            u = (tans[i - 1].rotation_difference(tans[i]) @ u)
            u = (u - tans[i] * u.dot(tans[i])).normalized()
        v = tans[i].cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r)
                      for k in range(seg)])
    for A, B_ in zip(rings, rings[1:]):
        for k in range(seg):
            bm.faces.new([A[k], A[(k + 1) % seg], B_[(k + 1) % seg], B_[k]]).material_index = mat
    bm.faces.new(rings[0][::-1]).material_index = mat
    bm.faces.new(rings[-1]).material_index = mat


def rounded_path(corners, radius, n=6):
    """Polyline through corner points with each inner corner rounded (pipe elbows)."""
    P = [Vector(c) for c in corners]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c_ = P[i - 1], P[i], P[i + 1]
        r_ = min(radius, (b - a).length / 2, (c_ - b).length / 2)
        s0, s1 = b + (a - b).normalized() * r_, b + (c_ - b).normalized() * r_
        out += bez(s0, b, s1, n=n)
    out.append(P[-1])
    return out


def bez(p0, p1, p2, n=12):
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in [i / n for i in range(n + 1)]]


def ring_x(bm, c, r_out, r_in, depth, seg=32, mat=0):
    """Annular housing with its axis along x."""
    c = Vector(c)
    ang = [2 * math.pi * k / seg for k in range(seg)]
    R = {}
    for s in (-1, 1):
        for rr in (r_out, r_in):
            R[(s, rr)] = [bm.verts.new(c + Vector((s * depth / 2, rr * math.cos(a), rr * math.sin(a)))) for a in ang]
    for k in range(seg):
        k1 = (k + 1) % seg
        for s in (-1, 1):
            bm.faces.new([R[(s, r_out)][k], R[(s, r_out)][k1], R[(s, r_in)][k1], R[(s, r_in)][k]]).material_index = mat
        for rr in (r_out, r_in):
            bm.faces.new([R[(-1, rr)][k], R[(-1, rr)][k1], R[(1, rr)][k1], R[(1, rr)][k]]).material_index = mat


def merge_bm(dst, src, mat=0):
    vm = {v: dst.verts.new(v.co) for v in src.verts}
    for f in src.faces:
        dst.faces.new([vm[v] for v in f.verts]).material_index = mat
    src.free()


def soft_box(mn, mx, off, seg=2):
    """Box with bevelled edges in its own bmesh (merge it with merge_bm)."""
    b = bmesh.new()
    aabb(b, mn, mx)
    bmesh.ops.bevel(b, geom=b.verts[:] + b.edges[:], offset=off, offset_type="OFFSET",
                    segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return b


def rr_loft(bm, cx, cy, w, d, r, profile, seg=6, mat=0):
    """Loft of rounded-rectangle rings: profile = [(inset, z), ...] bottom to top."""
    rings = []
    for inset, z in profile:
        ww, dd = w - 2 * inset, d - 2 * inset
        rr = max(0.003, min(r - inset * 0.5, ww / 2 - 0.001, dd / 2 - 0.001))
        ring = []
        for sx, sy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            ccx, ccy = cx + sx * (ww / 2 - rr), cy + sy * (dd / 2 - rr)
            for i in range(seg + 1):
                a = math.radians(a0 + 90 * i / seg)
                ring.append(bm.verts.new((ccx + rr * math.cos(a), ccy + rr * math.sin(a), z)))
        rings.append(ring)
    n = len(rings[0])
    for A, B_ in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new([A[k], A[(k + 1) % n], B_[(k + 1) % n], B_[k]]).material_index = mat
    bm.faces.new(rings[0][::-1]).material_index = mat
    bm.faces.new(rings[-1]).material_index = mat


def finish(name, bm, coll, mats, bevel=0.0, after=None, origin=None, segments=3, sharp=35):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel,
                        offset_type="OFFSET", segments=segments, profile=0.5,
                        affect="EDGES", clamp_overlap=True)
    if after:
        after(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if origin is not None:
        me.transform(Matrix.Translation(-Vector(origin)))
    for m in mats:
        me.materials.append(m)
    if bevel > 0:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp))
    o = bpy.data.objects.new(name, me)
    if origin is not None:
        o.location = Vector(origin)
    coll.objects.link(o)
    return o


# The pot (D134): the same 13 cm pot as the exercise, turned again with 48
# segments (it had 32: its rim read as a polygon up close) and a rolled lip.
# (radius, height) from the foot, up the wall, over the rim and down inside to
# just under the soil.
POT_PROFILE = [(0.0400, 0.0), (0.0436, 0.0008), (0.0450, 0.0035), (0.0486, 0.0315),
               (0.0522, 0.0540), (0.0555, 0.0715), (0.0566, 0.0745), (0.0600, 0.0765),
               (0.0640, 0.0778), (0.0655, 0.0800), (0.0661, 0.0850), (0.0661, 0.0895),
               (0.0652, 0.0925), (0.0632, 0.0942), (0.0610, 0.0946), (0.0592, 0.0938),
               (0.0582, 0.0920), (0.0578, 0.0880), (0.0576, 0.0820)]
POT_SEGMENTS = 48


def pot_mesh(name, material_):
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * k / POT_SEGMENTS),
                            r * math.sin(2 * math.pi * k / POT_SEGMENTS), z))
              for k in range(POT_SEGMENTS)] for r, z in POT_PROFILE]
    bm.faces.new(rings[0][::-1])
    for a, b in zip(rings, rings[1:]):
        for k in range(POT_SEGMENTS):
            j = (k + 1) % POT_SEGMENTS
            bm.faces.new([a[k], a[j], b[j], b[k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material_)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(60))      # only the foot stays crisp
    return me


def leaf_width(shape, t):
    if shape == "round":
        wf = 0.35 + 0.65 * t ** 0.7
    elif shape == "obovate":
        wf = 0.5 + 0.5 * t ** 0.5
    else:
        wf = max(0.2, math.sin(math.pi * min(1.0, t * 0.92 + 0.04)) ** 0.5)
    return wf * (1.0 - abs(2 * t - 1) ** 4) ** 0.5          # rounded base and tip


def soft_leaf(bm, length, width, shape="oval", thick=None, K=10, rows=2, cup=0.15, bend=0.0,
              ruffle=0.0, freq=3.5):
    """A soft, clay-like leaf: smooth outline (2K points, denser near the ends),
    a gentle midrib and a lens-shaped thickness that closes at the rim.
    Leaf space: x along the leaf (0 base .. length tip), y across, z up."""
    thick = width * 0.16 if thick is None else thick
    ts = [0.5 - 0.5 * math.cos(math.pi * (k + 1) / (K + 1)) for k in range(K)]

    def P(t, s, side, surf):
        wf = leaf_width(shape, t)
        y = side * s * width / 2 * wf
        z = cup * width * (s * wf) ** 2 - bend * length * t * t
        if ruffle:
            z += ruffle * width * math.sin(t * 2 * math.pi * freq) * s ** 3
        z += surf * thick / 2 * (1 - s * s) * math.sin(math.pi * t) ** 0.5
        return Vector((t * length, y, z))

    B, T = bm.verts.new(P(0, 0, 1, 0)), bm.verts.new(P(1, 0, 1, 0))
    mid = {surf: [bm.verts.new(P(t, 0, 1, surf)) for t in ts] for surf in (1, -1)}
    faces = []
    for side in (1, -1):
        edge = [bm.verts.new(P(t, 1, side, 0)) for t in ts]
        for surf in (1, -1):
            cols = [mid[surf]]
            for j in range(1, rows):
                cols.append([bm.verts.new(P(t, j / rows, side, surf)) for t in ts])
            cols.append(edge)
            for j in range(rows):
                a, b = cols[j], cols[j + 1]
                faces.append(bm.faces.new([B, a[0], b[0]]))
                faces.append(bm.faces.new([T, b[-1], a[-1]]))
                for k in range(K - 1):
                    faces.append(bm.faces.new([a[k], a[k + 1], b[k + 1], b[k]]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return list({v for f in faces for v in f.verts})


def plant_mesh(kind, m_leaf):
    """Stylised plant per species (soft clay look as in ref-03), origin on the soil.
    Attributes: 'tone' (COLOR_0, per part), '_WIND' (0 base .. 1 tips),
    shape key 'wilt' (leaves droop, plant leans)."""
    bm = bmesh.new()
    part = bm.verts.layers.int.new("part")

    def tag(vs, k):
        for v in vs:
            v[part] = k

    def stem(p1, p2, r1, r2, k=0, seg=6):
        p1, p2 = Vector(p1), Vector(p2)
        d = p2 - p1
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation((p1 + p2) / 2) @ q.to_matrix().to_4x4()
        tag(bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2,
                                  depth=d.length, matrix=m)["verts"], k)

    def arc(p0, p1, p2, r1, r2, k=0, n=3):
        p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
        pts = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in [i / n for i in range(n + 1)]]
        for i in range(n):
            stem(pts[i], pts[i + 1], r1 + (r2 - r1) * i / n, r1 + (r2 - r1) * (i + 1) / n, k)
        return pts[-1]

    def leaf(base, length, width, yaw, pitch, k, shape="oval", cup=0.15, bend=0.0,
             ruffle=0.0, res=(16, 8), thick=None, freq=3.5):
        K = max(12 if ruffle else 8, res[0] // 2 + 3)
        vs = soft_leaf(bm, length, width, shape, thick, K=K, rows=2, cup=cup, bend=bend,
                       ruffle=ruffle, freq=freq)
        m = (Matrix.Translation(Vector(base)) @ Matrix.Rotation(math.radians(yaw), 4, "Z")
             @ Matrix.Rotation(math.radians(-pitch), 4, "Y"))
        bmesh.ops.transform(bm, matrix=m, verts=vs)
        tag(vs, k)

    def polar(r, yaw, z):
        a = math.radians(yaw)
        return Vector((r * math.cos(a), r * math.sin(a), z))

    if kind == "basil":                       # bushy: opposite pairs of broad cupped leaves
        H = 0.072
        stem((0, 0, -0.004), (0, 0, H), 0.0034, 0.0024)
        for z, l, yaw, pitch, k in ((0.012, 0.050, 0, 0, 3), (0.024, 0.050, 90, 6, 3),
                                    (0.036, 0.047, 45, 12, 1), (0.048, 0.042, 135, 18, 1),
                                    (0.059, 0.035, 20, 28, 1), (0.068, 0.026, 110, 42, 2)):
            for s in (0, 180):
                leaf(polar(0.002, yaw + s, z), l, l * 0.86, yaw + s, pitch, k, shape="obovate",
                     cup=-0.12, bend=0.06)
        for s in (0, 90, 180, 270):
            leaf((0, 0, H), 0.014, 0.011, s + 20, 62, 2, res=(10, 6))
    elif kind == "parsley":                   # dense mound of short stems with frilly leaflets
        for i in range(14):
            yaw = i * 360 / 14 + (i % 2) * 10
            ang = math.radians(20 + (i % 3) * 15)
            L = 0.040 + (i % 3) * 0.009
            d = Vector((math.sin(ang) * math.cos(math.radians(yaw)),
                        math.sin(ang) * math.sin(math.radians(yaw)), math.cos(ang)))
            tip = arc((0, 0, 0), d * L * 0.45 + Vector((0, 0, 0.008)), d * L, 0.0017, 0.0012)
            for dy in (-45, 0, 45):
                leaf(tip, 0.026, 0.026, yaw + dy, 30 - abs(dy) * 0.4, 3 if i % 2 else 1,
                     shape="round", cup=0.18, ruffle=0.035, freq=2.0, res=(12, 6))
    elif kind == "lettuce":                   # rosette of broad ruffled leaves
        for n, l, w, pitch, r0, k, off in ((8, 0.058, 0.056, 24, 0.004, 1, 0),
                                           (7, 0.052, 0.050, 44, 0.003, 1, 22),
                                           (6, 0.044, 0.042, 60, 0.003, 4, 8),
                                           (4, 0.032, 0.031, 76, 0.002, 2, 30)):
            for i in range(n):
                yaw = off + i * 360 / n
                leaf(polar(r0, yaw, 0.002), l, w, yaw, pitch, k, shape="obovate", cup=0.22,
                     bend=0.05 if pitch < 30 else -0.02, ruffle=0.045, freq=2.5, res=(22, 9))
    elif kind == "strawberry":                # trifoliate leaves, a flower and a berry
        for i in range(6):
            yaw = i * 60 + 15
            Lh, Lz = 0.030 + (i % 2) * 0.010, 0.048 + (i % 3) * 0.007
            tip = arc((0, 0, 0), polar(Lh * 0.2, yaw, Lz * 0.9), polar(Lh, yaw, Lz), 0.0019, 0.0014)
            for dy in (-58, 0, 58):
                leaf(tip, 0.035, 0.032, yaw + dy, 12, 3 if (i + dy) % 2 else 1, shape="round",
                     cup=0.12, ruffle=0.025, freq=5, res=(14, 7))
        fy = 250
        tip = arc((0, 0, 0), polar(0.012, fy, 0.058), polar(0.032, fy, 0.07), 0.0015, 0.0012)
        for j in range(5):
            leaf(tip, 0.014, 0.013, fy + j * 72, 14, 5, shape="round", cup=0.06, res=(10, 6))
        tag(bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.0045,
                                      matrix=Matrix.Translation(tip + Vector((0, 0, 0.0015))))["verts"], 6)
        by = -60                              # hangs inside the pot, between two leaf stalks
        end = arc((0, 0, 0), polar(0.026, by, 0.04), polar(0.045, by, 0.021), 0.0012, 0.0009, n=4)
        # a real strawberry: conical, widest near the top, rounded shoulders, pointed
        # tip; green star calyx on top and small golden seeds on the skin
        R, Hb = 0.0064, 0.0165
        top = end - Vector((0, 0, 0.002))

        def berry_r(t):                       # t: 0 top .. 1 tip
            return R * (1 - t) ** 0.62 * (0.82 + 0.18 * min(1.0, t / 0.28))

        vs = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=1.0)["verts"]
        for v in vs:
            x, y, z = v.co
            s_ = math.hypot(x, y)
            t = (1 - z) / 2
            if z > 0:                         # rounded shoulders and a soft dome on top
                rad = berry_r(t) * s_ ** 0.35
                dz = 0.0006 * (1 - s_) ** 1.5
            else:                             # body tapering to a point
                rad, dz = berry_r(t), 0.0
            k = rad / max(s_, 1e-6)
            v.co = top + Vector((x * k, y * k, -t * Hb + dz))
        tag(vs, 7)
        n_seeds = 44                          # golden-angle spiral: evenly spread seeds
        for q in range(n_seeds):
            t = 0.14 + 0.78 * (q + 0.5) / n_seeds
            a = q * 2.39996
            r_ = berry_r(t) * 1.0
            p_ = top + Vector((math.cos(a) * r_, math.sin(a) * r_, -t * Hb))
            tag(bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0004,
                                           matrix=Matrix.Translation(p_))["verts"], 11)
        # calyx: a small green cap on top and six sepals draped over the shoulders
        tag(bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.0036, radius2=0.0016,
                                  depth=0.0016, matrix=Matrix.Translation(top + Vector((0, 0, 0.0009))))["verts"], 12)
        for j in range(6):
            leaf(top + Vector((0, 0, 0.0013)), 0.0086, 0.0040, j * 60 + 15, -5, 12, cup=0.08, bend=0.26, res=(8, 4))

    elif kind == "chives":                    # tuft of thin, tapering hollow leaves + two pom-poms
        rr = random.Random(5)
        for i in range(30):
            yaw = rr.uniform(0, 360)
            lean = math.radians(rr.uniform(4, 24))
            H = rr.uniform(0.07, 0.112)
            base = polar(rr.uniform(0, 0.011), yaw, -0.002)
            d = Vector((math.sin(lean) * math.cos(math.radians(yaw)),
                        math.sin(lean) * math.sin(math.radians(yaw)), math.cos(lean)))
            out = Vector((d.x, d.y, 0)).normalized()
            arc(base, base + d * H * 0.55, base + d * H + out * H * 0.1, 0.0019, 0.0007,
                1 if i % 3 else 3, n=4)
        for yaw, h in ((40, 0.118), (215, 0.103)):
            top = arc(polar(0.004, yaw, 0), polar(0.007, yaw, h * 0.6), polar(0.013, yaw, h), 0.0011, 0.0009, 0)
            vs = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.0075,
                                            matrix=Matrix.Translation(top + Vector((0, 0, 0.005))))["verts"]
            tag(vs, 9)
    elif kind == "tomato":                    # dwarf cherry tomato on a cane, with fruit trusses
        H = 0.13
        stem((0.018, -0.012, -0.01), (0.018, -0.012, H + 0.025), 0.0018, 0.0015, 10)
        m0, m1, m2 = Vector((0, 0, -0.004)), Vector((0.002, 0.001, H * 0.5)), Vector((0.004, -0.002, H))
        stem(m0, m1, 0.0034, 0.0028)
        stem(m1, m2, 0.0028, 0.0018)
        for i in range(7):
            z = 0.02 + i * 0.016
            yaw = i * 137.5
            L = 0.05 - i * 0.003
            base = Vector((0.003 * z / H, 0, z))
            dvec = polar(1, yaw, 0)
            end = arc(base, base + dvec * L * 0.5 + Vector((0, 0, 0.012)),
                      base + dvec * L + Vector((0, 0, -0.004)), 0.0013, 0.0008, 0)
            for t in (0.45, 0.75):
                p_ = base.lerp(end, t) + Vector((0, 0, 0.006 * (1 - t)))
                for sgn in (-1, 1):
                    leaf(p_, 0.023, 0.016, yaw + sgn * 70, 10, 1 if (i + sgn) % 2 else 3, cup=0.14)
            leaf(end, 0.026, 0.018, yaw, 15, 4 if i > 4 else 1, cup=0.14)
        for yaw, z, ripe in ((300, 0.06, (7, 7, 8)), (60, 0.085, (7, 8, 8)), (200, 0.045, (7, 7, 7))):
            st = polar(0.004, yaw, z + 0.01)
            end = arc(st, polar(0.022, yaw, z + 0.016), polar(0.04, yaw, z), 0.0009, 0.0008, 0)
            for j, k_ in enumerate(ripe):
                c = end + Vector((math.cos(j * 2.1) * 0.007, math.sin(j * 2.1) * 0.007, -0.009 - j * 0.004))
                stem(end, c + Vector((0, 0, 0.006)), 0.0006, 0.0006, 0)
                tag(bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.0065,
                                              matrix=Matrix.Translation(c))["verts"], k_)
                tag(bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=0.0042, radius2=0.0012,
                                          depth=0.0016, matrix=Matrix.Translation(c + Vector((0, 0, 0.006))))["verts"], 0)

    name = "foliage_" + kind
    old = bpy.data.meshes.get(name)
    if old:
        bpy.data.meshes.remove(old)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()

    parts = [d.value for d in me.attributes["part"].data]
    cols = {0: HEX["leaf_deep"], 1: HEX["leaf_mid"], 2: HEX["leaf_new"], 3: HEX["leaf_deep"],
            4: HEX["leaf_light"], 5: HEX["petal"], 6: HEX["pistil"], 7: HEX["berry"],
            8: HEX["unripe"], 9: HEX["chive_flower"], 10: HEX["stake"], 11: HEX["pistil"],
            12: HEX["leaf_deep"]}
    tone = me.color_attributes.new("tone", "BYTE_COLOR", "CORNER")
    for poly in me.polygons:
        c = (*lin(cols[parts[poly.vertices[0]]]), 1.0)
        for li in poly.loop_indices:
            tone.data[li].color = c
    me.attributes.remove(me.attributes["part"])
    me.color_attributes.active_color = me.color_attributes["tone"]
    me.color_attributes.render_color_index = me.color_attributes.active_color_index

    rmax = max(math.hypot(v.co.x, v.co.y) for v in me.vertices)
    zmax = max(v.co.z for v in me.vertices)
    wind = me.attributes.new("_WIND", "FLOAT", "POINT")
    for i, v in enumerate(me.vertices):
        r = math.hypot(v.co.x, v.co.y)
        wind.data[i].value = min(1.0, 0.6 * (max(v.co.z, 0.0) / zmax) ** 1.5 + 0.4 * r / rmax)
        if parts[i] == 10:
            wind.data[i].value = 0.0
    me.materials.append(m_leaf)

    tmp = bpy.data.objects.new("tmp_plant", me)
    tmp.shape_key_add(name="Basis")
    wilt = tmp.shape_key_add(name="wilt", from_mix=False)
    D = 0.5 * zmax
    for i, v in enumerate(me.vertices):
        x, y, z = v.co
        if parts[i] in (7, 8, 10, 11, 12):    # fruit (+ seeds, calyx) and stake follow the lean
            wilt.data[i].co = Vector((x + 0.1 * max(z, 0.0), y, z))
            continue
        r = math.hypot(x, y)
        h = min(1.0, z / (0.35 * zmax) + 0.25)
        nz = max(0.003, z - D * (r / rmax) ** 2 * h - 0.15 * z)
        wilt.data[i].co = Vector((x + 0.1 * z, y, nz))
    wilt.value = 0.0                          # the model is exported healthy; the app drives it
    bpy.data.objects.remove(tmp)
    return me


def build():
    p, s = P, P["PROFILE"]
    for nm in ("frame", "plinth", "tray", "path", "floor", "terracotta"):
        old = bpy.data.materials.get(nm)
        if old and old.node_tree and old.node_tree.nodes.get("mv_mix"):
            bpy.data.materials.remove(old)               # rebuilt below, fresh noise nodes
    m_frame = micro_variation(material("frame", HEX["frame"], rough=0.85), 0.03, 90)
    m_plinth = micro_variation(material("plinth", HEX["plinth"]), 0.05, 35)
    m_tray = micro_variation(material("tray", HEX["tray"], rough=0.95), 0.12, 140)
    m_path = micro_variation(material("path", HEX["path"]), 0.05, 40)
    m_floor = material("floor", HEX["floor"])
    m_glass = glass_material()
    m_page = material("page", HEX["page"], rough=1.0)
    m_leaf = leaf_material()

    c_struct, c_plants = collection("structure"), collection("plants")
    c_help, c_prev = collection("helpers"), collection("preview")
    c_dev = collection("devices")

    L, W = p["L"], p["W"]
    BL, BW = L + 2 * p["MARGIN_X"], W + 2 * p["MARGIN_Y"]
    BH, RW, RH, PW = p["BASE_H"], p["RIM_W"], p["RIM_H"], p["PATH_W"]
    x0b, x1b, y0b, y1b = -BL / 2, BL / 2, -BW / 2, BW / 2
    gx0, gx1, gy0, gy1 = -L / 2, L / 2, -W / 2, W / 2       # greenhouse centred
    z0 = BH + p["FLOOR_T"]
    ze, zr = z0 + p["EAVE"], z0 + p["RIDGE"]
    dw, dh = p["DOOR_W"], p["DOOR_H"]

    # ---- plinth: slab, raised rim (open for the path), sand tray, path, steps
    top = BH + RH
    bm = bmesh.new()
    aabb(bm, (x0b, y0b, 0), (x1b, y1b, BH))
    # raised rim: ONE continuous C-shaped solid, open where the path enters (no
    # overlapping boxes at the corners: they printed dark seams in the lightmap)
    ring = [(x1b, PW / 2), (x1b, y1b), (x0b, y1b), (x0b, y0b), (x1b, y0b), (x1b, -PW / 2),
            (x1b - RW, -PW / 2), (x1b - RW, y0b + RW), (x0b + RW, y0b + RW),
            (x0b + RW, y1b - RW), (x1b - RW, y1b - RW), (x1b - RW, PW / 2)]
    # The rim's outer wall stands a hair proud of the slab and goes down past the
    # slab's rounded top edge: with both edges rounded, the two met in a groove
    # that baked as a black line all around the plinth (D134).
    lip = 0.0006

    def proud(x, y):
        return (x + (lip if x == x1b else -lip if x == x0b else 0.0),
                y + (lip if y == y1b else -lip if y == y0b else 0.0))

    ring = [proud(x, y) for x, y in ring]
    bot_ = [bm.verts.new((x, y, BH - 0.024)) for x, y in ring]
    top_ = [bm.verts.new((x, y, top)) for x, y in ring]
    bm.faces.new(bot_[::-1])
    bm.faces.new(top_)
    for i_ in range(len(ring)):
        j_ = (i_ + 1) % len(ring)
        bm.faces.new([bot_[i_], bot_[j_], top_[j_], top_[i_]])
    finish("base", bm, c_struct, [m_plinth], bevel=0.011, segments=4)

    bm = bmesh.new()
    aabb(bm, (x0b + RW, y0b + RW, BH - 0.001), (x1b - RW, y1b - RW, BH + 0.002))
    finish("gravel", bm, c_struct, [m_tray])

    bm = bmesh.new()
    aabb(bm, (gx1 + 0.012, -PW / 2, BH - 0.001), (x1b, PW / 2, BH + 0.006))
    finish("path", bm, c_struct, [m_path], bevel=0.002)

    bm = bmesh.new()
    aabb(bm, (x1b - 0.01, -PW / 2 - 0.01, 0), (x1b + 0.07, PW / 2 + 0.01, BH * 0.66))
    aabb(bm, (x1b + 0.06, -PW / 2 - 0.01, 0), (x1b + 0.135, PW / 2 + 0.01, BH * 0.33))
    finish("steps", bm, c_struct, [m_path], bevel=0.009, segments=4)

    bm = bmesh.new()
    aabb(bm, (gx0 - 0.012, gy0 - 0.012, BH - 0.001), (gx1 + 0.012, gy1 + 0.012, z0))
    finish("floor_main", bm, c_struct, [m_floor], bevel=0.003)

    # ---- structure: real joinery. Square profiles with a fine chamfer, butt joints,
    # every wall member flush on the outside (same depth), glass inside the cells.
    B = p["BAYS"]
    pp, c = 0.0135, 0.016                   # post, corner post
    sill_h, sill_d = 0.018, 0.019           # sill plate
    eb = 0.016                              # eave beam / gable tie height (depth = pp)
    rail_h = 0.010                          # mid rail height (depth = pp, flush)
    rw, rwg, rd = 0.0105, 0.0135, 0.013     # rafter width, gable rafter width, rafter depth
    ridge_w, ridge_h = 0.0145, 0.017
    BEV = 0.0040                            # clay-soft edges (D134; it was a fine 1.1 mm chamfer; the mid rails are 10 mm, so 4 is near the limit)
    zst = z0 + sill_h
    zrl = z0 + p["RAIL"]
    ze_c = ze + rd / 2                      # roof plane over the wall line
    zr_c = zr - ridge_h / 2                 # roof plane at the ridge axis
    bays = [gx0 + L * k / B for k in range(B + 1)]
    pw_ = [c if k in (0, B) else pp for k in range(B + 1)]
    rws = [rwg if k in (0, B) else rw for k in range(B + 1)]
    vb, sv = p["VENT_BAY"], p["VENT_SIDE"]
    xa, xb = bays[vb], bays[vb + 1]
    slope_len = math.hypot(gy1, zr_c - ze_c)
    dy = dw / 2                             # door posts at +-dy on the front gable

    def slope(side, tt):
        return side * gy1 * (1 - tt), ze_c + (zr_c - ze_c) * tt

    def rnorm(side):
        return Vector((0, side * (zr_c - ze_c), gy1)).normalized()

    def wall_y(Y, x0_, x1_, za_, zb_, h=None):      # member along x in a long wall
        aabb(bm, (x0_, Y - pp / 2, za_), (x1_, Y + pp / 2, zb_))

    def wall_x(X, y0_, y1_, za_, zb_):              # member along y in a gable wall
        aabb(bm, (X - pp / 2, y0_, za_), (X + pp / 2, y1_, zb_))

    bm = bmesh.new()
    for Y in (gy0, gy1):                                       # sill plates
        aabb(bm, (gx0 - sill_d / 2, Y - sill_d / 2, z0), (gx1 + sill_d / 2, Y + sill_d / 2, zst))
    for X in (gx0, gx1):
        aabb(bm, (X - sill_d / 2, gy0 + sill_d / 2, z0), (X + sill_d / 2, gy1 - sill_d / 2, zst))
    for Y in (gy0, gy1):                                       # eave beams over the posts
        wall_y(Y, gx0 - c / 2, gx1 + c / 2, ze - eb, ze)
    for X in (gx0, gx1):                                       # gable ties
        wall_x(X, gy0 + pp / 2, gy1 - pp / 2, ze - eb, ze)
    for Y in (gy0, gy1):                                       # posts and rails, long walls
        for k, x in enumerate(bays):
            w = pw_[k]
            aabb(bm, (x - w / 2, Y - w / 2, zst), (x + w / 2, Y + w / 2, ze - eb))
        for k in range(B):
            wall_y(Y, bays[k] + pw_[k] / 2, bays[k + 1] - pw_[k + 1] / 2, zrl - rail_h / 2, zrl + rail_h / 2)
    wall_x(gx0, -pp / 2, pp / 2, zst, ze - eb)                 # back gable: centre mullion + rails
    for ya_, yb_ in ((gy0 + c / 2, -pp / 2), (pp / 2, gy1 - c / 2)):
        wall_x(gx0, ya_, yb_, zrl - rail_h / 2, zrl + rail_h / 2)
    for sgn in (-1, 1):                                        # front gable: door posts + rails
        wall_x(gx1, sgn * dy - pp / 2, sgn * dy + pp / 2, zst, ze - eb)
    for ya_, yb_ in ((gy0 + c / 2, -dy - pp / 2), (dy + pp / 2, gy1 - c / 2)):
        wall_x(gx1, ya_, yb_, zrl - rail_h / 2, zrl + rail_h / 2)
    fan_c, fan_r = ze + 0.062, 0.034
    wall_x(gx0, -pp / 2, pp / 2, ze, zr - ridge_h)            # king posts (the front one
    wall_x(gx1, -pp / 2, pp / 2, fan_c + fan_r, zr - ridge_h)  # rests on the fan housing)
    aabb(bm, (gx0 - rwg / 2, -ridge_w / 2, zr - ridge_h), (gx1 + rwg / 2, ridge_w / 2, zr))  # ridge
    t_hi = 1 - (ridge_w / 2) / gy1
    for k, x in enumerate(bays):                               # rafters: from the eave line to the ridge
        for side in (-1, 1):
            y1_, z1_ = slope(side, 0.0)
            y2_, z2_ = slope(side, t_hi)
            member(bm, (x, y1_, z1_), (x, y2_, z2_), rws[k], rd, nrm=rnorm(side),
                   cut1=(1, side * (gy1 + pp / 2)), cut2=(1, side * ridge_w / 2))
    for side in (-1, 1):                                       # purlins, same section, flush
        yp, zp = slope(side, p["PURLIN"])
        for k in range(B):
            member(bm, (bays[k] + rws[k] / 2, yp, zp), (bays[k + 1] - rws[k + 1] / 2, yp, zp),
                   rw, rd, nrm=rnorm(side))
    finish("frame_main", bm, c_struct, [m_frame], bevel=BEV, segments=3, sharp=50)

    # ---- glass
    bm = bmesh.new()
    for Y in (gy0, gy1):
        pane(bm, [(gx0, Y, zst), (gx1, Y, zst), (gx1, Y, ze - eb), (gx0, Y, ze - eb)])
    for side in (-1, 1):
        ye_, ze_ = slope(side, 0)
        if side == sv:
            yp, zp = slope(side, p["PURLIN"])
            pane(bm, [(gx0, ye_, ze_), (gx0, 0, zr_c), (xa, 0, zr_c), (xa, ye_, ze_)])
            pane(bm, [(xb, ye_, ze_), (xb, 0, zr_c), (gx1, 0, zr_c), (gx1, ye_, ze_)])
            pane(bm, [(xa, ye_, ze_), (xa, yp, zp), (xb, yp, zp), (xb, ye_, ze_)])
        else:
            pane(bm, [(gx0, ye_, ze_), (gx1, ye_, ze_), (gx1, 0, zr_c), (gx0, 0, zr_c)])
    for X in (gx0, gx1):
        pane(bm, [(X, gy0, ze), (X, gy1, ze), (X, gy1, ze_c), (X, 0, zr_c), (X, gy0, ze_c)])
    pane(bm, [(gx0, gy0, zst), (gx0, gy1, zst), (gx0, gy1, ze - eb), (gx0, gy0, ze - eb)])
    pane(bm, [(gx1, gy0, zst), (gx1, -dy, zst), (gx1, -dy, ze - eb), (gx1, gy0, ze - eb)])
    pane(bm, [(gx1, dy, zst), (gx1, gy1, zst), (gx1, gy1, ze - eb), (gx1, dy, ze - eb)])
    finish("glass_main", bm, c_struct, [m_glass])

    # ---- door: a slim glazed leaf between the door posts, sill to eave, flush outside.
    # Empty "door" on the hinge (the app rotates it), leaf as child.
    m_hw = material("hardware", "d6cfc4", rough=0.45)
    g, sw, ld, kick = 0.0012, 0.0085, 0.008, 0.016
    xf = gx1 + pp / 2                       # outer face of the wall
    xc = xf - ld / 2                        # leaf centre plane
    y_l, y_r = -dy + pp / 2 + g, dy - pp / 2 - g
    z_b, z_t = zst + g, ze - eb - g
    hinge = Vector((xc, y_l, zst))
    bm = bmesh.new()
    aabb(bm, (xc - ld / 2, y_l, z_b), (xf, y_l + sw, z_t))
    aabb(bm, (xc - ld / 2, y_r - sw, z_b), (xf, y_r, z_t))
    aabb(bm, (xc - ld / 2, y_l + sw, z_t - sw), (xf, y_r - sw, z_t))
    aabb(bm, (xc - ld / 2, y_l + sw, z_b), (xf, y_r - sw, z_b + kick))
    zh, yh = zst + (ze - eb - zst) * 0.45, y_r - sw / 2
    for zz in (zh - 0.022, zh + 0.022):                        # handle: slim bar on stand-offs
        aabb(bm, (xf, yh - 0.0015, zz - 0.0015), (xf + 0.006, yh + 0.0015, zz + 0.0015), 2)
    aabb(bm, (xf + 0.0045, yh - 0.002, zh - 0.03), (xf + 0.0080, yh + 0.002, zh + 0.03), 2)
    for zz in (z_b + 0.04, z_t - 0.04):                        # hinges
        aabb(bm, (xf - 0.001, y_l - 0.003, zz - 0.009), (xf + 0.0025, y_l + 0.004, zz + 0.009), 2)
    leaf = finish("door_leaf", bm, c_struct, [m_frame, m_glass, m_hw], bevel=0.0007, segments=2, sharp=50,
                  after=lambda b: pane(b, [(xc, y_l + sw, z_b + kick), (xc, y_r - sw, z_b + kick),
                                           (xc, y_r - sw, z_t - sw), (xc, y_l + sw, z_t - sw)], 1),
                  origin=hinge)
    door = bpy.data.objects.new("door", None)
    door.empty_display_size = 0.03
    door.location = hinge
    door.rotation_euler = (0, 0, math.radians(-8))      # slightly ajar, opening outwards
    c_struct.objects.link(door)
    leaf.parent = door
    leaf.matrix_parent_inverse = Matrix.Identity(4)
    leaf.location = (0, 0, 0)

    # ---- roof vent: glass lid whose frame sits right on top of the two rafters,
    # the purlin and the ridge edge of its panel (one continuous grid), hinged
    # along the top edge; shape key "open".
    n = rnorm(sv)
    vd, vw = 0.005, rw
    lift = n * (rd / 2 + vd / 2 + 0.0006)
    t_top = 1 - (ridge_w / 2 + vw / 2) / slope_len
    t_bot = p["PURLIN"]
    dt = lambda dist: dist / slope_len

    def sp_(x, t):
        y, z = slope(sv, t)
        return Vector((x, y, z)) + lift

    bm = bmesh.new()
    member(bm, sp_(xa, t_bot - dt(vw / 2)), sp_(xa, t_top + dt(vw / 2)), vw, vd, nrm=n)
    member(bm, sp_(xb, t_bot - dt(vw / 2)), sp_(xb, t_top + dt(vw / 2)), vw, vd, nrm=n)
    member(bm, sp_(xa + vw / 2, t_top), sp_(xb - vw / 2, t_top), vw, vd, nrm=n)
    member(bm, sp_(xa + vw / 2, t_bot), sp_(xb - vw / 2, t_bot), vw, vd, nrm=n)
    vp = [sp_(xa + vw / 2, t_bot + dt(vw / 2)), sp_(xb - vw / 2, t_bot + dt(vw / 2)),
          sp_(xb - vw / 2, t_top - dt(vw / 2)), sp_(xa + vw / 2, t_top - dt(vw / 2))]
    hinge_p = sp_((xa + xb) / 2, t_top + dt(vw / 2))
    for hx in (xa + 0.03, xb - 0.03):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.0028, radius2=0.0028, depth=0.022,
                              matrix=Matrix.Translation((hx, hinge_p.y, hinge_p.z)) @ Matrix.Rotation(math.radians(90), 4, "Y"))
    arm_top = sp_((xa + xb) / 2, t_bot + dt(vw / 2))
    arm_end = arm_top - n * 0.026
    member(bm, arm_top, arm_end, 0.0032, 0.0032, nrm=Vector((1, 0, 0)))
    vent = finish("vent_window", bm, c_struct, [m_frame, m_glass], bevel=0.0008, segments=2, sharp=50,
                  after=lambda b: pane(b, vp, 1), origin=sp_((xa + xb) / 2, t_top + dt(vw / 2)))
    vent.shape_key_add(name="Basis")
    key = vent.shape_key_add(name="open")
    key.value = 0.0                                   # always exported closed
    rot = Matrix.Rotation(math.radians(sv * p["VENT_OPEN_DEG"]), 3, "X")
    for i, v in enumerate(vent.data.vertices):
        key.data[i].co = rot @ v.co

    # ---- devices (docs/06): tank + level gauge, pump, hose, grow light, fan, sensor box
    m_dev = material("device", "f1ede6", rough=0.6)
    m_dark = material("device_dark", "9a948c", rough=0.5)
    m_water = material("water", "9cc9c4", rough=0.2)
    m_led = material("led", "9bc38e", rough=0.4)
    m_light = material("light_strip", "fff3df", rough=0.3)
    lb = m_light.node_tree.nodes["Principled BSDF"]
    if "Emission Color" in lb.inputs:
        lb.inputs["Emission Color"].default_value = (*lin("ffd9a0"), 1.0)
        lb.inputs["Emission Strength"].default_value = 2.5
    zb = BH + 0.002                                            # top of the sand tray

    # water tank, outside the back gable; gauge strip on the face towards the camera
    inner, outer = x0b + RW + 0.004, gx0 - sill_d / 2 - 0.006
    tw, td, th = min(0.085, outer - inner), 0.105, 0.19
    tx, ty = (inner + outer) / 2, gy0 + 0.01            # front corner, visible from the camera
    fy = ty - td / 2

    # body: soft jerrycan with rounded corners, a shoulder up to the neck and a recessed foot
    bm = bmesh.new()
    rr_loft(bm, tx, ty, tw, td, 0.022,
            [(0.006, zb), (0.0045, zb + 0.004), (0.0, zb + 0.011), (0.0, zb + th - 0.034),
             (0.003, zb + th - 0.018), (0.010, zb + th - 0.007), (0.018, zb + th - 0.002), (0.022, zb + th)])
    neck = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.0115, radius2=0.0115, depth=0.008,
                                 matrix=Matrix.Translation((tx, ty, zb + th + 0.003)))
    cap = bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.016, radius2=0.0155, depth=0.013,
                                matrix=Matrix.Translation((tx, ty, zb + th + 0.0125)))
    for i, v in enumerate(sorted(cap["verts"], key=lambda v: math.atan2(v.co.y - ty, v.co.x - tx))):
        pass
    for v in cap["verts"]:                                     # grip ridges
        dx, dy_ = v.co.x - tx, v.co.y - ty
        rr_ = math.hypot(dx, dy_)
        if rr_ > 0.01:
            a = math.atan2(dy_, dx)
            k = 1.0 + 0.05 * math.cos(14 * a)
            v.co.x, v.co.y = tx + dx * k, ty + dy_ * k
    for f in {f for v in cap["verts"] for f in v.link_faces}:
        f.material_index = 1
    # level gauge: raised bezel frame around an inset window (dark back, water strip,
    # glass cover), raised ticks with a longer middle one, two screws
    gz0, gz1 = zb + 0.03, zb + th - 0.045
    gw, fr = 0.0072, 0.0034                                   # window half width, frame width
    for (x0_, x1_, z0_, z1_) in ((tx - gw - fr, tx - gw, gz0 - fr, gz1 + fr), (tx + gw, tx + gw + fr, gz0 - fr, gz1 + fr),
                                 (tx - gw, tx + gw, gz0 - fr, gz0), (tx - gw, tx + gw, gz1, gz1 + fr)):
        merge_bm(bm, soft_box((x0_, fy - 0.0036, z0_), (x1_, fy + 0.002, z1_), 0.0011, seg=2), 0)
    aabb(bm, (tx - gw, fy - 0.0009, gz0), (tx + gw, fy + 0.001, gz1), 1)          # dark back
    pane(bm, [(tx - gw, fy - 0.0027, gz0), (tx + gw, fy - 0.0027, gz0),
              (tx + gw, fy - 0.0027, gz1), (tx - gw, fy - 0.0027, gz1)], 2)       # glass cover
    for k in range(1, 8):
        z = gz0 + (gz1 - gz0) * k / 8
        L_ = 0.0026 if k == 4 else 0.0016
        merge_bm(bm, soft_box((tx + gw + fr - L_ - 0.0003, fy - 0.0043, z - 0.00045),
                              (tx + gw + fr - 0.0003, fy - 0.0034, z + 0.00045), 0.0002, seg=1), 1)
    for z in (gz0 - fr / 2, gz1 + fr / 2):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.0011, radius2=0.0009, depth=0.0008,
                              matrix=Matrix.Translation((tx, fy - 0.004, z)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    # inlet boss on the tank top, where the rain downpipe enters
    ix_, iy_ = tx + 0.012, ty - 0.024
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.0068, radius2=0.0064, depth=0.006,
                          matrix=Matrix.Translation((ix_, iy_, zb + th + 0.002)))
    # outlet tap on the side facing the pump
    oy = ty + td / 2
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.0062, radius2=0.0055, depth=0.012,
                          matrix=Matrix.Translation((tx, oy + 0.004, zb + 0.016)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    tank = finish("tank", bm, c_dev, [m_dev, m_dark, m_glass])
    tank.data.shade_smooth()
    tank.data.set_sharp_from_angle(angle=math.radians(40))
    wz0 = gz0 + 0.002
    bm = bmesh.new()
    aabb(bm, (tx - gw + 0.0004, fy - 0.0016, wz0), (tx + gw - 0.0004, fy - 0.0011, gz1 - 0.002))
    finish("tank_water", bm, c_dev, [m_water], bevel=0.0008, segments=1,
           origin=(tx, fy - 0.0014, wz0))                    # app scales z by level

    # pump next to the tank, hoses tank -> pump -> into the greenhouse
    py = ty + td / 2 + 0.024
    bm = bmesh.new()
    aabb(bm, (tx - 0.018, py - 0.016, zb), (tx + 0.018, py + 0.016, zb + 0.026))
    finish("pump", bm, c_dev, [m_dev, m_dark], bevel=0.004,
           after=lambda b: aabb(b, (tx - 0.012, py - 0.0165, zb + 0.008), (tx + 0.012, py - 0.015, zb + 0.018), 1))
    bm = bmesh.new()
    tube(bm, bez((tx, ty + td / 2 + 0.009, zb + 0.016), (tx, py - 0.02, zb + 0.004),
                 (tx, py - 0.015, zb + 0.012), n=6), 0.0033, mat=0)
    tube(bm, bez((tx + 0.006, py, zb + 0.026), (tx + 0.006, py, zb + 0.075),
                 (gx0 - pp / 2, py + 0.02, zst + 0.035)), 0.0035, mat=0)
    hose = finish("tank_hose", bm, c_dev, [m_dark])
    hose.data.shade_smooth()

    # grow light bar hanging under the ridge, light strip underneath
    zl = zr - ridge_h - 0.04
    lx0, lx1 = gx0 + 0.11, gx1 - 0.11

    def light_extras(b):
        merge_bm(b, soft_box((lx0 + 0.008, -0.0085, zl - 0.0135), (lx1 - 0.008, 0.0085, zl - 0.0055), 0.0035, seg=3), 1)
        for x in (lx0 + 0.05, lx1 - 0.05):
            tube(b, [(x, 0, zl + 0.005), (x, 0, zr - ridge_h + 0.001)], 0.0012, seg=6)
    bm = bmesh.new()
    aabb(bm, (lx0, -0.009, zl - 0.006), (lx1, 0.009, zl + 0.006))
    finish("grow_light", bm, c_dev, [m_dev, m_light], bevel=0.004, after=light_extras, origin=((lx0 + lx1) / 2, 0, zl))

    # fan in the front gable: housing + grille (static), blades (the app spins them about x)
    fc = Vector((gx1, 0, fan_c))
    m_fanback = material("fan_back", "bdb6ac", rough=0.7)
    m_blade = material("fan_blade", "d3ccc2", rough=0.5)
    bm = bmesh.new()
    ring_x(bm, fc + Vector((0.004, 0, 0)), fan_r, fan_r - 0.005, 0.028)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=fan_r - 0.005, radius2=fan_r - 0.005, depth=0.002,
                          matrix=Matrix.Translation((gx1 - 0.008, 0, fan_c)) @ Matrix.Rotation(math.radians(90), 4, "Y"))
    aabb(bm, (gx1 - 0.006, -0.009, ze), (gx1 + 0.012, 0.009, fan_c - fan_r + 0.003))     # bracket on the gable tie
    xf = gx1 + 0.017
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.26
        d_ = Vector((0, math.cos(a), math.sin(a)))
        member(bm, Vector((xf, 0, fan_c)) + d_ * 0.007, Vector((xf, 0, fan_c)) + d_ * (fan_r - 0.004),
               0.0016, 0.0016, nrm=Vector((1, 0, 0)))
    hub = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.008, radius2=0.008, depth=0.003,
                                matrix=Matrix.Translation((xf, 0, fan_c)) @ Matrix.Rotation(math.radians(90), 4, "Y"))
    for f in bm.faces:                                         # back plate in a darker tone
        if f.calc_center_median().x < gx1 - 0.0075 and (f.calc_center_median() - fc).length < fan_r - 0.004:
            f.material_index = 1
    fan = finish("fan", bm, c_dev, [m_dev, m_fanback], bevel=0.0008, segments=2, sharp=50, origin=fc)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.006, radius2=0.006, depth=0.008,
                          matrix=Matrix.Rotation(math.radians(90), 4, "Y"))
    for k in range(5):
        vs = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0)["verts"]
        for v in vs:
            x, y, z = v.co
            t = (y + 1) / 2
            v.co = Vector((x * 0.0012, 0.006 + t * 0.023, z * 0.0065 * (0.6 + 0.4 * math.sin(math.pi * t))))
        bmesh.ops.transform(bm, verts=vs, matrix=Matrix.Rotation(2 * math.pi * k / 5, 4, "X")
                            @ Matrix.Rotation(math.radians(28), 4, "Y"))
    blades = finish("fan_blades", bm, c_dev, [m_blade])
    blades.data.shade_smooth()
    blades.location = fc

    # sensor box on the outer face of a front-wall post, cable down to the sill
    bx, y0, zc = bays[1], gy0 - pp / 2, zrl + 0.07

    def box_extras(b):
        for dz in (-0.004, 0.0, 0.004):
            aabb(b, (bx - 0.007, y0 - 0.0124, zc - 0.006 + dz - 0.0006), (bx + 0.007, y0 - 0.0117, zc - 0.006 + dz + 0.0006), 1)
        led = bmesh.ops.create_uvsphere(b, u_segments=8, v_segments=5, radius=0.0014,
                                        matrix=Matrix.Translation((bx + 0.006, y0 - 0.012, zc + 0.011)))
        for f in {f for v in led["verts"] for f in v.link_faces}:
            f.material_index = 2
        tube(b, [(bx, y0 - 0.004, zc - 0.016), (bx, y0 - 0.004, zst + 0.001)], 0.0011, seg=6, mat=1)
    bm = bmesh.new()
    aabb(bm, (bx - 0.011, y0 - 0.012, zc - 0.017), (bx + 0.011, y0, zc + 0.017))
    finish("sensor_box", bm, c_dev, [m_dev, m_dark, m_led], bevel=0.003, after=box_extras)

    # ---- construction details: gaskets, screws, gutter + downpipe into the tank,
    # vent servo, cables. Small, but they make it read as a finished product.
    m_hw2 = material("hardware", "d6cfc4", rough=0.45)
    m_gasket = material("gasket", "a39d95", rough=0.75)
    bm = bmesh.new()
    gw, gp = 0.0016, 0.0022

    def cell(axis, P0, a0, a1, z0_, z1_):
        for s in (-1, 1):
            o = P0 + s * (gp / 2 + 0.0004)
            for lo, hi in (((a0, z0_), (a1, z0_ + gw)), ((a0, z1_ - gw), (a1, z1_)),
                           ((a0, z0_), (a0 + gw, z1_)), ((a1 - gw, z0_), (a1, z1_))):
                if axis == "y":
                    aabb(bm, (lo[0], o - gp / 2, lo[1]), (hi[0], o + gp / 2, hi[1]), 1)
                else:
                    aabb(bm, (o - gp / 2, lo[0], lo[1]), (o + gp / 2, hi[0], hi[1]), 1)
    rows = ((zst, zrl - rail_h / 2), (zrl + rail_h / 2, ze - eb))
    for Y in (gy0, gy1):
        for k in range(B):
            for r0, r1 in rows:
                cell("y", Y, bays[k] + pw_[k] / 2, bays[k + 1] - pw_[k + 1] / 2, r0, r1)
    for X, cols in ((gx0, ((gy0 + c / 2, -pp / 2), (pp / 2, gy1 - c / 2))),
                    (gx1, ((gy0 + c / 2, -dy - pp / 2), (dy + pp / 2, gy1 - c / 2)))):
        for y0_, y1_ in cols:
            for r0, r1 in rows:
                cell("x", X, y0_, y1_, r0, r1)

    def screw(p, axis):
        rot = Matrix.Rotation(math.radians(90), 4, "X" if axis == "y" else "Y")
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.0012, radius2=0.001, depth=0.0009,
                              matrix=Matrix.Translation(p) @ rot)
    for Y, s in ((gy0, -1), (gy1, 1)):
        for k, x in enumerate(bays):
            yf_ = Y + s * (pw_[k] / 2 + 0.0003)
            for z in (zrl, ze - eb / 2):
                screw((x, yf_, z), "y")
            screw((x, Y + s * (sill_d / 2 + 0.0003), z0 + sill_h / 2), "y")
    for y in (gy0 + 0.04, -0.04, 0.04, gy1 - 0.04):
        screw((gx1 + pp / 2 + 0.0003, y, ze - eb / 2), "x")
    finish("frame_details", bm, c_struct, [m_hw2, m_gasket])

    # half-round gutters along both eaves, with brackets; downpipe from the front one into the tank
    rg, tg = 0.0068, 0.0011
    bm = bmesh.new()
    for s in (-1, 1):
        yc, zc = s * (gy1 + pp / 2 + rg + 0.0012), ze + 0.004
        x0g, x1g = gx0 - 0.012, gx1 + 0.012
        fall = 0.005                                      # falls towards x0 (downpipe end)
        zcx = lambda x: zc - fall * (x1g - x) / (x1g - x0g)
        segs = 10
        def arc_pts(x, r):
            return [Vector((x, yc + r * math.cos(math.pi + math.pi * i / segs), zcx(x) + r * math.sin(math.pi + math.pi * i / segs)))
                    for i in range(segs + 1)]
        V = {(x, r): [bm.verts.new(p) for p in arc_pts(x, r)] for x in (x0g, x1g) for r in (rg, rg - tg)}
        for i in range(segs):
            for r in (rg, rg - tg):
                bm.faces.new([V[(x0g, r)][i], V[(x0g, r)][i + 1], V[(x1g, r)][i + 1], V[(x1g, r)][i]])
        for x in (x0g, x1g):
            bm.faces.new(V[(x, rg)])                           # end caps
        for i in (0, segs):
            bm.faces.new([V[(x0g, rg)][i], V[(x1g, rg)][i], V[(x1g, rg - tg)][i], V[(x0g, rg - tg)][i]])
        for x in bays:                                         # brackets
            aabb(bm, (x - 0.002, yc - s * (rg + 0.0015), zcx(x) - rg - 0.0012), (x + 0.002, yc + s * 0.0005, zcx(x) - rg + 0.0004))
    yc0 = -(gy1 + pp / 2 + rg + 0.0012)
    x_dp = gx0 + 0.014
    z_top = zb + th
    z_out = ze + 0.004 - 0.005 * (gx1 + 0.012 - x_dp) / (L + 0.024) - rg
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.0058, radius2=0.0058, depth=0.006,
                          matrix=Matrix.Translation((x_dp, yc0, z_out - 0.002)))           # outlet collar
    ix_, iy_ = tx + 0.012, ty - 0.024                      # tank inlet boss (see tank)
    z_run = z_top + 0.045
    pts = rounded_path([(x_dp, yc0, z_out + 0.001), (x_dp, yc0, z_run), (ix_, iy_, z_run),
                        (ix_, iy_, z_top + 0.004)], 0.016, n=8)
    tube(bm, pts, 0.0042, seg=12)
    for z in (ze - 0.08, z_top + 0.1):
        aabb(bm, (x_dp - 0.005, yc0 - 0.005, z - 0.003), (x_dp + 0.005, gy0 - c / 2, z + 0.003))
    g_obj = finish("gutter", bm, c_struct, [m_dev])
    g_obj.data.shade_smooth()

    # vent servo under the purlin, where the opener arm lands
    bm = bmesh.new()
    sc_ = arm_end - n * 0.006
    member(bm, sc_ - Vector((0.012, 0, 0)), sc_ + Vector((0.012, 0, 0)), 0.013, 0.012, nrm=n)
    finish("vent_servo", bm, c_dev, [m_dev], bevel=0.002)

    # discreet cables: grow light -> ridge -> fan, fan -> down the door post
    bm = bmesh.new()
    xi = gx1 - pp / 2 - 0.0016
    zrb = zr - ridge_h - 0.0016
    tube(bm, [(lx1 - 0.004, 0.003, zl + 0.004), (lx1 - 0.004, 0.003, zrb), (gx1 - 0.012, 0.003, zrb),
              (xi, 0.003, zrb - 0.004), (xi, 0.003, fan_c + fan_r + 0.002)], 0.0011, seg=6)
    sag = bez((xi, 0.022, fan_c - fan_r + 0.006), (xi, dy * 0.75, ze - eb - 0.03), (xi, dy - 0.002, ze - eb - 0.008), n=8)
    tube(bm, sag + [Vector((xi, dy, ze - eb - 0.016)), Vector((xi, dy, zst + 0.002))], 0.0011, seg=6)
    for z in (zrl + 0.04, zst + 0.05):                  # clips holding it to the door post
        aabb(bm, (xi - 0.0018, dy - 0.0022, z - 0.0016), (xi + 0.0016, dy + 0.0022, z + 0.0016))
    cab = finish("cables", bm, c_dev, [m_dark])
    cab.data.shade_smooth()

    # ---- decor (optional, docs/02 "dosificar"): a garden layer on the plinth.
    # Merged into two meshes so it costs two draw calls in the app.
    c_dec = collection("decor")
    rng = random.Random(11)
    PAL = ["b49878", "c0a482", "e3d8c8", "d2c4b0", "c9bfb1", "b5aa9a", "ddd5c9",
           HEX["leaf_deep"], HEX["leaf_mid"], "7f9a5e", "93a868", "5f7a45",
           "a7b07a", "6e8a55", "8c9d69", "f1ebdf", "e8c9c1", "e9dcae", "c2b6a4", "8f8476"]
    SOIL, SOIL2, PEB1, PEB2, ST1, ST2, ST3, LD, LM, B1, B2, B3 = range(12)
    G1, G2, G3, FW, FP, FY, ST4, ST5 = range(12, 20)
    tray0 = (x0b + RW + 0.006, y0b + RW + 0.006)
    tray1 = (x1b - RW - 0.006, y1b - RW - 0.006)
    t_in, t_out = x0b + RW + 0.004, gx0 - 0.0095 - 0.006

    def free(x, y, r):
        if not (tray0[0] + r < x < tray1[0] - r and tray0[1] + r < y < tray1[1] - r):
            return False
        if gx0 - 0.016 - r < x < gx1 + 0.016 + r and gy0 - 0.016 - r < y < gy1 + 0.016 + r:
            return False
        if x > gx1 and abs(y) < PW / 2 + 0.012 + r:                       # path
            return False
        if tx - tw / 2 - 0.006 - r < x < tx + tw / 2 + 0.006 + r and ty - td / 2 - 0.005 - r < y < py + 0.02 + r:  # tank + pump
            return False
        return True

    bmg = bmesh.new(); cg = bmg.verts.layers.int.new("cid")
    bmp = bmesh.new(); cp = bmp.verts.layers.int.new("cid")

    def blob(cx, cy, rx, ry, cid, h=0.003):
        n = 18
        rs = [1 + rng.uniform(-0.28, 0.28) for _ in range(n)]
        ang0 = rng.uniform(0, 6.28)
        bot, top = [], []
        for i in range(n):
            a = ang0 + 2 * math.pi * i / n
            r_ = (rs[i] + rs[i - 1] + rs[(i + 1) % n]) / 3
            x, y = cx + rx * r_ * math.cos(a), cy + ry * r_ * math.sin(a)
            bot.append(bmg.verts.new((x, y, zb - 0.001)))
            top.append(bmg.verts.new((cx + (x - cx) * 0.88, cy + (y - cy) * 0.88, zb + h)))
        for i in range(n):
            j = (i + 1) % n
            bmg.faces.new([bot[i], bot[j], top[j], top[i]])
        bmg.faces.new(top)
        for v in bot + top:
            v[cg] = cid

    # three reusable faceted stone shapes (rounded, slightly flat), placed with
    # random scale / rotation / tone and partly buried in the ground
    shapes = []
    for s_ in range(5):
        b_ = bmesh.new()
        bmesh.ops.create_icosphere(b_, subdivisions=2 if s_ < 3 else 1, radius=1.0)
        r2 = random.Random(100 + s_)
        bumps = [Vector((r2.uniform(-1, 1), r2.uniform(-1, 1), r2.uniform(-1, 1))).normalized() for _ in range(5)]
        for v in b_.verts:
            n_ = v.co.normalized()
            k = 1 + sum(0.06 * max(0.0, n_.dot(bp)) ** 2 for bp in bumps) - 0.06 * max(0.0, n_.z) ** 4
            v.co = Vector((n_.x * k, n_.y * k * (0.8 + 0.1 * (s_ % 3)), n_.z * k * (0.55 + 0.08 * (s_ % 3))))
        shapes.append([v.co.copy() for v in b_.verts])
        shapes[-1] = (shapes[-1], [[v.index for v in f.verts] for f in b_.faces])
        b_.free()

    def rock(cx, cy, r, cid, bury=0.35):
        pts, faces = rng.choice(shapes[:3] if r > 0.007 else shapes[3:])
        rot = Matrix.Rotation(rng.uniform(0, 6.28), 3, "Z") @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 3, "X")
        sx, sy, sz = rng.uniform(0.85, 1.15), rng.uniform(0.8, 1.1), rng.uniform(0.8, 1.15)
        h = r * 0.6 * sz
        vs = [bmg.verts.new(rot @ Vector((p.x * r * sx, p.y * r * sy, p.z * r * sz)) + Vector((cx, cy, zb + h * (1 - 2 * bury))))
              for p in pts]
        for f in faces:
            bmg.faces.new([vs[i] for i in f])
        for v in vs:
            v[cg] = cid

    def pebbles(cx, cy, rad, n, cids=None):
        for _ in range(n):
            for _try in range(8):
                a, d = rng.uniform(0, 2 * math.pi), rad * math.sqrt(rng.random())
                x, y = cx + d * math.cos(a), cy + d * math.sin(a)
                r = rng.uniform(0.0022, 0.005)
                if free(x, y, r):
                    rock(x, y, r, rng.choice(cids or [PEB1, PEB2, ST3, ST4]), bury=0.45)
                    break

    def leaf_card(base, length, width, yaw, pitch, cid, bend=0.25, roll=0.0):
        vs = soft_leaf(bmp, length, width, "obovate", width * 0.2, K=7, rows=2, cup=0.2, bend=bend)
        m = (Matrix.Translation(Vector(base)) @ Matrix.Rotation(yaw, 4, "Z")
             @ Matrix.Rotation(-pitch, 4, "Y") @ Matrix.Rotation(roll, 4, "X"))
        bmesh.ops.transform(bmp, matrix=m, verts=vs)
        for v in vs:
            v[cp] = cid

    def stalk(pts, r0, r1, cid):
        pts = [Vector(p) for p in pts]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            u = t.cross(Vector((0, 0, 1)) if abs(t.z) < 0.95 else Vector((1, 0, 0))).normalized()
            w = t.cross(u)
            r = r0 + (r1 - r0) * i / (len(pts) - 1)
            rings.append([bmp.verts.new(p + (u * math.cos(2 * math.pi * k / 6) + w * math.sin(2 * math.pi * k / 6)) * r)
                          for k in range(6)])
        for A, B_ in zip(rings, rings[1:]):
            for k in range(6):
                bmp.faces.new([A[k], A[(k + 1) % 6], B_[(k + 1) % 6], B_[k]])
        for ring in rings:
            for v in ring:
                v[cp] = cid

    def bush(cx, cy, size):
        """Rounded bush (ref-03): a few soft lobes huddled together, lighter on top."""
        greens = rng.sample([B1, B2, B3, G1, G2], 2)
        lobes = [(0.0, 0.0, 0.40, greens[0])]
        n = rng.randint(4, 6)
        a0 = rng.uniform(0, 6.28)
        for i in range(n):
            a = a0 + 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
            lobes.append((math.cos(a) * 0.34, math.sin(a) * 0.34, rng.uniform(0.24, 0.33),
                          greens[i % 2]))
        for lx, ly, lr, cid in lobes:
            r = size * lr
            m = (Matrix.Translation((cx + lx * size, cy + ly * size, zb + r * 0.72))
                 @ Matrix.Diagonal((1.0, 1.0, 0.9, 1.0)))
            vs = bmesh.ops.create_icosphere(bmp, subdivisions=2, radius=r, matrix=m)["verts"]
            for v in vs:
                v[cp] = cid

    def shrub(cx, cy, size):
        """Low, slightly lopsided shrub: a few short branches carrying leaves
        that point outwards and up; two greens, lighter towards the top."""
        lean = rng.uniform(0, 6.28)
        stretch = rng.uniform(0.8, 1.25)
        greens = rng.sample([B1, B2, B3, G1, G2, G3], 3)
        nb = rng.randint(5, 6)
        for i in range(nb):
            ya = lean + 2 * math.pi * i / nb + rng.uniform(-0.35, 0.35)
            reach = size * rng.uniform(0.3, 0.6) * (stretch if math.cos(ya - lean) > 0 else 1.0)
            top = Vector((cx + reach * math.cos(ya), cy + reach * math.sin(ya), zb + size * rng.uniform(0.55, 0.95)))
            mid = Vector((cx + reach * 0.4 * math.cos(ya), cy + reach * 0.4 * math.sin(ya), zb + size * 0.35))
            stalk([(cx, cy, zb - 0.002), mid, top], 0.0016, 0.0008, LD)
            for j in range(5):
                t = 0.3 + 0.7 * j / 4
                base = Vector((cx, cy, zb)).lerp(mid, min(1, t * 2)) if t < 0.5 else mid.lerp(top, (t - 0.5) * 2)
                lyaw = ya + rng.uniform(-1.6, 1.6)
                pitch = rng.uniform(-0.1, 0.45) + 0.55 * t
                L = size * rng.uniform(0.32, 0.44)
                cid = greens[0] if t < 0.5 else greens[1 if rng.random() < 0.7 else 2]
                leaf_card(base, L, L * rng.uniform(0.72, 0.86), lyaw, pitch, cid,
                          bend=rng.uniform(0.12, 0.28), roll=rng.uniform(-0.4, 0.4))

    def grass(cx, cy, h, cid=None):
        """Tuft of curved, tapering blades leaning outwards."""
        for _ in range(rng.randint(7, 10)):
            a = rng.uniform(0, 2 * math.pi)
            hh = h * rng.uniform(0.4, 0.8)
            out = hh * rng.uniform(0.35, 0.75)
            ox, oy = rng.uniform(-0.003, 0.003), rng.uniform(-0.003, 0.003)
            p0 = Vector((cx + ox, cy + oy, zb - 0.001))
            p2 = p0 + Vector((out * math.cos(a), out * math.sin(a), hh))
            p1 = p0 + Vector((out * 0.1 * math.cos(a), out * 0.1 * math.sin(a), hh * 0.75))
            pts = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (0, 0.25, 0.5, 0.75, 1.0)]
            stalk(pts, 0.0022, 0.0005, cid if cid is not None else rng.choice([LM, G1, G3, B2]))

    def flowers(cx, cy, size, col):
        """Small rosette with a few slender stems and simple flowers (low saturation)."""
        for i in range(6):
            ya = 2 * math.pi * i / 6 + rng.uniform(-0.3, 0.3)
            leaf_card((cx, cy, zb + 0.002), size * 0.55, size * 0.3, ya, rng.uniform(-0.1, 0.25), G3, bend=0.2)
        for i in range(rng.randint(2, 3)):
            ya = rng.uniform(0, 6.28)
            tip = Vector((cx + size * 0.3 * math.cos(ya), cy + size * 0.3 * math.sin(ya), zb + size * rng.uniform(0.9, 1.3)))
            stalk([(cx, cy, zb), Vector((cx, cy, zb)).lerp(tip, 0.5) + Vector((0, 0, 0.004)), tip], 0.0009, 0.0006, LD)
            for k in range(5):
                leaf_card(tip, 0.0055, 0.0045, 2 * math.pi * k / 5, 0.25, col, bend=0.05)
            vs = bmesh.ops.create_uvsphere(bmp, u_segments=8, v_segments=5, radius=0.0016,
                                           matrix=Matrix.Translation(tip + Vector((0, 0, 0.001))))["verts"]
            for v in vs:
                v[cp] = FY

    spots = [(tx - 0.012, ty - td / 2 - 0.03, "big", 0.03),          # around the tank
             (t_out + 0.07, gy0 - 0.042, "clump", 0.03),
             (tx, py + 0.075, "big", 0.04), (tx + 0.005, gy1 + 0.035, "big", 0.05),
             (tx, 0.1, "stones", 0.032),
             (tray1[0] - 0.058, gy0 - 0.02, "big", 0.05),               # door corners
             (tray1[0] - 0.05, -PW / 2 - 0.075, "stones", 0.03),
             (tray1[0] - 0.058, gy1 + 0.0, "big", 0.05),
             (tray1[0] - 0.05, PW / 2 + 0.08, "clump", 0.03),
             (-0.24, tray0[1] + 0.036, "clump", 0.03), (0.06, tray0[1] + 0.034, "stones", 0.026),
             (0.3, tray0[1] + 0.036, "clump", 0.026),                  # front strip
             (-0.3, tray1[1] - 0.036, "clump", 0.03), (0.0, tray1[1] - 0.034, "stones", 0.026),
             (0.25, tray1[1] - 0.036, "big", 0.032)]                   # back strip
    # spots: same garden plan; kinds now big / clump / flower / stones / grass.
    # Each group is composed asymmetrically around its anchor.
    kinds = {}
    for idx, (x, y, kind, s) in enumerate(spots):
        if kind == "clump" and idx % 2 == 0:
            kind = "flower"
        kinds[idx] = kind
    for idx, (x, y, _k, s) in enumerate(spots):
        kind = kinds[idx]
        if not free(x, y, 0.008):
            continue
        s *= rng.uniform(0.85, 1.15)
        ang = rng.uniform(0, 6.28)
        ux, uy = math.cos(ang), math.sin(ang)
        blob(x, y, s * rng.uniform(1.1, 1.5), s * rng.uniform(0.85, 1.15), rng.choice([SOIL, SOIL2]), h=0.0015)
        if kind == "big":
            bush(x, y, s * 1.5)
            if free(x - ux * s * 1.3, y - uy * s * 1.3, s * 0.4):
                shrub(x - ux * s * 1.3, y - uy * s * 1.3, s * 1.1)
            grass(x + uy * s * 1.2, y - ux * s * 1.2, s * 1.7)
        elif kind == "clump":
            shrub(x, y, s * 1.45)
            grass(x + ux * s * 1.0, y + uy * s * 1.0, s * 1.5)
        elif kind == "flower":
            flowers(x, y, s * 1.6, rng.choice([FW, FP, FW]))
            grass(x - ux * s, y - uy * s, s * 1.4)
        # stones: one dominant + one or two smaller, buried, with gravel gathered at their foot
        n_st = {"stones": 3, "big": 2, "clump": 1, "flower": 1}[kind]
        for j in range(n_st):
            a = ang + math.pi * (0.7 + 0.5 * j) + rng.uniform(-0.3, 0.3)
            dist = s * rng.uniform(0.9, 1.5)
            x2, y2 = x + math.cos(a) * dist, y + math.sin(a) * dist
            r = (0.019 if j == 0 else 0.011) * rng.uniform(0.75, 1.2) * (1.15 if kind == "stones" else 0.85)
            if free(x2, y2, r):
                rock(x2, y2, r, rng.choice([ST1, ST2, ST3, ST4, ST5]), bury=rng.uniform(0.3, 0.5))
                pebbles(x2, y2, r * 2.0, 6)
                if kind == "stones" and j == 0:
                    grass(x2 + r * 0.9, y2 + r * 0.4, r * 1.6)       # grass in the crack by the stone
        pebbles(x, y, s * 2.2, 10)
        # grass where the soil patch meets the gravel
        if kind != "stones" and rng.random() < 0.7:
            ea = rng.uniform(0, 6.28)
            gx_, gy_ = x + math.cos(ea) * s * 1.6, y + math.sin(ea) * s * 1.2
            if free(gx_, gy_, 0.006):
                grass(gx_, gy_, s * 1.0)

    m_decor = tone_material("decor", rough=0.9)
    for name, b, lay in (("decor_ground", bmg, "cid"), ("decor_plants", bmp, "cid")):
        me = bpy.data.meshes.new(name)
        b.to_mesh(me)
        b.free()
        me.shade_smooth()
        bake_tone(me, lay, PAL)
        me.materials.append(m_decor)
        if name == "decor_plants":
            zmax = max(v.co.z for v in me.vertices) - zb
            w = me.attributes.new("_WIND", "FLOAT", "POINT")
            for i, v in enumerate(me.vertices):
                w.data[i].value = max(0.0, (v.co.z - zb) / zmax) ** 1.5
        c_dec.objects.link(bpy.data.objects.new(name, me))

    # ---- plants: pot + soil from the exercise, generated seedling
    with bpy.data.libraries.load(PLANT_SRC, link=False) as (src, dst):
        dst.objects = [nm for nm in src.objects
                       if nm in ("plant_basil_01", "pot_basil_01", "soil_basil_01")]
    srcmap = {}
    for o in dst.objects:
        base = o.name.split(".")[0]
        o.name = "src_" + base
        srcmap[base] = o
    soil_src = srcmap["soil_basil_01"]
    soil_top = soil_src.location.z + max(v.co.z for v in soil_src.data.vertices)
    plant_meshes = {k: plant_mesh(k, m_leaf) for k in sorted(set(KIND.values()))}
    if bpy.data.materials.get("terracotta"):
        micro_variation(bpy.data.materials["terracotta"], 0.04, 55)
    for pid, sx, sy in PLANTS:
        root = srcmap["plant_basil_01"].copy()
        root.name = "plant_" + pid
        root.location = (sx * p["PLANT_DX"], sy * p["PLANT_DY"], z0)
        c_plants.objects.link(root)
        parts = {"pot": srcmap["pot_basil_01"].copy()}
        parts["pot"].data = pot_mesh("pot_" + pid, srcmap["pot_basil_01"].data.materials[0])
        so = soil_src.copy()
        so.data = soil_src.data.copy()
        so.data.materials[0] = soil_src.data.materials[0].copy()
        parts["soil"] = so
        fo = bpy.data.objects.new("foliage_" + pid, plant_meshes[KIND[pid]])
        ps = POT_SCALE.get(pid, 1.0)
        fo.location = (0, 0, soil_top * ps)
        for o_ in (parts["pot"], so):
            o_.scale = (ps, ps, ps)
        so.location = so.location * ps
        sc_, tx_, ty_ = PLANT_LOOK[pid]
        fo.rotation_euler = (math.radians(tx_), math.radians(ty_), math.radians(SEED_YAW[pid]))
        fo.scale = (sc_, sc_, sc_)
        parts["pot"].rotation_euler = (0, 0, math.radians(POT_YAW[pid]))
        parts["foliage"] = fo
        for part, o in parts.items():
            o.name = part + "_" + pid
            o.parent = root
            o.matrix_parent_inverse = Matrix.Identity(4)
            c_plants.objects.link(o)
    for o in dst.objects:
        bpy.data.objects.remove(o, do_unlink=True)
    for pid, _, _ in PLANTS:
        # The appended exercise data keeps the plain names; drop it, then rename.
        me = bpy.data.objects["soil_" + pid].data
        old_me = bpy.data.meshes.get("soil_" + pid)
        if old_me and old_me != me and old_me.users == 0:
            bpy.data.meshes.remove(old_me)
        me.name = "soil_" + pid
        m = me.materials[0]
        old = bpy.data.materials.get("soil_" + pid)
        if old and old != m and old.users == 0:
            bpy.data.materials.remove(old)
        m.name = "soil_" + pid
        pme = bpy.data.objects["pot_" + pid].data
        old_p = bpy.data.meshes.get("pot_" + pid)
        if old_p and old_p != pme and old_p.users == 0:
            bpy.data.meshes.remove(old_p)
        pme.name = "pot_" + pid

    # ---- helpers (empties the app reads by name)
    def empty(name, loc, size):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = size
        e.location = loc
        c_help.objects.link(e)
    empty("cam_home", (0, 0, (z0 + zr) * 0.45), 0.05)
    for pid, sx, sy in PLANTS:
        px, py = sx * p["PLANT_DX"], sy * p["PLANT_DY"]
        empty("cam_focus_" + pid, (px, py, z0 + 0.07), 0.015)
        empty("anchor_" + pid, (px, py, z0 + 0.17), 0.015)

    # ---- preview only (not exported): ortho camera, soft sun, page
    tgt = Vector((0.0, 0.0, zr * 0.42))
    d = Vector((1.0, -1.15, 0.62)).normalized()      # lower, more natural eye level
    cam = bpy.data.cameras.new("preview_cam")
    cam.type, cam.ortho_scale = "ORTHO", 1.62
    co = bpy.data.objects.new("preview_cam", cam)
    co.location = tgt + d * 3
    co.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    c_prev.objects.link(co)
    bpy.context.scene.camera = co
    sun = bpy.data.lights.new("preview_sun", "SUN")
    sun.energy, sun.color, sun.angle = 3.5, lin("ffe2bf"), math.radians(4.5)   # warm late-afternoon sun
    for nm, loc, size, energy, col in (("preview_lamp", (0, 0, zl - 0.03), (L - 0.24, 0.06), 3.2, "ffcf96"),
                                       ("preview_bounce", (0, 0, z0 + 0.02), (L - 0.08, W - 0.08), 0.7, "ffe2bf")):
        ld = bpy.data.lights.new(nm, "AREA")
        ld.shape, ld.size, ld.size_y = "RECTANGLE", size[0], size[1]
        ld.energy, ld.color = energy, lin(col)
        try:
            ld.spread = math.radians(70)                  # keep the glow inside the greenhouse
        except Exception:
            pass
        lo = bpy.data.objects.new(nm, ld)
        lo.location = loc
        if nm == "preview_bounce":
            lo.rotation_euler = (math.pi, 0, 0)          # faces up: warm light off the floor onto the walls
        c_prev.objects.link(lo)
    so = bpy.data.objects.new("preview_sun", sun)
    so.rotation_euler = Vector((0.25, 1.0, -0.85)).normalized().to_track_quat("-Z", "Y").to_euler()
    c_prev.objects.link(so)
    bm = bmesh.new()
    aabb(bm, (-4, -4, -0.002), (4, 4, -0.001))
    finish("preview_page", bm, c_prev, [m_page])
    sc = bpy.context.scene
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    if w.node_tree is None:
        w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*lin("f4ece1"), 1.0)       # warm, soft sky
        bg.inputs[1].default_value = 0.62
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = -0.45
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000


def main():
    for name in ("structure", "plants", "helpers", "preview", "devices"):
        collection(name)
    old = bpy.data.collections.get("Collection")
    if old and not old.objects and not old.children:
        bpy.data.collections.remove(old)
    bpy.data.orphans_purge(do_recursive=True)
    build()
    bpy.data.orphans_purge(do_recursive=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)          # nothing left selected: avoids accidental moves


if __name__ == "__main__":
    main()
