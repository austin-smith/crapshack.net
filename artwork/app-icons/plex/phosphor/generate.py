"""Generate Plex Phosphor's icon.svg, optical-128/icon.svg and optical-64/icon.svg.

Builds Plex's chevron as an amber dot matrix in separate editable SVG layers. The
icon's shadow comes from the original Plex icon (references/plex-original.png).
Titles and the main description come from catalog.json. Requires Pillow, NumPy
and OpenCV. Run build.py --rebuild afterwards to refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
from pathlib import Path
import xml.etree.ElementTree as E

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parents[1] / "references" / "plex-original.png"
SVG = "http://www.w3.org/2000/svg"
INK = "http://www.inkscape.org/namespaces/inkscape"
E.register_namespace("", SVG)
E.register_namespace("inkscape", INK)

# Original Plex chevron proportions.
CHEVRON = "M336 238H532L717 512L532 786H336L521 512Z"
POLYGON = np.array([[336, 238], [532, 238], [717, 512], [532, 786], [336, 786], [521, 512]], dtype=np.float32)

# Each source's intended pixel size and output path. Coarser grids keep the dots
# readable once downsampled: 12px pitch at full size, 16px for 128px, 32px for 16–64px.
SOURCES = {1024: "icon.svg", 128: "optical-128/icon.svg", 64: "optical-64/icon.svg"}
PITCH = {1024: 12, 128: 16, 64: 32}
PHASE = {1024: 8, 128: 4, 64: 8}
# The sizes each small-size source covers, and what it simplifies.
SMALL = {128: ("128px", "Coarser 16px dot grid that stays readable at 128px."),
         64: ("16–64px", "Coarsest 32px dot grid that stays readable at 16–64px.")}


def catalog_entry() -> tuple[dict, dict]:
    """This variant's collection and variant in catalog.json, whose IDs name its folders."""
    catalog = json.loads((HERE.parents[1] / "catalog.json").read_text(encoding="utf-8"))
    app = {a["id"]: a for a in catalog["collections"]}[HERE.parent.name]
    return app, {v["id"]: v for v in app["variants"]}[HERE.name]


def node(parent, tag, attrs=None):
    return E.SubElement(parent, f"{{{SVG}}}{tag}", attrs or {})


def layer(parent, name, clipped=False):
    attrs = {"id": name, f"{{{INK}}}groupmode": "layer", f"{{{INK}}}label": name}
    if clipped:
        attrs["clip-path"] = "url(#screen)"
    return node(parent, "g", attrs)


def image(parent, pixels, opacity=1):
    buffer = io.BytesIO()
    pixels.save(buffer, format="PNG", optimize=True)
    node(parent, "image", {"x": "0", "y": "0", "width": "1024", "height": "1024",
         "href": "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode(),
         "opacity": str(opacity)})


def tint(mask, color, opacity=1):
    alpha = mask.point(lambda v: round(v * opacity))
    result = Image.new("RGBA", mask.size, color + (0,))
    result.putalpha(alpha)
    return result


def gradient(defs, ident, colors):
    g = node(defs, "linearGradient", {"id": ident, "x1": "0", "y1": "0", "x2": "0", "y2": "1"})
    for offset, color, opacity in colors:
        node(g, "stop", {"offset": str(offset), "stop-color": color, "stop-opacity": str(opacity)})


