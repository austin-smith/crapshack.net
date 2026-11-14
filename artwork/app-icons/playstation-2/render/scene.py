"""The original PlayStation 2, modelled and rendered in Blender for its app icon. render.py runs it:

blender -b --factory-startup -P scene.py -- ARTWORK_DIR OUT.png SAMPLES

ARTWORK_DIR holds render.py's decals (decals.json gives each one's size in cm) and mark.json.

Kept from the real console: the matte black case, the left end panel, the stacked front plates
over a dark core, memory card doors side by side above the controller ports, the disc tray with
the PS badge, teal Reset and blue Eject at the right end, and the blue USB / i.LINK panel and
vent in a base that stops short of the right end. Stylized as an icon: seen from above at 46°,
with a deeper footprint, fewer and thicker plates, front details enlarged by DETAIL, the official
PS2 mark raised in glossy letters, and edges picked out in PlayStation blue.

Units are centimetres. L is the distance from the left end, and the front faces -Y.
"""
import bpy, bmesh, json, math, sys
from pathlib import Path

ARTWORK, OUT, SAMPLES = (lambda a: (Path(a[0]), Path(a[1]), int(a[2])))(sys.argv[sys.argv.index("--") + 1:])
SIZES = json.loads((ARTWORK / "decals.json").read_text())
RESOLUTION = 2048
ELEVATION = 46.0  # camera, degrees above the horizon

WIDTH, DEPTH = 30.0, 26.0
FRONT, BACK = -DEPTH / 2, DEPTH / 2
BASE_TOP = 3.6
NPLATES, PLATE, GAP = 5, 1.15, 0.5
# Plate i's bottom and top; plate 1 sits just under the top plate.
P = {i: (BASE_TOP + (NPLATES - i) * (PLATE + GAP), BASE_TOP + (NPLATES - i) * (PLATE + GAP) + PLATE) for i in range(1, NPLATES + 1)}
TOP = (P[1][1] + GAP, P[1][1] + GAP + 1.3)
SIDE = 0.75  # the left end panel
BASE_END = 26.4  # the base stops short of the right end, under the keys
BASE_SETBACK = 1.0
CORNER = 1.6
DETAIL = 1.3  # how much the front's doors, badge, keys and legends are enlarged
BLUE_LIGHT = (0.3, 0.5, 1.0)  # PlayStation blue, for the rim and bounce lights


def X(L):
    return L - WIDTH / 2


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection
cutters = bpy.data.collections.new("cutters")
coll.children.link(cutters)


def nodes(m):
    if m.node_tree is None:
        m.use_nodes = True
    return m.node_tree


def principled(m):
    return next(n for n in nodes(m).nodes if n.type == "BSDF_PRINCIPLED")


def srgb(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1,)


def material(name, colour, rough=0.5, metal=0.0, grain=0.0):
    """A plain material; `grain` bumps it with fine noise like the console's matte texture."""
    m = bpy.data.materials.new(name)
    nt, bsdf = nodes(m), principled(m)
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if grain:
        tc, noise, bump = (nt.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeTexNoise", "ShaderNodeBump"))
        noise.inputs["Scale"].default_value, noise.inputs["Detail"].default_value = 30.0, 4.0
        bump.inputs["Strength"].default_value, bump.inputs["Distance"].default_value = grain, 0.006
        nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def decal_material(name, image, rough=0.4, emission=0.0, colour=None):
    """A printed decal: the image's alpha cuts it out; `colour` replaces its own colour."""
    m = bpy.data.materials.new(name)
    nt, bsdf = nodes(m), principled(m)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(ARTWORK / f"{image}.png"))
    tex.interpolation, tex.extension = "Cubic", "CLIP"
    if colour:
        bsdf.inputs["Base Color"].default_value = (*colour, 1)
    else:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


