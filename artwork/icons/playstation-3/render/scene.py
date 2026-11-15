"""The launch PlayStation 3, modelled and rendered in Blender for its icon. render.py runs it:

blender -b --factory-startup -P scene.py -- ARTWORK_DIR OUT.png SAMPLES RESOLUTION

ARTWORK_DIR holds render.py's decals, decals.json with each one's size in cm, and mark.json with the PS3
mark's traced outlines.

Kept from the real console: the glossy piano-black shell, its top arched from front to back, the chrome
line along the front, the black flap on the left with its three dots and angled edge, the mirror-chrome
panel with the disc slot, the PS badge and the eject mark, the power mark and SONY at the right, and the
vent along the recessed base. Stylized as an icon: seen from above at 46° like the PS2's, with the front
a little taller, its details enlarged by DETAIL, and the PS3 mark from Sony's 2009 logo across the top in
place of the launch console's PLAYSTATION 3 lettering, which is too thin to read at icon sizes.

Units are centimetres. L is the distance from the left end, and the front faces -Y.
"""
import bpy, bmesh, json, math, sys
from pathlib import Path

ARTWORK, OUT, SAMPLES, RESOLUTION = (lambda a: (Path(a[0]), Path(a[1]), int(a[2]), int(a[3])))(sys.argv[sys.argv.index("--") + 1:])
SIZES = json.loads((ARTWORK / "decals.json").read_text())
ELEVATION = 46.0  # camera, degrees above the horizon, as for the PS2

WIDTH, DEPTH = 32.5, 31.0
FRONT, BACK = -DEPTH / 2, DEPTH / 2
BASE_TOP = 2.3       # the recessed base with its vent
LINE = (8.72, 9.02)  # the chrome line between the front and the shell
SHELL = dict(front=9.1, peak=13.2, peak_y=0.0, back=9.9)  # heights of the arched top
# The top's back corners, rounded in plan: their radius across and from back to front. Deeper than wide, as
# the back of the top leans away from the camera and would otherwise foreshorten them to a pinch.
CORNER = (2.2, 3.6)
RIM, ROLL = 0.28, 8  # the radius the top's edges are rounded to, and the steps in each roll
NOSE = 0.07          # the radius where the top rounds down onto the chrome line; the rolls at the sides narrow
                     # to it at the front, as no roll can be rounder than the edge it turns
DETAIL = 1.4


def X(L):
    return L - WIDTH / 2


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


def nodes(m):
    if m.node_tree is None:
        m.use_nodes = True
    return m.node_tree


def principled(m):
    return next(n for n in nodes(m).nodes if n.type == "BSDF_PRINCIPLED")