def build(optical_size: int, reference: Image.Image, title: str, desc: str) -> tuple[E.ElementTree, int]:
    pitch = PITCH[optical_size]
    phase = PHASE[optical_size]
    radius = pitch * (.285 if optical_size < 256 else .25)
    core_radius = radius * .5
    root = E.Element(f"{{{SVG}}}svg", {"width": "1024", "height": "1024", "viewBox": "0 0 1024 1024"})
    node(root, "title").text = title
    node(root, "desc").text = desc
    defs = node(root, "defs")
    clip = node(defs, "clipPath", {"id": "screen"})
    node(clip, "rect", {"x": "100", "y": "100", "width": "824", "height": "824", "rx": "174"})
    glyph_clip = node(defs, "clipPath", {"id": "glyph"})
    node(glyph_clip, "path", {"d": CHEVRON})
    gradient(defs, "body", [(0, "#121210", 1), (.4, "#080807", 1), (1, "#050504", 1)])
    gradient(defs, "edge", [(0, "#514f47", .8), (.35, "#302f29", .8), (1, "#24231e", .8)])
    gradient(defs, "reflection", [(0, "#c0bfaf", .045), (.3, "#c0bfaf", .012), (.65, "#c0bfaf", 0), (1, "#c0bfaf", 0)])

    # Preserve the original app icon's shadow, without borrowing any other app's housing.
    shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    shadow.putalpha(reference.getchannel("A"))
    image(layer(root, "01-Plex-shadow"), shadow)

    body = layer(root, "02-graphite-housing")
    node(body, "rect", {"x": "100", "y": "100", "width": "824", "height": "824", "rx": "174", "fill": "url(#body)"})

    mask = Image.new("L", (1024, 1024))
    ImageDraw.Draw(mask).polygon([tuple(p) for p in POLYGON], fill=255)
    glyph = np.asarray(mask)
    body_mask = Image.new("L", (1024, 1024))
    ImageDraw.Draw(body_mask).rounded_rectangle((100, 100, 923, 923), radius=174, fill=255)
    body_pixels = np.asarray(body_mask)

    # Grid points within one dot radius of the chevron light up; the rest stay as faint unlit dots.
    inactive = layer(root, "03-inactive-phosphor-matrix", True)
    points = []
    for row, y in enumerate(np.arange(phase, 1024, pitch)):
        for col, x in enumerate(np.arange(phase, 1024, pitch)):
            if not body_pixels[round(y), round(x)]:
                continue
            distance = cv2.pointPolygonTest(POLYGON, (float(x), float(y)), True)
            if distance >= -radius:
                points.append((float(x), float(y), row, col))
            else:
                opacity = .13 + .30 * math.exp(distance / 150)
                node(inactive, "circle", {"cx": str(x), "cy": str(y), "r": str(pitch * .105), "fill": "#a55b05", "opacity": f"{opacity:.4f}"})

    # Separate emission layers make the halo independently adjustable in PhotoCraft.
    haze = layer(root, "04-phosphor-persistence", True)
    distance = cv2.distanceTransform((glyph == 0).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    ambient = .27 * np.exp(-distance / 10) + .24 * np.exp(-distance / 65)
    inside = cv2.distanceTransform((glyph != 0).astype(np.uint8), cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    ambient[glyph != 0] = (.16 + .26 * np.exp(-inside / 9))[glyph != 0]
    image(haze, tint(Image.fromarray(np.uint8(np.rint(ambient * 255))), (255, 132, 0)))
    image(haze, tint(mask.filter(ImageFilter.GaussianBlur(2.2)), (255, 177, 27), .19))
    dot_mask = Image.new("L", (4096, 4096))
    painter = ImageDraw.Draw(dot_mask)
    for x, y, _, _ in points:
        painter.ellipse(((x - radius) * 4, (y - radius) * 4, (x + radius) * 4, (y + radius) * 4), fill=255)
    dot_mask = dot_mask.resize((1024, 1024), Image.Resampling.LANCZOS)
    dot_mask = Image.fromarray(np.minimum(np.asarray(dot_mask), glyph))
    bloom = layer(root, "05-centered-dot-bloom", True)
    image(bloom, tint(dot_mask.filter(ImageFilter.GaussianBlur(pitch * .145)), (255, 159, 10), .98))
    image(bloom, tint(dot_mask.filter(ImageFilter.GaussianBlur(pitch * .40)), (255, 136, 0), .48))

    dots = layer(root, "06-amber-phosphor-dots", True)
    cores = layer(root, "07-ivory-phosphor-cores", True)
    dots = node(dots, "g", {"clip-path": "url(#glyph)"})
    cores = node(cores, "g", {"clip-path": "url(#glyph)"})
    for x, y, row, col in points:
        variation = .965 + .035 * math.sin(row * 13.37 + col * 9.91)
        node(dots, "circle", {"cx": str(x), "cy": str(y), "r": str(radius), "fill": "#ffb621", "opacity": f"{variation:.4f}"})
        node(cores, "circle", {"cx": str(x), "cy": str(y), "r": str(core_radius), "fill": "#fff0aa", "opacity": ".98"})

    reflection = layer(root, "08-antiglare-surface", True)
    node(reflection, "rect", {"x": "100", "y": "100", "width": "824", "height": "824", "fill": "url(#reflection)"})
    edge = layer(root, "09-fine-graphite-edge")
    node(edge, "rect", {"x": "101", "y": "101", "width": "822", "height": "822", "rx": "173", "fill": "none", "stroke": "url(#edge)", "stroke-width": "2.2"})
    return E.ElementTree(root), len(points)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this variant)")
    out = parser.parse_args().out
    app, icon = catalog_entry()
    title = f"{app['name']} — {icon['name']}"
    with Image.open(REFERENCE) as image_file:
        reference = image_file.convert("RGBA")
    for size, relative in SOURCES.items():
        sizes, desc = SMALL.get(size, (None, icon["description"]))
        tree, lit = build(size, reference, f"{title} ({sizes})" if sizes else title, desc)
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(E.tostring(tree.getroot(), encoding="unicode"), encoding="utf-8")
        print(f"{relative}: {lit} lit dots for {size}px")


if __name__ == "__main__":
    main()