CASE = material("case", (0.04, 0.04, 0.043), rough=0.5, grain=0.2)
TOP_SHELL = material("top", (0.04, 0.04, 0.043), rough=0.28, grain=0.12)  # a satin top, so it carries the sheen
PLATES = material("plates", (0.036, 0.036, 0.039), rough=0.42, grain=0.15)
CORE = material("core", (0.004, 0.004, 0.005), rough=0.8)
HOLE = material("hole", (0.002, 0.002, 0.002), rough=0.9)
SOCKET = material("socket", (0.06, 0.06, 0.066), rough=0.42)
KEY = material("key", (0.024, 0.024, 0.026), rough=0.3)
SHELL = material("usb-shell", (0.7, 0.7, 0.72), rough=0.3, metal=1.0)
USB_PANEL = material("usb-panel", (0.035, 0.13, 0.62), rough=0.6, grain=0.08)


def outline(x0, x1, y0, y1, r, seg):
    """A rounded rectangle's points, counter-clockwise."""
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def prism(name, pts2d, a0, a1, mat, axis="z", bevel=0.0):
    """Extrude a 2D outline from a0 to a1 along z (lying flat) or y (facing the front)."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((u, v, a0) if axis == "z" else (u, a0, v)) for u, v in pts2d])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    vec = (0, 0, a1 - a0) if axis == "z" else (0, a1 - a0, 0)
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=vec)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width, b.segments, b.limit_method = bevel, 4, "ANGLE"
        b.angle_limit = math.radians(50)
        b.harden_normals = True
    return ob


def block(name, L0, L1, y0, y1, z0, z1, mat, r=0.05, bevel=0.0):
    """A slab lying flat, rounded at its corners seen from above."""
    return prism(name, outline(X(L0), X(L1), y0, y1, min(r, (L1 - L0) / 2.01, (y1 - y0) / 2.01), 8), z0, z1, mat, "z", bevel)


def face_block(name, L0, L1, z0, z1, y0, y1, mat, r=0.05, bevel=0.0):
    """A part on the front, rounded at its corners seen from the front."""
    return prism(name, outline(X(L0), X(L1), z0, z1, min(r, (L1 - L0) / 2.01, (z1 - z0) / 2.01), 6), y0, y1, mat, "y", bevel)


CUTS = {}


def cut(target, cutter):
    """Subtract the cutter from target (before its bevel), and hide the cutter."""
    if target.name not in CUTS:
        c = bpy.data.collections.new(f"cut-{target.name}")
        cutters.children.link(c)
        m = target.modifiers.new("cut", "BOOLEAN")
        m.operand_type, m.collection, m.solver = "COLLECTION", c, "EXACT"
        target.modifiers.move(len(target.modifiers) - 1, 0)
        CUTS[target.name] = c
    for parent in list(cutter.users_collection):
        parent.objects.unlink(cutter)
    CUTS[target.name].objects.link(cutter)
    cutter.hide_render = True


def decal(name, mat, size, centre, y=FRONT - 0.004, scale=1.0, top=None):
    """A decal plane on the front at depth y, centred at (L, height); or lying on the top at height `top`."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0] * scale, size[1] * scale, 1)
    if top is None:
        ob.rotation_euler = (math.radians(90), 0, 0)
        ob.location = (X(centre[0]), y, centre[1])
    else:
        ob.location = (centre[0], centre[1], top)
    ob.data.materials.append(mat)
    return ob


def cylinder(radius, depth, L, y, z, mat, vertices):
    """A disc facing the front."""
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=(X(L), y, z), rotation=(math.radians(90), 0, 0), vertices=vertices)
    bpy.context.object.data.materials.append(mat)


# ---------------- case ----------------
block("side-panel", 0.0, SIDE + 0.05, FRONT, BACK, BASE_TOP - 0.2, P[1][1], CASE, r=CORNER, bevel=0.08)
base = block("base", 0.5, BASE_END, FRONT + BASE_SETBACK, BACK - 0.4, 0.0, BASE_TOP + 0.03, CASE, r=0.6, bevel=0.08)
block("core", SIDE, WIDTH - 0.5, FRONT + 0.5, BACK - 0.2, BASE_TOP, TOP[0] + 0.03, CORE, r=CORNER)
plates = {i: block(f"plate-{i}", SIDE - 0.3, WIDTH, FRONT, BACK - 0.1, z0, z1, PLATES, r=CORNER, bevel=0.2) for i, (z0, z1) in P.items()}
block("top-plate", 0.0, WIDTH, FRONT, BACK, TOP[0], TOP[1], TOP_SHELL, r=CORNER, bevel=0.45)

