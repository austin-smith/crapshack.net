"""Generate T3 Code Keycap's icon.svg.

The legend is T3's wordmark path, read unchanged from T3 Code's production logo
(references/t3code-logo.svg). The title and description come from catalog.json.
Requires Pillow (for the grain texture). Run build.py --rebuild afterwards to
refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import random
import re
from xml.sax.saxutils import escape

from PIL import Image

HERE = Path(__file__).resolve().parent
LOGO = HERE.parents[1] / "references" / "t3code-logo.svg"
WORD_BOX = (15.5309, 37, 94.3941, 56.96)  # x, y, width, height of the wordmark in the logo's 128-unit space

# Drop shadow fitted to a macOS system app icon.
SHADOW = {"blur": 10.8, "dy": 4, "opacity": 0.37}
BODY_BOX = (100, 100, 924, 924)
TOP_BOX = (176, 150, 848, 788)  # sculpted top surface, set back from the front wall
TOP_CORNER = dict(r=200, a=76, c=36, m=40)
LEGEND_SCALE = 4.9  # logo units to icon pixels; fills about 70% of the top's width
COLOURS = dict(skirt_top="#34343a", skirt_mid="#18181b", skirt_bottom="#080809",
               top_upper="#1e1e21", top_mid="#232327", top_lower="#2a2a2f", grain=0.07,
               legend_top="#ffffff", legend_bottom="#ececef")


def catalog_entry() -> tuple[dict, dict]:
    """This variant's collection and variant in catalog.json, whose IDs name its folders."""
    catalog = json.loads((HERE.parents[1] / "catalog.json").read_text(encoding="utf-8"))
    app = {a["id"]: a for a in catalog["collections"]}[HERE.parent.name]
    return app, {v["id"]: v for v in app["variants"]}[HERE.name]


def wordmark() -> str:
    paths = re.findall(r'<path d="([^"]+)"', LOGO.read_text(encoding="utf-8"))
    if len(paths) != 2:
        raise SystemExit(f"{LOGO}: expected the tile path and the wordmark path, found {len(paths)} paths")
    return paths[1]


def squircle(x0: float, y0: float, x1: float, y1: float, r=272.82, a=102.85, c=51.02, m=54.055) -> str:
    """The continuous corner traced from a macOS system app icon; corners shrink with rects under 824px."""
    k = min(1.0, min(x1 - x0, y1 - y0) / 824)
    D, A, C, M = r * k, a * k, c * k, m * k
    seq = [(0, D), (0, D - A), (M - C, M + C), (M, M), (M + C, M - C), (D - A, 0), (D, 0)]
    f = lambda v: f"{v:.2f}"
    P = lambda pts: " ".join(f"{f(x)},{f(y)}" for x, y in pts)
    tl = [(x0 + u, y0 + d) for u, d in seq]
    tr = [(x1 - u, y0 + d) for u, d in reversed(seq)]
    br = [(x1 - u, y1 - d) for u, d in seq]
    bl = [(x0 + u, y1 - d) for u, d in reversed(seq)]
    out = f"M{P([tl[-1]])}"
    for cn in (tr, br, bl, tl):
        out += f"L{P([cn[0]])}C{P(cn[1:4])}C{P(cn[4:7])}"
    return out + "Z"


