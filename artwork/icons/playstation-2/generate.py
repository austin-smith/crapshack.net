"""Generate PlayStation 2's icon.png.

The console is a Blender render (references/playstation-2-render.png) that
render/render.py makes from the official logos in references/. This places it on
the 1024px canvas, with a drop shadow fitted to a macOS system app icon cast from
its silhouette. Requires Pillow. Run build.py --rebuild afterwards to refresh
the published files.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
RENDER = HERE.parent / "references" / "playstation-2-render.png"

# Drop shadow fitted to a macOS system app icon.
SHADOW = {"blur": 10.8, "dy": 4, "opacity": 0.37}
SPAN = 880  # the console's longer side, in icon pixels


def console() -> tuple[Image.Image, int, int]:
    """The render cropped to the console, scaled to SPAN, and its top-left corner when centred on the canvas."""
    with Image.open(RENDER) as image:
        render = image.convert("RGBA")
    # Bound by clearly visible pixels, so the faint edge of the render's soft alpha doesn't shift the fit
    render = render.crop(render.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox())
    scale = SPAN / max(render.size)
    render = render.resize((round(render.width * scale), round(render.height * scale)), Image.Resampling.LANCZOS)
    return render, (1024 - render.width) // 2, (1024 - render.height) // 2


def icon() -> Image.Image:
    """The console on the 1024px canvas over its shadow: its silhouette, offset, blurred, and faded."""
    image, x, y = console()
    alpha = Image.new("L", (1024, 1024))
    alpha.paste(image.getchannel("A"), (x, y + SHADOW["dy"]))
    alpha = alpha.filter(ImageFilter.GaussianBlur(SHADOW["blur"])).point(lambda v: round(v * SHADOW["opacity"]))
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
    canvas.putalpha(alpha)
    canvas.alpha_composite(image, (x, y))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this icon)")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    icon().save(out / "icon.png", optimize=True)


if __name__ == "__main__":
    main()