# Memory card doors side by side across plates 1-2, "MEMORY CARD" on each, "1 · MagicGate · 2" above
DOOR_Z = (P[2][0] + 0.15, P[1][1] - 0.55)
for k, (L0, L1) in enumerate(((2.4, 7.6), (8.4, 13.6)), 1):
    for i in (1, 2):
        cut(plates[i], face_block(f"door{k}-cut{i}", L0 - 0.06, L1 + 0.06, DOOR_Z[0] - 0.06, DOOR_Z[1] + 0.06, FRONT - 1, FRONT + 0.7, HOLE, r=0.08))
    face_block(f"door{k}-well", L0 - 0.06, L1 + 0.06, DOOR_Z[0] - 0.06, DOOR_Z[1] + 0.06, FRONT + 0.6, FRONT + 0.7, HOLE)
    face_block(f"door{k}", L0, L1, DOOR_Z[0], DOOR_Z[1], FRONT + 0.12, FRONT + 0.62, PLATES, r=0.08, bevel=0.04)
    face_block(f"door{k}-slot", L0 + 0.25, L1 - 0.25, DOOR_Z[1] - 0.2, DOOR_Z[1] - 0.09, FRONT + 0.115, FRONT + 0.13, HOLE, r=0.03)
    decal(f"memory-card-{k}", decal_material(f"memory-card-{k}", "memory-card", 0.5), SIZES["memory-card"],
          ((L0 + L1) / 2, sum(DOOR_Z) / 2 - 0.12), y=FRONT + 0.115, scale=1.9 * DETAIL)
LABEL_Z = (DOOR_Z[1] + P[1][1]) / 2 + 0.02
for name, L in (("one", 5.0), ("magicgate", 8.0), ("two", 11.0)):
    decal(f"label-{name}", decal_material(f"label-{name}", name, 0.5), SIZES[name], (L, LABEL_Z), scale=1.6 * DETAIL)

# Controller ports across plates 3-4: three sockets of three pins each
PORT_Z = (P[4][0] + 0.2, P[3][1] - 0.2)
for k, (L0, L1) in enumerate(((2.6, 7.4), (8.6, 13.4)), 1):
    for i in (3, 4):
        cut(plates[i], face_block(f"port{k}-cut{i}", L0, L1, PORT_Z[0], PORT_Z[1], FRONT - 1, FRONT + 0.9, HOLE, r=0.4))
    face_block(f"port{k}-well", L0, L1, PORT_Z[0], PORT_Z[1], FRONT + 0.8, FRONT + 0.9, HOLE, r=0.4)
    gap, inset = 0.14, 0.14
    w = (L1 - L0 - 2 * inset - 2 * gap) / 3
    zc = sum(PORT_Z) / 2
    hh = (PORT_Z[1] - PORT_Z[0]) / 2 - 0.22
    for g in range(3):
        s0 = L0 + inset + g * (w + gap)
        face_block(f"port{k}-socket{g}", s0, s0 + w, zc - hh, zc + hh, FRONT + 0.12, FRONT + 0.85, SOCKET, r=hh * 0.95, bevel=0.05)
        for pin in range(3):
            cylinder(hh * 0.11, 0.1, s0 + w * (0.24 + 0.26 * pin), FRONT + 0.115, zc, HOLE, 24)

# Disc tray seams across plates 2-3, with the PS badge on its pad between them
for L in (14.6, 26.4):
    for i in (2, 3):
        cut(plates[i], face_block(f"seam{L}-{i}", L - 0.05, L + 0.05, P[i][0] - 0.1, P[i][1] + 0.1, FRONT - 1, FRONT + 0.3, HOLE, r=0.01))
