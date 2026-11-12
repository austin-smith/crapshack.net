"""Generate the four Rex icon.svg files: Rextty, Rextty Classic, Fossil, and Prism.

Each is Rex's mascot on Ghostty's CRT, built from Ghostty's supplied screen,
phosphor, reflection, and housing (references/) and the mascot geometry in
geometry.json. The mascot's glow, and the undercoat drawn from it, transfer the
edge lighting measured from Ghostty's glass material
(references/ghostty-glass-material.png); its face takes that material's gradient.
housing-alpha.png is the housing's screen cut-out. Titles and descriptions come
from catalog.json.

Requires Pillow, NumPy, OpenCV, and vectorcraft-cli, which rasterises the mascot
masks. Run build.py --rebuild afterwards to refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as E

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REFERENCES = HERE.parent / "references"
GEOMETRY = json.loads((HERE / "geometry.json").read_text(encoding="utf-8"))
CATALOG = json.loads((HERE.parent / "catalog.json").read_text(encoding="utf-8"))
COLLECTION = {app["id"]: app for app in CATALOG["collections"]}[HERE.name]
SVG = "http://www.w3.org/2000/svg"
INK = "http://www.inkscape.org/namespaces/inkscape"
E.register_namespace("", SVG)
E.register_namespace("inkscape", INK)

# Ghostty's 825px screen is drawn at 663px, starting at 180px.
S = 663 / 825
T = 180 - 99 * S
REX = GEOMETRY["rex"]["body_path"]
REX_TRANSFORM = "translate(252 248) scale(1.1607142857142858)"
PIXEL_REX = GEOMETRY["pixel_rex"]

VARIANTS = {
    "rextty": {"palette": "blue", "shape": REX, "transform": REX_TRANSFORM, "eye_stroke": "2.584",
               "cursor": {"x": 682, "y": 721, "width": 100, "height": 26, "rx": 10}},
    "rextty-classic": {"palette": "blue", "shape": REX, "eye_stroke": "4.16",
                       "transform": "translate(225.5614 220.3008) scale(0.72095)",
                       "cursor": {"x": 466, "y": 511, "width": 75, "height": 19.5, "rx": 7.5}},
    "fossil": {"palette": "green", "shape": PIXEL_REX["body_path"], "transform": None,
               "cursor_path": PIXEL_REX["cursor_path"], "eye_glint": PIXEL_REX["eye_glint"]},
    "prism": {"palette": "prismatic", "shape": REX, "transform": REX_TRANSFORM, "eye_stroke": "2.584"},
}

# --- PNG and SVG helpers -----------------------------------------------------

def png(pixels: Image.Image) -> bytes:
    buffer = io.BytesIO()
    pixels.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def encode(a: np.ndarray) -> bytes:
    return png(Image.fromarray(np.uint8(np.clip(np.rint(a * 255), 0, 255))))


def rgba(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA")).astype(np.float32) / 255


def node(parent, tag, attrs=None):
    return E.SubElement(parent, f"{{{SVG}}}{tag}", attrs or {})


def layer(root, name, blend=None):
    attrs = {"id": name, f"{{{INK}}}groupmode": "layer", f"{{{INK}}}label": name}
    if blend:
        attrs["style"] = "mix-blend-mode:" + blend
    return node(root, "g", attrs)


def image(parent, data: bytes, x=0, y=0, width=1024, height=1024, opacity=1):
    return node(parent, "image", {"x": str(x), "y": str(y), "width": str(width), "height": str(height), "opacity": str(opacity),
                                  "href": "data:image/png;base64," + base64.b64encode(data).decode()})


def gradient(defs, ident, stops, radial=False, **attrs):
    g = node(defs, "radialGradient" if radial else "linearGradient", {"id": ident, **attrs})
    for offset, color, opacity in stops:
        node(g, "stop", {"offset": str(offset), "stop-color": color, "stop-opacity": str(opacity)})
    return g


# --- Edge material measured from Ghostty's glass mascot ------------------------

STEP = .5
NORM_BINS = 17
SOURCE_THRESHOLD = 220


def field(mask):
    """Signed distance either side of a mask edge, and the edge normal's vertical component."""
    binary = (mask > .5).astype(np.uint8)
    inside = cv2.distanceTransform(binary, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    outside = cv2.distanceTransform(1 - binary, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    signed = cv2.GaussianBlur(inside - outside, (0, 0), 1.5)
    dy, dx = np.gradient(signed)
    return inside - .5, outside - .5, -dy / np.maximum(np.hypot(dx, dy), 1e-6), binary


def fit_lut(distance, normal, values, valid, max_distance):
    width = round(max_distance / STEP) + 1
    x = np.clip(np.rint(distance / STEP).astype(int), 0, width - 1)
    y = np.clip(np.rint((normal + 1) * (NORM_BINS - 1) / 2).astype(int), 0, NORM_BINS - 1)
    idx = (y * width + x)[valid]
    channels = values.shape[-1]
    counts = np.bincount(idx, minlength=width * NORM_BINS).reshape(NORM_BINS, width)
    table = np.empty((NORM_BINS, width, channels), np.float32)
    for c in range(channels):
        sums = np.bincount(idx, weights=values[..., c][valid], minlength=width * NORM_BINS).reshape(NORM_BINS, width)
        table[..., c] = sums / np.maximum(counts, 1)
    present = counts > 0
    _, labels = cv2.distanceTransformWithLabels((~present).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    nearest = np.zeros((labels.max() + 1, channels), np.float32)
    nearest[labels[present]] = table[present]
    table[~present] = nearest[labels[~present]]
    return cv2.GaussianBlur(table, (0, 0), .7, sigmaY=1.0)


def measure_material():
    """Return Ghostty's glow lookup table (by edge distance and normal) and its face gradient stops."""
    source = rgba(REFERENCES / "ghostty-glass-material.png")
    opaque = (source[..., 3] >= 254 / 255).astype(np.uint8)
    core = (source[..., 3] >= SOURCE_THRESHOLD / 255).astype(np.uint8)
    _, components = cv2.connectedComponents(1 - core)
    exterior = components == components[0, 0]
    source_mask = (~exterior).astype(np.float32)
    _, outside, normal, binary = field(source_mask)
    premul = source.copy()
    premul[..., :3] *= source[..., 3:]
    glow = fit_lut(outside, normal, premul, (binary == 0) & (outside < 96), 96)

    # The face colour by row, from deep face pixels, excluding the eyes.
    height = source_mask.shape[0]
    face = np.full((height, 3), np.nan, np.float32)
    opaque_distance = cv2.distanceTransform(opaque, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    for y in range(height):
        valid = (opaque_distance[y] > 13) & (source[y, :, 0] > .35) & (source[y, :, 2] > .93)
        if valid.any():
            face[y] = np.median(source[y, valid, :3], axis=0)
    known = np.flatnonzero(np.isfinite(face[:, 0]))
    for c in range(3):
        face[:, c] = np.interp(np.arange(height), known, face[known, c])
    face = cv2.GaussianBlur(face, (1, 5), .65)
    ys, _ = np.where(binary)
    top, bottom = int(ys.min()), int(ys.max())
    stops = []
    for t in np.linspace(0, 1, 49):
        color = [int(round(float(np.interp(top + t * (bottom - top), np.arange(height), face[:, c])) * 255)) for c in range(3)]
        stops.append({"offset": round(float(t), 6), "color": "#" + "".join(f"{c:02x}" for c in color)})
    return glow, stops


# --- Masks, materials, and assembly ---------------------------------------------

BEVEL_SHIFT, BEVEL_BLUR = 7.75, 0.3  # vertical inset fitted to Ghostty's inner bevel, in source pixels


def render_masks(c, vectorcraft: str, scratch: Path) -> dict:
    def path_svg(shape, transform=None):
        root = E.Element(f"{{{SVG}}}svg", {"width": "1024", "height": "1024", "viewBox": "0 0 1024 1024"})
        attrs = {"d": shape, "fill": "white", "fill-rule": "evenodd"}
        if transform:
            attrs["transform"] = transform
        node(root, "path", attrs)
        return root

    masks = {"rex-face": path_svg(c["shape"], c["transform"]),
             "rex-outer": path_svg(c["shape"].split("ZM", 1)[0] + "Z", c["transform"])}
    if "cursor" in c:
        root = E.Element(f"{{{SVG}}}svg", {"width": "1024", "height": "1024", "viewBox": "0 0 1024 1024"})
        node(root, "rect", {**{k: str(v) for k, v in c["cursor"].items()}, "fill": "white"})
        masks["cursor"] = root
    elif "cursor_path" in c:
        masks["cursor"] = path_svg(c["cursor_path"])
    alphas = {}
    for name, root in masks.items():
        svg, out = scratch / f"{name}.svg", scratch / f"{name}.png"
        svg.write_text(E.tostring(root, encoding="unicode"), encoding="utf-8")
        subprocess.run([vectorcraft, "convert", str(svg), str(out)], check=True, capture_output=True)
        alphas[name] = rgba(out)[..., 3]
    return alphas


def green_mix(r, g, b):
    """Ghostty's blue light as green phosphor, for channels in any range."""
    return [r * .35 + b * .018, b * .50 + g * .08, g * .52 + b * .065]


def recolor(a, palette):
    b = a.copy()
    r, g, blue = np.moveaxis(a[..., :3], -1, 0)
    if palette == "green":
        b[..., :3] = np.stack(green_mix(r, g, blue), axis=-1)
    elif palette == "prismatic":
        b[..., :3] = np.stack([r * .65 + blue * .35, g * .8 + blue * .2, blue], axis=-1)
    return np.clip(b, 0, 1)


def glow(lut, mask, centered=False, palette="blue"):
    _, distance, normal, _ = field(mask)
    if centered:
        normal = np.zeros_like(normal)
    x = np.clip(distance / S / .5, 0, lut.shape[1] - 1).astype(np.float32)
    y = np.clip((normal + 1) * (lut.shape[0] - 1) / 2, 0, lut.shape[0] - 1).astype(np.float32)
    p = cv2.remap(lut, x, y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    p[distance > 96 * S] = 0
    p *= 1 - mask[..., None]
    p[..., :3] /= np.maximum(p[..., 3:], 1e-7)
    return recolor(np.clip(p, 0, 1), palette)


def materials(c, masks, lut) -> dict:
    palette = c["palette"]
    out = {}
    for name, maskname in [("rex", "rex-outer"), ("cursor", "cursor")]:
        if maskname not in masks:
            continue
        mask = masks[maskname]
        outer = glow(lut, mask, centered=name == "cursor" or palette == "green", palette=palette)
        out[f"{name}-glow"] = encode(outer)
        face = masks["rex-face"] if name == "rex" else mask
        under = np.ones((*mask.shape, 4), np.float32)
        under[..., :3] = {"blue": [0, .478, 1], "green": [.03, 1, .36], "prismatic": [.55, .42, 1]}[palette]
        under[..., 3] = np.minimum(face + outer[..., 3], 1) if palette == "blue" else outer[..., 3]
        out[f"{name}-undercoat"] = encode(under)
        if name == "rex" and palette != "green":
            shifted = cv2.warpAffine(mask, np.array([[1, 0, 0], [0, 1, -BEVEL_SHIFT * S]], np.float32), (1024, 1024), flags=cv2.INTER_LINEAR)
            a = cv2.GaussianBlur(mask * (1 - shifted), (0, 0), BEVEL_BLUR * S) * mask
            rim = np.ones((*mask.shape, 4), np.float32)
            rim[..., 3] = a
            out["rex-bevel"] = encode(rim)
    # Reflection hue follows each screen's palette; its geometry and gray light pass are shared.
    glass = rgba(REFERENCES / "ghostty-reflection.png")
    if palette == "green":
        glass = recolor(glass, "green")
        glass[..., 3] *= .55
    elif palette == "prismatic":
        glass[..., :3] = 1
        glass[..., 3] *= .65
    out["glass-reflection"] = encode(glass)
    return out


def green_color(rgba_image):
    data = np.array(rgba_image.convert("RGBA"))
    color = data[:, :, :3].astype(float)
    r, g, b = color[:, :, 0], color[:, :, 1], color[:, :, 2]
    data[:, :, :3] = np.stack(green_mix(r, g, b), axis=2).clip(0, 255).astype("uint8")
    return data


def shared_images() -> dict:
    """Ghostty's assets as embedded, plus the housing, green recolours, and glass lighting pass derived from them."""
    files = {name: (REFERENCES / f"ghostty-{name}.png").read_bytes() for name in ("screen", "phosphor")}
    housing = np.array(Image.open(REFERENCES / "ghostty-original.png").convert("RGBA"))
    housing[..., 3] = np.array(Image.open(HERE / "housing-alpha.png"))
    files["housing"] = png(Image.fromarray(housing))
    files["green-screen"] = png(Image.fromarray(green_color(Image.open(REFERENCES / "ghostty-screen.png"))))
    inside = np.array(Image.open(REFERENCES / "screen-mask.png")) > 0
    green_housing = housing.copy()
    green_housing[inside, :3] = green_color(Image.fromarray(housing))[inside, :3]
    files["green-housing"] = png(Image.fromarray(green_housing))
    light = rgba(REFERENCES / "ghostty-reflection.png")
    light[..., :3] = (1 - np.linspace(0, 1, light.shape[0]))[:, None, None]
    files["glass-light"] = encode(light)
    return files


def variant_defs(palette, stops):
    """Rex's face fill (Ghostty's measured glass for blue, tinted glass otherwise) and the prismatic screen."""
    defs = E.Element(f"{{{SVG}}}defs")
    if palette == "blue":
        gradient(defs, "rex-fill", [(stop["offset"], stop["color"], 1) for stop in stops], x1="0", y1="0", x2="0", y2="1")
        return defs
    green = palette == "green"
    gradient(defs, "rex-fill", [(0, "#bbffd0" if green else "#fff5e5", .94 if green else .90), (.5, "#78f5aa" if green else "#ead5f2", .86 if green else .80),
                                    (1, "#38d885" if green else "#b7c9ff", .82 if green else .77)], x1="0", y1="0", x2="0", y2="1")
    if not green:
        gradient(defs, "spectrum-screen", [(0, "#ffd23b", 1), (.28, "#ff8152", 1), (.53, "#bf3395", 1), (.80, "#5432b6", 1), (1, "#111d63", 1)], True, cx=".92", cy=".08", r="1.12")
        gradient(defs, "cyan-corner", [(0, "#24c9ff", .65), (1, "#173663", 0)], True, cx="0", cy="1", r=".85")
        gradient(defs, "screen-vignette", [(0, "#050a24", 0), (.58, "#050a24", 0), (1, "#050a24", .79)], True, cx=".5", cy=".5", r=".65")
    return defs


def assemble(c, icon, mat, shared, stops) -> E.ElementTree:
    palette = c["palette"]
    root = E.Element(f"{{{SVG}}}svg", {"width": "1024", "height": "1024", "viewBox": "0 0 1024 1024"})
    node(root, "title").text = f"{COLLECTION['name']} — {icon['name']}"
    node(root, "desc").text = icon["description"]
    defs = variant_defs(palette, stops)
    root.append(defs)
    screen = layer(root, "01-screen")
    if palette == "prismatic":
        for fill in ["#111639", "url(#spectrum-screen)", "url(#cyan-corner)", "url(#screen-vignette)"]:
            node(screen, "rect", {"x": "180", "y": "180", "width": "663", "height": "663", "fill": fill})
        # Tint the face apertures as dark glass while retaining the shared grid above.
        depth = node(layer(root, "01b-facial-aperture-depth"), "g", {"transform": c["transform"]})
        eye_path = [p for p in re.split(r"(?=M)", c["shape"]) if p][-1]
        node(depth, "path", {"d": eye_path, "fill": "#170a42", "opacity": ".70"})
        mouth = node(depth, "g", {"transform": f"translate({(478 - 122) / (800 / 448)} {(615 - 54) / (816 / 457)}) scale({(178 / 100) / (800 / 448)} {(61 / 34) / (816 / 457)})"})
        node(mouth, "path", {"d": GEOMETRY["rex"]["mouth_path"], "fill": "#241052", "opacity": ".66"})
    else:
        node(screen, "rect", {"x": "180", "y": "180", "width": "663", "height": "663", "fill": "#000000"})
        image(screen, shared["green-screen" if palette == "green" else "screen"], 180, 180, 663, 663)
    bloom = layer(root, "02-source-halo")
    image(bloom, mat["rex-undercoat"], x=-2 * S if palette != "green" else 0)
    image(bloom, mat["rex-glow"])
    fill = layer(root, "03-original-mascot-surface")
    attrs = {"d": c["shape"], "fill": "url(#rex-fill)", "fill-rule": "evenodd"}
    if c["transform"]:
        attrs["transform"] = c["transform"]
    node(fill, "path", attrs)
    rim = layer(root, "04-mascot-edge")
    if palette == "green":
        node(rim, "path", {"d": c["shape"], "fill": "none", "stroke": "#c9ffe6", "stroke-width": "1.5", "stroke-linejoin": "miter", "opacity": ".85"})
    else:
        image(rim, mat["rex-bevel"])
        eye = "M" + c["shape"].split("ZM", 1)[1]
        node(rim, "path", {"d": eye, "transform": c["transform"], "fill": "none", "stroke": "#e5f4ff", "stroke-opacity": ".85", "stroke-width": c["eye_stroke"]})
    if "cursor" in c or "cursor_path" in c:
        cursor = layer(root, "05-centered-terminal-cursor")
        image(cursor, mat["cursor-undercoat"])
        image(cursor, mat["cursor-glow"])
        green = palette == "green"
        gradient(defs, "cursor-glass", [(0, "#bbffd4" if green else "#99c8ff", 1), (1, "#78f5aa" if green else "#7bb9ff", 1)], x1="0", y1="0", x2="0", y2="1")
        paint = {"fill": "url(#cursor-glass)", "stroke": "#d5ffe8" if green else "#e5f4ff", "stroke-opacity": ".8", "stroke-width": "1.3"}
        if "cursor" in c:
            node(cursor, "rect", {**{k: str(v) for k, v in c["cursor"].items()}, **paint})
        else:
            node(cursor, "path", {"d": c["cursor_path"], **paint})
    if "eye_glint" in c:
        glint = layer(root, "06-original-eye-glint")
        node(glint, "circle", {"cx": str(c["eye_glint"][0]), "cy": str(c["eye_glint"][1]), "r": "6.3", "fill": "#d9ffe0", "opacity": ".95"})
    for passnum in [1, 2]:
        image(layer(root, f"07-{passnum}-original-phosphor", "overlay"), shared["phosphor"], 180, 180, 663, 663)
    image(layer(root, "08-glass-reflection"), mat["glass-reflection"], T + 108 * S, T + 108 * S, 808 * S, 334 * S)
    image(layer(root, "08b-glass-lighting", "overlay"), shared["glass-light"], T + 108 * S, T + 108 * S, 808 * S, 334 * S, .25)
    image(layer(root, "09-original-housing"), shared["green-housing" if palette == "green" else "housing"])
    return E.ElementTree(root)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this collection)")
    parser.add_argument("--vectorcraft", default="vectorcraft-cli", help="VectorCraft CLI executable")
    arguments = parser.parse_args()
    vectorcraft = shutil.which(arguments.vectorcraft)
    if vectorcraft is None:
        raise SystemExit("vectorcraft-cli not found. Install it separately or pass --vectorcraft /path/to/vectorcraft-cli.")
    icons = {icon["id"]: icon for icon in COLLECTION["variants"]}
    lut, stops = measure_material()
    shared = shared_images()
    for folder, c in VARIANTS.items():
        with tempfile.TemporaryDirectory() as scratch:
            masks = render_masks(c, vectorcraft, Path(scratch))
        target = arguments.out / folder / "icon.svg"
        target.parent.mkdir(parents=True, exist_ok=True)
        tree = assemble(c, icons[folder], materials(c, masks, lut), shared, stops)
        target.write_text(E.tostring(tree.getroot(), encoding="unicode"), encoding="utf-8")
        print(f"{folder}/icon.svg")


if __name__ == "__main__":
    main()