def noise_uri(size=512, seed=5, strength=26) -> str:
    rng = random.Random(seed)
    im = Image.new("L", (size, size))
    im.putdata([128 + rng.randint(-strength, strength) for _ in range(size * size)])
    buf = BytesIO()
    Image.merge("RGBA", (im, im, im, Image.new("L", (size, size), 255))).save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def keycap(c: dict, title: str, desc: str) -> str:
    body = squircle(*BODY_BOX)
    top = squircle(*TOP_BOX, **TOP_CORNER)
    tx0, ty0, tx1, ty1 = TOP_BOX
    wx, wy, ww, wh = WORD_BOX
    s = LEGEND_SCALE
    cx, cy = (tx0 + tx1) / 2, (ty0 + ty1) / 2 - 6
    word_t = f"translate({cx - (wx + ww / 2) * s:.2f} {cy - (wy + wh / 2) * s:.2f}) scale({s})"

    defs = (
        f'<clipPath id="body"><path d="{body}"/></clipPath>'
        f'<clipPath id="top"><path d="{top}"/></clipPath>'
        f'<filter id="icon-shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="{SHADOW["blur"]}"/></filter>'
        '<filter id="b24" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="24"/></filter>'
        '<linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.34"/>'
        '<stop offset="0.5" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.9" stop-color="#000" stop-opacity="0.25"/>'
        '<stop offset="1" stop-color="#000" stop-opacity="0.4"/></linearGradient>'
        # skirt: lit from above, front wall faces the viewer, side walls fall off
        f'<linearGradient id="skirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c["skirt_top"]}"/>'
        f'<stop offset="0.55" stop-color="{c["skirt_mid"]}"/><stop offset="1" stop-color="{c["skirt_bottom"]}"/></linearGradient>'
        '<linearGradient id="walls" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.28"/>'
        '<stop offset="0.12" stop-color="#000" stop-opacity="0"/><stop offset="0.88" stop-color="#000" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#000" stop-opacity="0.34"/></linearGradient>'
        # top: concave dish, upper half faces down (darker), lower half faces up (lighter)
        f'<linearGradient id="dish" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c["top_upper"]}"/>'
        f'<stop offset="0.5" stop-color="{c["top_mid"]}"/><stop offset="1" stop-color="{c["top_lower"]}"/></linearGradient>'
        '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/>'
        '<stop offset="0.3" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
        f'<linearGradient id="legend" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c["legend_top"]}"/>'
        f'<stop offset="1" stop-color="{c["legend_bottom"]}"/></linearGradient>'
    )
    layers = [
        ("shadow", f'<path d="{body}" transform="translate(0 {SHADOW["dy"]})" fill="#000" opacity="{SHADOW["opacity"]}" filter="url(#icon-shadow)"/>'),
        ("skirt", f'<path d="{body}" fill="url(#skirt)"/><path d="{body}" fill="url(#walls)"/>'),
        ("skirt-rim", f'<g clip-path="url(#body)"><path d="{body}" fill="none" stroke="url(#rim)" stroke-width="6"/>'
                      f'<path d="{body}" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="3"/></g>'),
        ("top-shadow", f'<g clip-path="url(#body)"><path d="{top}" transform="translate(0 16)" fill="#000" opacity="0.45" filter="url(#b24)"/></g>'),
        ("top-surface", f'<path d="{top}" fill="url(#dish)"/>'),
        ("top-bevel", f'<g clip-path="url(#top)"><path d="{top}" fill="none" stroke="url(#bevel)" stroke-width="7"/></g>'),
        ("pbt-texture", f'<g clip-path="url(#body)" opacity="{c["grain"]}"><image x="100" y="100" width="824" height="824" preserveAspectRatio="none" href="{noise_uri()}"/></g>'),
        ("legend", f'<g transform="{word_t}"><path d="{wordmark()}" fill="url(#legend)"/></g>'),
    ]
    groups = "".join(f'<g id="{i:02d}-{n}" inkscape:groupmode="layer" inkscape:label="{i:02d}-{n}">{b}</g>' for i, (n, b) in enumerate(layers, 1))
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="1024" height="1024" viewBox="0 0 1024 1024"><title>{escape(title)}</title><desc>{escape(desc)}</desc>'
            f'<defs>{defs}</defs>{groups}</svg>')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this variant)")
    out = parser.parse_args().out
    app, icon = catalog_entry()
    out.mkdir(parents=True, exist_ok=True)
    (out / "icon.svg").write_text(keycap(COLOURS, f"{app['name']} — {icon['name']}", icon["description"]), encoding="utf-8")


if __name__ == "__main__":
    main()