BADGE = (20.5, (P[2][0] + P[3][1]) / 2)
cylinder(0.82 * DETAIL, 0.2, BADGE[0], FRONT + 0.07, BADGE[1], KEY, 64)
decal("badge", decal_material("badge", "badge", 0.35, emission=0.2), SIZES["badge"], BADGE, y=FRONT - 0.035, scale=1.75 * DETAIL)

# Reset (plates 1-2) and Eject (plates 3-4) keys at the right end
KEY_L = (29.1 - 1.9 * DETAIL, 29.1)
for name, (z0, z1), cuts in (("reset", (P[2][0] + 0.2, P[1][1] - 0.15), (1, 2)), ("eject", (P[4][0] + 0.15, P[3][1] - 0.2), (3, 4))):
    L0, L1 = KEY_L
    for i in cuts:
        cut(plates[i], face_block(f"{name}-cut{i}", L0 - 0.07, L1 + 0.07, z0 - 0.07, z1 + 0.07, FRONT - 1, FRONT + 0.8, HOLE, r=0.12))
    face_block(f"{name}-well", L0 - 0.07, L1 + 0.07, z0 - 0.07, z1 + 0.07, FRONT + 0.7, FRONT + 0.8, HOLE)
    face_block(name, L0, L1, z0, z1, FRONT - 0.05, FRONT + 0.75, KEY, r=0.12, bevel=0.05)
    cx, cz = (L0 + L1) / 2, (z0 + z1) / 2
    if name == "reset":
        decal("power", decal_material("power", "power", 0.4, emission=0.6), SIZES["power"], (cx, cz + 0.3 * DETAIL), y=FRONT - 0.056, scale=2.2 * DETAIL)
        decal("reset-text", decal_material("reset-text", "reset", 0.4, emission=0.6), SIZES["reset"], (cx, cz - 0.52 * DETAIL), y=FRONT - 0.056, scale=2.2 * DETAIL)
    else:
        decal("eject", decal_material("eject", "eject", 0.4, emission=0.6), SIZES["eject"], (cx, cz), y=FRONT - 0.056, scale=2.0 * DETAIL)

# Base: the blue USB / i.LINK panel and the vent
BF = FRONT + BASE_SETBACK
PANEL = (1.5, 6.2, 0.6, 3.0)
cut(base, face_block("panel-cut", PANEL[0], PANEL[1], PANEL[2], PANEL[3], BF - 1, BF + 0.18, HOLE, r=0.12))
face_block("usb-panel", PANEL[0], PANEL[1], PANEL[2], PANEL[3], BF + 0.17, BF + 0.35, USB_PANEL, r=0.12)
for j, (z0, z1) in enumerate(((1.95, 2.65), (0.95, 1.65))):
    face_block(f"usb{j}-shell", 1.9, 3.75, z0, z1, BF + 0.14, BF + 0.24, SHELL, r=0.03)
    face_block(f"usb{j}", 1.98, 3.67, z0 + 0.08, z1 - 0.08, BF + 0.13, BF + 0.25, HOLE, r=0.02)
    face_block(f"usb{j}-tongue", 2.15, 3.5, z0 + 0.3, z1 - 0.16, BF + 0.12, BF + 0.26, KEY, r=0.02)
face_block("ilink-shell", 4.4, 5.5, 1.95, 2.6, BF + 0.14, BF + 0.24, SHELL, r=0.08)
face_block("ilink", 4.48, 5.42, 2.03, 2.52, BF + 0.13, BF + 0.25, HOLE, r=0.06)