def material(name, colour, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    bsdf = principled(m)
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.03
    return m


def decal_material(name, image, rough=0.4, metal=0.0, colour=None, emission=0.0):
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
    bsdf.inputs["Metallic"].default_value = metal
    if emission:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


PIANO = material("piano-black", (0.006, 0.006, 0.007), rough=0.07, coat=1.0)
CHROME = material("chrome", (0.93, 0.93, 0.95), rough=0.05, metal=1.0)
SLOT = material("slot", (0.002, 0.002, 0.002), rough=0.9)
BASE = material("base", (0.055, 0.055, 0.06), rough=0.5)


def link(name, bm, mat, bevel=0.0, segments=4, angle=40):
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
        b.width, b.segments, b.limit_method = bevel, segments, "ANGLE"
        b.angle_limit = math.radians(angle)
        b.harden_normals = True
    return ob


def extrude_x(name, profile, L0, L1, mat, bevel=0.0, segments=4, angle=40):
    """Extrude a (y, z) profile from L0 to L1."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((X(L0), y, z)) for y, z in profile])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=(L1 - L0, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, mat, bevel, segments, angle)


def extrude_y(name, outline, y0, y1, mat, bevel=0.0, segments=4, angle=40):
    """Extrude an (L, z) outline on the front from depth y0 to y1."""
    bm = bmesh.new()
    face = bm.faces.new([bm.verts.new((X(L), y0, z)) for L, z in outline])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=(0, y1 - y0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return link(name, bm, mat, bevel, segments, angle)


def rect(L0, L1, z0, z1):
    return [(L0, z0), (L1, z0), (L1, z1), (L0, z1)]


def decal(name, mat, size, centre, y=None, scale=(1.0, 1.0)):
    """A decal plane on the front at depth y, centred at (L, height)."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0] * scale[0], size[1] * scale[1], 1)
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = (X(centre[0]), FRONT - 0.004 if y is None else y, centre[1])
    ob.data.materials.append(mat)
    return ob


# ---------------- body ----------------
def shell_z(y):
    """The top's height at depth y."""
    s = SHELL
    if y <= s["peak_y"]:
        t = (y - FRONT) / (s["peak_y"] - FRONT)
        return s["front"] + (s["peak"] - s["front"]) * (1 - (1 - t) ** 2.4)
    t = (y - s["peak_y"]) / (BACK - s["peak_y"])
    return s["peak"] - (s["peak"] - s["back"]) * t ** 2.1


def arch(n=48):
    """The shell's top, front to back: rising from the chrome line to its peak, then down to the back."""
    s = SHELL
    pts = []
    for i in range(n + 1):
        t = i / n
        y = FRONT + t * (s["peak_y"] - FRONT)
        pts.append((y, s["front"] + (s["peak"] - s["front"]) * (1 - (1 - t) ** 2.4)))
    for i in range(1, n + 1):
        t = i / n
        y = s["peak_y"] + t * (BACK - s["peak_y"])
        pts.append((y, s["peak"] - (s["peak"] - s["back"]) * t ** 2.1))
    return pts


def fillet(points, i, radius, n=6):
    """Round the polyline's corner at points[i] with an arc of `radius` in n steps."""
    (ay, az), (py, pz), (by, bz) = points[i - 1:i + 2]

    def unit(y, z):
        return y / math.hypot(y, z), z / math.hypot(y, z)

    u, v = unit(ay - py, az - pz), unit(by - py, bz - pz)
    turn = math.acos(max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1])))
    reach, out = radius / math.tan(turn / 2), radius / math.sin(turn / 2)
    mid = unit(u[0] + v[0], u[1] + v[1])
    cy, cz = py + mid[0] * out, pz + mid[1] * out
    a0 = math.atan2(pz + u[1] * reach - cz, py + u[0] * reach - cy)
    a1 = math.atan2(pz + v[1] * reach - cz, py + v[0] * reach - cy)
    a1 += -2 * math.pi if a1 - a0 > math.pi else 2 * math.pi if a0 - a1 > math.pi else 0
    arc = [(cy + radius * math.cos(a0 + (a1 - a0) * k / n), cz + radius * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]
    return points[:i] + arc + points[i + 1:]


def top_normal(y):
    """The top's outward normal at depth y, as (y, z)."""
    slope = (shell_z(y + 1e-4) - shell_z(y - 1e-4)) / 2e-4
    return -slope / math.hypot(slope, 1), 1 / math.hypot(slope, 1)


def build_shell():
    """The shell, modelled with its edges rounded rather than bevelled, so every edge gets its full roll however
    finely the arch is divided. It rounds down onto the chrome line at the front; its sides and back meet the
    top in a RIM-radius roll, narrowing to NOSE at the front; and its back corners curve round in plan by
    CORNER. Below, it sits on the chrome line at the front and reaches down inside the body behind it."""
    bottom, ledge = LINE[1] - 1.4, FRONT + 0.8
    across, deep = CORNER[0] - RIM, CORNER[1] - RIM  # the corner's radii where the roll meets the top
    back_y = BACK  # where the roll at the back meets the top, so that its outside lands on BACK
    for _ in range(4):
        back_y = BACK - RIM * (1 - top_normal(back_y)[0])
    start = back_y - deep

    # Rows across the top, front to back: where the roll meets the top on the right, the top's normal there, the
    # side's outward normal, and the roll's radius. First the nose and the arch, whose sides are flat...
    face = fillet([(FRONT - 0.15, LINE[1]), (FRONT - 0.15, SHELL["front"])] + arch()[1:], 1, NOSE)
    face = [(y, z) for y, z in face if y < start - 1e-3]
    rows = []
    for k, (y, z) in enumerate(face):
        (y0, z0), (y1, z1) = face[max(k - 1, 0)], face[min(k + 1, len(face) - 1)]
        length = math.hypot(y1 - y0, z1 - z0)
        t = min(max((y - FRONT) / 2.5, 0.0), 1.0)
        radius = NOSE + (RIM - NOSE) * t * t * (3 - 2 * t)
        rows.append(((WIDTH / 2 - radius, y, z), (0, -(z1 - z0) / length, (y1 - y0) / length), (1, 0, 0), radius))
    # ...then round the back corner in plan
    for a in range(0, 91, 5):
        t = math.radians(a)
        y = start + deep * math.sin(t)
        side = (math.cos(t) / across, math.sin(t) / deep)
        ny, nz = top_normal(y)
        rows.append(((WIDTH / 2 - RIM - across + across * math.cos(t), y, shell_z(y)), (0, ny, nz),
                     (side[0] / math.hypot(*side), side[1] / math.hypot(*side), 0), RIM))

    def roll(q, normal, outward, radius):
        """The roll from the top (facing `normal`) round to the side (facing `outward`)."""
        centre = [c - radius * n for c, n in zip(q, normal)]
        angle = math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(normal, outward)))))
        return [tuple(c + radius * (math.sin((1 - k / ROLL) * angle) * n + math.sin(k / ROLL * angle) * o) / math.sin(angle)
                      for c, n, o in zip(centre, normal, outward)) for k in range(ROLL + 1)]

    bm = bmesh.new()
    corner, last = len(face), len(rows) - 1  # the corner's first row, and the back row
    arcs, feet, inside = {}, {}, {}
    for s in (-1, 1):
        arcs[s] = [[bm.verts.new((s * x, y, z)) for x, y, z in roll(*row)] for row in rows]
        feet[s] = {i: bm.verts.new((arcs[s][i][-1].co.x, arcs[s][i][-1].co.y, bottom)) for i in range(corner, last + 1)}
        inside[s] = (bm.verts.new((s * WIDTH / 2, ledge, LINE[1])), bm.verts.new((s * WIDTH / 2, ledge, bottom)))
    L, R = arcs[-1], arcs[1]
    for i in range(last):  # the top, row by row, and the rolls down each side
        bm.faces.new([L[i][0], R[i][0], R[i + 1][0], L[i + 1][0]])
        for side in (L, R):
            for k in range(ROLL):
                bm.faces.new([side[i][k], side[i][k + 1], side[i + 1][k + 1], side[i + 1][k]])
    for k in range(ROLL):  # the roll along the back
        bm.faces.new([L[last][k], L[last][k + 1], R[last][k + 1], R[last][k]])
    bm.faces.new([L[last][-1], R[last][-1], feet[1][last], feet[-1][last]])  # the back
    for s, side in ((-1, L), (1, R)):
        bm.faces.new([row[-1] for row in side[:corner + 1]] + [feet[s][corner], inside[s][1], inside[s][0]])  # the flat end
        for i in range(corner, last):  # the end, round the corner
            bm.faces.new([side[i][-1], side[i + 1][-1], feet[s][i + 1], feet[s][i]])
    bm.faces.new([inside[-1][0]] + L[0][::-1] + R[0] + [inside[1][0]])  # under the face's edge, on the chrome line
    bm.faces.new([inside[-1][0], inside[1][0], inside[1][1], inside[-1][1]])
    bm.faces.new([inside[-1][1], inside[1][1]] + [feet[1][i] for i in range(corner, last + 1)]
                 + [feet[-1][i] for i in range(last, corner - 1, -1)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for edge in bm.edges:  # crisp where flat faces meet, smooth over the rolls and the arch
        if len(edge.link_faces) == 2 and edge.link_faces[0].normal.angle(edge.link_faces[1].normal) > math.radians(35):
            edge.smooth = False
    return link("shell", bm, PIANO)


build_shell()
# ---------------- top: the PS3 mark, raised in polished silver ----------------
MARK_Y, MARK_HEIGHT = -1.0, 0.45  # its centre sits just in front of the peak, so it faces the camera


def raised_mark():
    """The mark's traced outlines filled, raised MARK_HEIGHT off the top, and bent to follow the arch."""
    traced = json.loads((ARTWORK / "mark.json").read_text())
    bm = bmesh.new()
    edges = []
    for loop in traced["loops"]:
        verts = [bm.verts.new((x, y + MARK_Y, 0)) for x, y in loop]
        edges += [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:] + verts[:1])]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    ext = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    bmesh.ops.translate(bm, verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)], vec=(0, 0, MARK_HEIGHT))
    for v in bm.verts:
        v.co.z += shell_z(v.co.y) - 0.03  # seated just into the top
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    silver = material("mark", (0.86, 0.87, 0.9), rough=0.16, metal=1.0)
    # polished silver, brightest along the letters' tops (the back) and deepening toward the front, as the
    # PS2 mark shades from violet to blue
    nt, bsdf = nodes(silver), principled(silver)
    tc, sep, along, ramp = (nt.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeSeparateXYZ", "ShaderNodeMapRange", "ShaderNodeValToRGB"))
    half = traced["height"] / 2
    along.inputs["From Min"].default_value, along.inputs["From Max"].default_value = MARK_Y + half, MARK_Y - half
    ramp.color_ramp.elements[0].color = (0.95, 0.96, 0.98, 1)
    ramp.color_ramp.elements[1].color = (0.5, 0.51, 0.55, 1)
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    nt.links.new(sep.outputs["Y"], along.inputs["Value"])
    nt.links.new(along.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return link("mark", bm, silver, bevel=0.09, segments=3, angle=30)


raised_mark()
extrude_x("fascia", rect(FRONT, BACK - CORNER[1] - 0.3, BASE_TOP, LINE[0] + 0.05), 0.15, WIDTH - 0.15, PIANO, bevel=0.12)
extrude_x("chrome-line", rect(FRONT - 0.1, FRONT + 0.4, LINE[0], LINE[1]), 0.0, WIDTH, CHROME, bevel=0.06)
BASE_SETBACK = 0.8
extrude_x("base", rect(FRONT + BASE_SETBACK, BACK - 1.6, 0.0, BASE_TOP + 0.02), 1.4, WIDTH - 2.6, BASE, bevel=0.1)

# ---------------- front ----------------
FLAP_L, PANEL_L = (0.3, 14.9), (15.55, WIDTH - 0.9)
PANEL_Z = (BASE_TOP + 1.25, LINE[0] - 0.25)
STRIP_Z = (BASE_TOP + PANEL_Z[0]) / 2  # the black strip under the panel
mid = sum(PANEL_Z) / 2
# The flap: glossy black, its right edge cut on the diagonal where it meets the chrome panel
extrude_y("flap", [(FLAP_L[0], BASE_TOP + 0.35), (FLAP_L[1] - 0.8, BASE_TOP + 0.35), (FLAP_L[1] + 0.3, mid),
                   (FLAP_L[1] + 0.3, PANEL_Z[1]), (FLAP_L[0], PANEL_Z[1])], FRONT - 0.16, FRONT + 0.2, PIANO, bevel=0.06)
decal("dots", decal_material("dots", "dots", 0.4, emission=0.3), SIZES["dots"], (4.2, BASE_TOP + 0.85), y=FRONT - 0.165, scale=(DETAIL, DETAIL))
# The chrome panel: the disc slot along its top, the badge under it, and the eject mark low on the left
extrude_y("panel", rect(PANEL_L[0], PANEL_L[1], *PANEL_Z), FRONT - 0.16, FRONT + 0.2, CHROME, bevel=0.05)
extrude_y("slot", rect(PANEL_L[0] + 0.6, PANEL_L[1] - 0.6, PANEL_Z[1] - 1.0, PANEL_Z[1] - 0.62), FRONT - 0.17, FRONT + 0.1, SLOT, bevel=0.03)
decal("badge", decal_material("badge", "badge", 0.3, emission=0.15), SIZES["badge"], (23.6, mid + 0.1), y=FRONT - 0.165, scale=(DETAIL, DETAIL))
decal("eject", decal_material("eject", "eject", 0.4), SIZES["eject"], (19.0, PANEL_Z[0] + 0.75), y=FRONT - 0.165, scale=(DETAIL, DETAIL))
# The black strip under the panel: the power mark, and SONY at the right end
decal("power", decal_material("power", "power", 0.4, emission=0.3), SIZES["power"], (27.0, STRIP_Z), scale=(DETAIL, DETAIL))
decal("sony", decal_material("sony", "sony", 0.4, emission=0.3), SIZES["sony"], (30.0, STRIP_Z), scale=(DETAIL, DETAIL))

# Vent along the base's front: square holes, as a mask over the dark plastic
VENT_Y = FRONT + BASE_SETBACK - 0.004
vent = decal_material("vent", "vent", 0.9, colour=(0.0015, 0.0015, 0.0015))
bpy.ops.mesh.primitive_plane_add(size=1)
ob = bpy.context.object
ob.name, ob.scale = "vent", (WIDTH - 5.4, BASE_TOP - 0.7, 1)
ob.rotation_euler = (math.radians(90), 0, 0)
ob.location = (X((1.4 + WIDTH - 2.6) / 2), VENT_Y, BASE_TOP / 2)
ob.data.materials.append(vent)

# ---------------- light, camera, render ----------------
# One studio that every surface mirrors, so each highlight lands where the shape would really catch it: a softbox
# overhead, a band just behind it with a glow fading away behind that, a soft light low behind the console that
# rims its back edge, and in front a floor card whose lit edge the chrome mirrors. Around them it's near black, as
# gloss black needs.
STUDIO = dict(
    # each light: (from, to) as angles from the front horizon over the top (0 in front, 90 overhead, 180
    # behind; negative is below behind), how softly its edges fade, in degrees, and its strength at each end
    lights=[((70, 122), 10, (0.12, 1.3)),   # the softbox, hottest at its back: the top mirrors it brightest just
                                            # in front of the mark, darkening as the arch rolls toward the front
            ((124, 140), 6, (0.85, 0.85)),    # a band just behind overhead: the mark's tops mirror it, the top
                                            # behind them faintly
            ((138, 170), 10, (0.35, 0.0)),  # a glow fading out behind the band, so the top darkens gradually as
                                            # it falls away to the back, rather than stopping dead in a black lid
            ((-170, -140), 8, (0.6, 0.6))], # low behind: only the back edge's curve mirrors it, as a rim
    # how far the lights reach to either side, as the sideways part of a direction: full out to the first, gone
    # by the second. The top mirrors only directions straight back, so this reaches just the rolls down its
    # sides, which would otherwise mirror every light all the way along and read as a drawn outline
    width=(0.15, 0.5),
    ambient=0.006,
)
e = math.radians(ELEVATION)


def studio():
    """The studio as the world: a light for every direction, from STUDIO's softly edged lights."""
    world = bpy.data.worlds.new("studio")
    scene.world = world
    nt = nodes(world)
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.95, 0.97, 1.0, 1)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(nt.nodes.new("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])

    def op(operation, a, b=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = operation
        for socket, value in zip(n.inputs, (a, b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            elif value is not None:
                nt.links.new(value, socket)
        return n.outputs[0]

    def ease(value, lo, hi, rising):
        n = nt.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = lo, hi
        n.inputs["To Min"].default_value, n.inputs["To Max"].default_value = (0, 1) if rising else (1, 0)
        nt.links.new(value, n.inputs["Value"])
        return n.outputs["Result"]

    angle = op("MULTIPLY", op("ARCTAN2", sep.outputs["Z"], op("MULTIPLY", sep.outputs["Y"], -1.0)), 180 / math.pi)
    inner, outer = STUDIO["width"]
    across = ease(op("ABSOLUTE", sep.outputs["X"]), inner, outer, False)
    total = STUDIO["ambient"]
    for (start, end), soft, (near, far) in STUDIO["lights"]:
        falloff = nt.nodes.new("ShaderNodeMapRange")  # its strength across it, from `near` at start to `far` at end
        falloff.inputs["From Min"].default_value, falloff.inputs["From Max"].default_value = start, end
        falloff.inputs["To Min"].default_value, falloff.inputs["To Max"].default_value = near, far
        nt.links.new(angle, falloff.inputs["Value"])
        edges = op("MULTIPLY", ease(angle, start - soft, start + soft, True), ease(angle, end - soft, end + soft, False))
        light = op("MULTIPLY", op("MULTIPLY", edges, across), falloff.outputs["Result"])
        total = op("ADD", total, light) if not isinstance(total, float) else op("ADD", light, total)
    nt.links.new(total, bg.inputs["Strength"])


def floor_card(stops):
    """The front edge of the floor the console stands on, lit: an emissive card the camera can't see, where
    the chrome mirrors it (in front of and below the panel). `stops` = [(position, strength), ...] from the
    edge the panel's top mirrors to the edge its bottom does."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, FRONT - 40 * math.cos(e), sum(PANEL_Z) / 2 - 40 * math.sin(e)))
    ob = bpy.context.object
    ob.name, ob.scale = "floor-card", (140, 4.4, 1)
    ob.rotation_euler = (math.radians(-90 + ELEVATION), 0, 0)  # facing the panel
    ob.visible_camera = ob.visible_shadow = False
    m = bpy.data.materials.new("floor-card")
    nt = nodes(m)
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.95, 0.97, 1.0, 1)
    tc, sep, along, ramp, scale = (nt.nodes.new(t) for t in ("ShaderNodeTexCoord", "ShaderNodeSeparateXYZ", "ShaderNodeMapRange",
                                                               "ShaderNodeValToRGB", "ShaderNodeMath"))
    along.inputs["From Min"].default_value, along.inputs["From Max"].default_value = -0.5, 0.5
    peak = max(v for _, v in stops)
    ramp.color_ramp.interpolation = "EASE"
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, value) in zip(elements, stops):
        element.position, element.color = position, (1, 1, 1, value / peak)
    scale.operation, scale.inputs[1].default_value = "MULTIPLY", peak
    nt.links.new(tc.outputs["Object"], sep.inputs[0])
    nt.links.new(sep.outputs["Y"], along.inputs["Value"])
    nt.links.new(along.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Alpha"], scale.inputs[0])
    nt.links.new(scale.outputs[0], em.inputs["Strength"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)


def flag(shade, ease=2.0):
    """A black flag over the console, unseen by the camera, shading the studio's overhead lights more and more
    toward the right, so the top mirrors them brightest at its left end, as the PS2's top does. The camera is
    orthographic, so every point across the top mirrors the same direction, and only something this close can
    vary it from left to right. It blocks up to `shade` of the light at the right end, easing in from none at
    the left as the fraction across raised to `ease`, so the left stays bright and the right falls away."""
    # from just in front of the console to far behind it, so even the low lights the back of the top mirrors pass through it
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 230, 40))
    ob = bpy.context.object
    ob.name, ob.scale = "flag", (200, 600, 1)
    ob.visible_camera = False
    m = bpy.data.materials.new("flag")
    nt = nodes(m)
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    geo, sep, across, curve, mix = (nt.nodes.new(t) for t in ("ShaderNodeNewGeometry", "ShaderNodeSeparateXYZ", "ShaderNodeMapRange",
                                                              "ShaderNodeMath", "ShaderNodeMixShader"))
    black = nt.nodes.new("ShaderNodeEmission")
    black.inputs["Strength"].default_value = 0.0
    across.inputs["From Min"].default_value, across.inputs["From Max"].default_value = -WIDTH / 2, WIDTH / 2
    curve.operation, curve.inputs[1].default_value = "POWER", ease
    blocked = nt.nodes.new("ShaderNodeMath")
    blocked.operation, blocked.inputs[1].default_value = "MULTIPLY", shade
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    nt.links.new(sep.outputs["X"], across.inputs["Value"])
    nt.links.new(across.outputs["Result"], curve.inputs[0])
    nt.links.new(curve.outputs[0], blocked.inputs[0])
    nt.links.new(blocked.outputs[0], mix.inputs["Fac"])
    nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], mix.inputs[1])
    nt.links.new(black.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)


studio()
flag(0.55)
# bright at the panel's top, a dark horizon just under its middle, then a little light again
floor_card([(0, 1.5), (0.35, 1.15), (0.55, 0.14), (0.75, 0.22), (1, 0.55)])


def area(name, loc, rot, size, energy, colour=(1, 1, 1), size_y=None):
    light = bpy.data.lights.new(name, "AREA")
    light.energy, light.color, light.shape, light.size = energy, colour, "RECTANGLE", size
    light.size_y = size_y or size
    ob = bpy.data.objects.new(name, light)
    ob.location, ob.rotation_euler = loc, [math.radians(a) for a in rot]
    coll.objects.link(ob)


# Plain studio lights for what the reflections don't reach: the ends' edges, the printing and the vent
area("rim-l", (-44, 30, 12), (80, 0, -125), 30, 1400, size_y=10)
area("rim-r", (44, 30, 12), (80, 0, 125), 30, 1400, size_y=10)
area("fill", (0, -40, 34), (50, 0, 0), 30, 1200, size_y=12)
area("under", (0, -30, -20), (120, 0, 0), 40, 1500, size_y=8)  # from below the front: reaches the vent under the overhang

cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
coll.objects.link(cam)
cam.data.type, cam.data.ortho_scale, cam.data.clip_end = "ORTHO", 40.0, 1000
cam.location = (0, -100 * math.cos(e), SHELL["peak"] / 2 + 100 * math.sin(e))
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
scene.view_settings.view_transform = "Standard"
render.filepath = str(OUT)
bpy.ops.render.render(write_still=True)
