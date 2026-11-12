"""Generate VLC Test Pattern's icon.svg and optical-small/icon.svg.

The cone is VLC's own 1024px icon artwork (references/vlc-original.png), embedded
unchanged. Its outline and cast shadow are derived from the cone's alpha channel.
Titles and the main description come from catalog.json. Requires Pillow. Run
build.py --rebuild afterwards to refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
CONE_SOURCE = HERE.parents[1] / "references" / "vlc-original.png"

# macOS app icon body and drop shadow, traced and fitted from a system app icon.
BODY = ("M372.82,100L651.18,100C754.035,100 818.924,103.034 869.945,154.055C920.966,205.076 924,269.965 924,372.82"
        "L924,651.18C924,754.035 920.966,818.924 869.945,869.945C818.924,920.966 754.035,924 651.18,924"
        "L372.82,924C269.965,924 205.076,920.966 154.055,869.945C103.034,818.924 100,754.035 100,651.18"
        "L100,372.82C100,269.965 103.034,205.076 154.055,154.055C205.076,103.034 269.965,100 372.82,100Z")
SHADOW = {"blur": 10.8, "dy": 4, "opacity": 0.37}

BARS = ["#f2f2f2", "#f4e000", "#00d8ec", "#16d23a", "#e62ad4", "#ee2a22", "#2438e6"]
CASTELLATION = ["#2438e6", "#141414", "#e62ad4", "#141414", "#00d8ec", "#141414", "#f2f2f2"]
ROWS = {"bars": (100, 712), "castellation": (712, 788), "floor": (788, 924)}

# Cone placement per source. The small-size source drops scanlines, which alias below 128px.
MAIN = dict(scale=0.66, bottom=826, outline=7, scanlines=True, bloom=0.12)
SMALL = dict(scale=0.72, bottom=838, outline=12, scanlines=False, bloom=0.0)
SMALL_SIZES, SMALL_DESC = "16–64px", "Larger cone, heavier outline, and no scanlines for 16–64px."


def catalog_entry() -> tuple[dict, dict]:
    """This variant's collection and variant in catalog.json, whose IDs name its folders."""
    catalog = json.loads((HERE.parents[1] / "catalog.json").read_text(encoding="utf-8"))
    app = {a["id"]: a for a in catalog["collections"]}[HERE.parent.name]
    return app, {v["id"]: v for v in app["variants"]}[HERE.name]