VENT = (7.4, 24.6, 0.75, 2.85)
cut(base, face_block("vent-cut", VENT[0], VENT[1], VENT[2], VENT[3], BF - 1, BF + 0.5, HOLE, r=0.06))
face_block("vent-back", VENT[0], VENT[1], VENT[2], VENT[3], BF + 0.48, BF + 0.52, HOLE)
VENT_COLUMNS, VENT_ROWS = 10, 4
for g in range(VENT_COLUMNS + 1):
    L = VENT[0] + g * (VENT[1] - VENT[0]) / VENT_COLUMNS
    face_block(f"vent-bar{g}", L - 0.16, L + 0.16, VENT[2], VENT[3], BF + 0.03, BF + 0.5, CASE, r=0.02)
for row in range(VENT_ROWS + 1):
    z = VENT[2] + row * (VENT[3] - VENT[2]) / VENT_ROWS
    face_block(f"vent-rail{row}", VENT[0], VENT[1], z - 0.11, z + 0.11, BF + 0.03, BF + 0.5, CASE, r=0.02)

# ---------------- top: the raised PS2 mark, and "PlayStation 2" in gloss black beneath it ----------------
MARK_WIDTH, MARK_HEIGHT, MARK_Y = 24.0, 0.45, 1.4
WORDMARK_GAP = 0.54  # from the mark's lower edge to the wordmark's


