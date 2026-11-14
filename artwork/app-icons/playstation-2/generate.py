"""Generate PlayStation 2's icon.svg.

The console is a Blender render (references/playstation-2-render.png) that
render/render.py makes from the official logos in references/. This places it on
the 1024px canvas, with a drop shadow fitted to a macOS system app icon cast from
its silhouette. The title and description come from catalog.json. Requires
Pillow. Run build.py --rebuild afterwards to refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image

HERE = Path(__file__).resolve().parent
RENDER = HERE.parent / "references" / "playstation-2-render.png"

# Drop shadow fitted to a macOS system app icon.
SHADOW = {"blur": 10.8, "dy": 4, "opacity": 0.37}
SPAN = 880  # the console's longer side, in icon pixels


def catalog_entry() -> dict:
    """This icon in catalog.json, whose ID names its folder."""
    catalog = json.loads((HERE.parent / "catalog.json").read_text(encoding="utf-8"))
    return {icon["id"]: icon for icon in catalog["icons"]}[HERE.name]


def data_uri(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def console() -> tuple[Image.Image, int, int]:
    """The render cropped to the console, scaled to SPAN, and its top-left corner when centred on the canvas."""
    with Image.open(RENDER) as image:
        render = image.convert("RGBA")
    # Bound by clearly visible pixels, so the faint edge of the render's soft alpha doesn't shift the fit
    render = render.crop(render.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())
    scale = SPAN / max(render.size)
    render = render.resize((round(render.width * scale), round(render.height * scale)), Image.Resampling.LANCZOS)
    return render, (1024 - render.width) // 2, (1024 - render.height) // 2


def svg(title: str, desc: str) -> str:
    image, x, y = console()
    silhouette = Image.new("RGBA", image.size, (0, 0, 0, 255))
    silhouette.putalpha(image.getchannel("A"))
    w, h = image.size
    layers = [
        ("shadow", f'<image x="{x}" y="{y + SHADOW["dy"]}" width="{w}" height="{h}" opacity="{SHADOW["opacity"]}" '
                   f'filter="url(#icon-shadow)" href="{data_uri(silhouette)}"/>'),
        ("console", f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="{data_uri(image)}"/>'),
    ]
    groups = "".join(f'<g id="{i:02d}-{name}" inkscape:groupmode="layer" inkscape:label="{i:02d}-{name}">{body}</g>'
                     for i, (name, body) in enumerate(layers, 1))
    defs = f'<filter id="icon-shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="{SHADOW["blur"]}"/></filter>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="1024" height="1024" viewBox="0 0 1024 1024"><title>{escape(title)}</title><desc>{escape(desc)}</desc>'
            f'<defs>{defs}</defs>{groups}</svg>')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this icon)")
    out = parser.parse_args().out
    icon = catalog_entry()
    out.mkdir(parents=True, exist_ok=True)
    (out / "icon.svg").write_text(svg(icon["name"], icon["description"]), encoding="utf-8")


if __name__ == "__main__":
    main()