def data_uri(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def signal() -> str:
    w = 824 / 7
    (t0, t1), (c0, c1), (f0, f1) = ROWS.values()
    out = [f'<rect x="{100 + i * w:.3f}" y="{t0}" width="{w + 0.5:.3f}" height="{t1 - t0}" fill="{c}"/>' for i, c in enumerate(BARS)]
    out += [f'<rect x="{100 + i * w:.3f}" y="{c0}" width="{w + 0.5:.3f}" height="{c1 - c0}" fill="{c}"/>' for i, c in enumerate(CASTELLATION)]
    out.append(f'<rect x="100" y="{f0}" width="824" height="{f1 - f0}" fill="url(#floor)"/>')
    return "".join(out)


def cone(source: Image.Image, scale: float, bottom: int, outline: int) -> dict:
    left, top, right, low = source.getbbox()
    size = round(1024 * scale)
    x = round(512 - (left + right) / 2 * scale)
    y = round(bottom - low * scale)
    alpha = Image.new("L", (1024, 1024))
    alpha.paste(source.split()[3].resize((size, size), Image.Resampling.LANCZOS), (x, y))
    grown = alpha.filter(ImageFilter.GaussianBlur(outline / 2)).point(lambda v: 255 if v > 10 else 0)
    grown = grown.filter(ImageFilter.GaussianBlur(0.8))
    ink = Image.new("RGBA", (1024, 1024), (20, 16, 14, 255))
    ink.putalpha(grown)
    cast = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
    cast.putalpha(grown.filter(ImageFilter.GaussianBlur(16)).point(lambda v: round(v * 0.6)))
    return {"x": x, "y": y, "size": size, "outline": data_uri(ink.crop(ink.getbbox())), "outline_box": ink.getbbox(),
            "cast": data_uri(cast.crop(cast.getbbox())), "cast_box": cast.getbbox()}


def svg(source: Image.Image, title: str, desc: str, scale: float, bottom: int, outline: int, scanlines: bool, bloom: float) -> str:
    c = cone(source, scale, bottom, outline)
    ob, cb = c["outline_box"], c["cast_box"]
    lines = "".join(f'<rect x="100" y="{y}" width="824" height="2"/>' for y in range(102, 924, 6))
    layers = [
        ("shadow", f'<path d="{BODY}" transform="translate(0 {SHADOW["dy"]})" fill="#000" opacity="{SHADOW["opacity"]}" filter="url(#icon-shadow)"/>'),
        ("colour-bars", f'<g clip-path="url(#body)">{signal()}</g>'),
        ("bar-bloom", f'<g clip-path="url(#body)" opacity="{bloom}"><g filter="url(#bloom)">{signal().replace("url(#floor)", "#0c0c0c")}</g></g>'),
        ("cone-cast-shadow", f'<g clip-path="url(#body)"><image x="{cb[0] + 12}" y="{cb[1] + 16}" width="{cb[2] - cb[0]}" height="{cb[3] - cb[1]}" href="{c["cast"]}"/></g>'),
        ("cone-outline", f'<image x="{ob[0]}" y="{ob[1]}" width="{ob[2] - ob[0]}" height="{ob[3] - ob[1]}" href="{c["outline"]}"/>'),
        ("vlc-cone", f'<image x="{c["x"]}" y="{c["y"]}" width="{c["size"]}" height="{c["size"]}" href="{data_uri(source)}"/>'),
    ]
    if scanlines:
        layers.append(("scanlines", f'<g clip-path="url(#body)" fill="#000" opacity="0.07">{lines}</g>'))
    layers += [
        ("vignette", f'<path d="{BODY}" fill="url(#vignette)"/>'),
        ("glass-reflection", '<g clip-path="url(#body)"><path d="M100 100H924V330C760 250 560 226 360 248C250 260 160 290 100 330Z" fill="url(#reflection)"/></g>'),
        ("bezel", f'<g clip-path="url(#body)"><path d="{BODY}" fill="none" stroke="#000" stroke-opacity="0.32" stroke-width="14"/></g>'
                  f'<g clip-path="url(#body)"><path d="{BODY}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="4"/></g>'),
    ]
    groups = "".join(f'<g id="{i:02d}-{name}" inkscape:groupmode="layer" inkscape:label="{i:02d}-{name}">{body}</g>'
                     for i, (name, body) in enumerate(layers, 1))
    defs = (
        f'<clipPath id="body"><path d="{BODY}"/></clipPath>'
        f'<filter id="icon-shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="{SHADOW["blur"]}"/></filter>'
        '<filter id="bloom" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="10"/></filter>'
        '<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#181818"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>'
        '<radialGradient id="vignette" cx="0.5" cy="0.48" r="0.62"><stop offset="0.55" stop-color="#000" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>'
        '<linearGradient id="reflection" gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="0" y2="252"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
    )
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="1024" height="1024" viewBox="0 0 1024 1024"><title>{escape(title)}</title><desc>{escape(desc)}</desc>'
            f'<defs>{defs}</defs>{groups}</svg>')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this variant)")
    out = parser.parse_args().out
    app, icon = catalog_entry()
    title = f"{app['name']} — {icon['name']}"
    with Image.open(CONE_SOURCE) as image:
        source = image.convert("RGBA")
    (out / "optical-small").mkdir(parents=True, exist_ok=True)
    (out / "icon.svg").write_text(svg(source, title, icon["description"], **MAIN), encoding="utf-8")
    (out / "optical-small" / "icon.svg").write_text(svg(source, f"{title} ({SMALL_SIZES})", SMALL_DESC, **SMALL), encoding="utf-8")


if __name__ == "__main__":
    main()