def raised_mark():
    """The mark's outlined letters, raised off the top in the console's violet to sky-blue gradient,
    glossy and slightly self-lit so they read against the black."""
    letters = json.loads((ARTWORK / "mark.json").read_text())
    xs = [x for letter in letters for x, _ in letter]
    ys = [y for letter in letters for _, y in letter]
    k = MARK_WIDTH / (max(xs) - min(xs))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    bm = bmesh.new()
    for letter in letters:
        face = bm.faces.new([bm.verts.new(((x - cx) * k, -(y - cy) * k, 0)) for x, y in letter])
        ext = bmesh.ops.extrude_face_region(bm, geom=[face])
        bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=(0, 0, MARK_HEIGHT))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("mark")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("mark", me)
    coll.objects.link(ob)
    ob.location = (0, MARK_Y, TOP[1] - 0.02)
    bevel = ob.modifiers.new("bevel", "BEVEL")
    bevel.width, bevel.segments, bevel.limit_method, bevel.harden_normals = 0.09, 3, "ANGLE", True
    for poly in me.polygons:
        poly.use_smooth = True

    m = bpy.data.materials.new("mark")
    nt, bsdf = nodes(m), principled(m)
    tc, sep, along, ramp = (nt.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeSeparateXYZ", "ShaderNodeMapRange", "ShaderNodeValToRGB"))
    half = (max(ys) - min(ys)) * k / 2
    along.inputs["From Min"].default_value, along.inputs["From Max"].default_value = half, -half
    stops = ramp.color_ramp.elements
    stops[0].position, stops[0].color = 0.0, srgb("#5a5ccb")
    stops[1].position, stops[1].color = 1.0, srgb("#9dd5f1")
    stops.new(0.5).color = srgb("#7a8bd6")
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    nt.links.new(sep.outputs["Y"], along.inputs["Value"])
    nt.links.new(along.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.3
    bsdf.inputs["Roughness"].default_value = 0.22
    bsdf.inputs["Coat Weight"].default_value = 0.6
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    me.materials.append(m)
    return half


mark_half = raised_mark()
wordmark_y = MARK_Y - mark_half - WORDMARK_GAP - SIZES["wordmark"][1] / 2
decal("wordmark", decal_material("wordmark", "wordmark", 0.07, colour=(0.002, 0.002, 0.0022)), SIZES["wordmark"],
      (0, wordmark_y), top=TOP[1] + 0.003)

# ---------------- light, camera, render ----------------
world = bpy.data.worlds.new("world")
scene.world = world
next(n for n in nodes(world).nodes if n.type == "BACKGROUND").inputs["Color"].default_value = (0.06, 0.065, 0.075, 1)


def area(name, loc, rot, size, energy, colour=(1, 1, 1), size_y=None):
    light = bpy.data.lights.new(name, "AREA")
    light.energy, light.color, light.shape, light.size = energy, colour, "RECTANGLE", size
    light.size_y = size_y or size
    ob = bpy.data.objects.new(name, light)
    ob.location, ob.rotation_euler = loc, [math.radians(a) for a in rot]
    coll.objects.link(ob)


area("bounce", (0, -30, -36), (142, 0, 0), 44, 3380, BLUE_LIGHT, size_y=10)   # from below: blue on the plates' undersides
area("fill", (0, -40, 34), (50, 0, 0), 30, 4420, size_y=12)                  # near the camera: lights the plates' chamfers
area("rim-l", (-42, 34, 10), (80, 0, -130), 34, 6500, BLUE_LIGHT, size_y=10)
area("rim-r", (42, 34, 10), (80, 0, 130), 34, 6500, BLUE_LIGHT, size_y=10)
area("rim-back", (0, 45, 6), (-85, 0, 0), 60, 6500, BLUE_LIGHT, size_y=6)
# A thin strip where the top plate's front edge mirrors the camera, for a crisp highlight along it
strip = math.radians(ELEVATION + 4)
area("edge", (0, FRONT - 40 * math.cos(strip), TOP[1] + 40 * math.sin(strip)), (90 - ELEVATION - 4, 0, 0), 70, 9000, (0.9, 0.94, 1.0), size_y=1.5)


def softbox(peak=4.0, low=0.05, radius=0.55):
    """An emissive card where the top mirrors the camera: brightest behind the left end and falling off
    to the front right, so the top carries a sweep of light (an orthographic camera sees one flat reflection)."""
    e = math.radians(ELEVATION)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 34 * math.cos(e), TOP[1] + 34 * math.sin(e)), rotation=(math.radians(90) + e, 0, 0))
    ob = bpy.context.object
    ob.name, ob.scale = "softbox", (60, 44, 1)
    ob.visible_camera = ob.visible_shadow = False
    m = bpy.data.materials.new("softbox")
    nt = nodes(m)
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    stretch = nt.nodes.new("ShaderNodeVectorMath")
    stretch.operation, stretch.inputs[1].default_value = "MULTIPLY", (1.0, 1.25, 1.0)
    dist = nt.nodes.new("ShaderNodeVectorMath")
    dist.operation, dist.inputs[1].default_value = "DISTANCE", (-0.2, -0.32, 0.0)
    falloff = nt.nodes.new("ShaderNodeMapRange")
    falloff.interpolation_type = "SMOOTHSTEP"
    falloff.inputs["From Min"].default_value, falloff.inputs["From Max"].default_value = 0.0, radius
    falloff.inputs["To Min"].default_value, falloff.inputs["To Max"].default_value = peak, low
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.92, 0.95, 1.0, 1)
    nt.links.new(tc.outputs["Object"], stretch.inputs[0])
    nt.links.new(stretch.outputs[0], dist.inputs[0])
    nt.links.new(dist.outputs["Value"], falloff.inputs["Value"])
    nt.links.new(falloff.outputs["Result"], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)


softbox()

cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
coll.objects.link(cam)
cam.data.type, cam.data.ortho_scale, cam.data.clip_end = "ORTHO", 40.0, 1000
e = math.radians(ELEVATION)
cam.location = (0, -100 * math.cos(e), TOP[1] / 2 + 100 * math.sin(e))
cam.rotation_euler = (math.radians(90) - e, 0, 0)
scene.camera = cam

render = scene.render
render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:  # the GPU on Apple silicon; Cycles falls back to the CPU elsewhere
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type != "CPU"
    scene.cycles.device = "GPU"
except Exception as err:
    print("Rendering on the CPU:", err)
render.resolution_x = render.resolution_y = RESOLUTION
render.film_transparent = True
render.image_settings.file_format, render.image_settings.color_mode, render.image_settings.color_depth = "PNG", "RGBA", "16"
scene.view_settings.view_transform = "Standard"  # AgX would desaturate the mark and the badge
render.filepath = str(OUT)
bpy.ops.render.render(write_still=True)
