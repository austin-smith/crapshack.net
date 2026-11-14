"""Render the PlayStation 2 console to references/playstation-2-render.png.

Draws the console's printed artwork from the official logos in references/ and the
console's own legends, outlines the PS2 mark for its raised letters, then renders
scene.py in Blender. Each render's noise differs, so run this only to change the
console, then run ../generate.py and build.py --rebuild.

Requires Blender 5.3 (pass --blender PATH if it isn't on PATH), macOS's Helvetica,
vectorcraft-cli, and the packages in requirements.txt.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

HERE = Path(__file__).resolve().parent
REFERENCES = HERE.parents[1] / "references"
OUT = REFERENCES / "playstation-2-render.png"
HELVETICA = "/System/Library/Fonts/Helvetica.ttc"
GREY, TEAL, BLUE = (178, 180, 184, 255), (64, 196, 184, 255), "#588cf0"
# The PS2 mark's outlines are drawn this much heavier than the logo's hairlines, in logo units,
# so its letters still read at small sizes.
MARK_STROKE = 9.0
WORDMARK_WIDTH = 7.2  # cm; every other decal is sized by its height, set beside it below


def svg_png(svg: str, width: int, work: Path) -> Image.Image:
    """Render an SVG with VectorCraft at `width` pixels, sized through the root element's width and height."""
    head_end = svg.index(">", svg.index("<svg"))
    head = re.sub(r'\s(width|height)="[^"]*"', "", svg[:head_end])
    vw, vh = map(float, re.search(r'viewBox="([^"]+)"', head).group(1).replace(",", " ").split()[2:])
    source, raster = work / "source.svg", work / "raster.png"
    source.write_text(f'{head} width="{width}" height="{round(width * vh / vw)}"' + svg[head_end:], encoding="utf-8")
    subprocess.run(["vectorcraft-cli", "convert", str(source), str(raster)], check=True, capture_output=True)
    with Image.open(raster) as image:
        return image.convert("RGBA")


def legend(text: str, px: int, colour: tuple, spacing: int = 0, small: tuple = ()) -> Image.Image:
    """A printed legend in Helvetica; `small` holds the indexes of letters set as small caps."""
    big, little = ImageFont.truetype(HELVETICA, px), ImageFont.truetype(HELVETICA, int(px * 0.78))
    glyphs = [(ch, little if i in small else big) for i, ch in enumerate(text)]
    widths = [font.getlength(ch) + spacing for ch, font in glyphs]
    image = Image.new("RGBA", (int(sum(widths)) + 16, int(px * 1.4)))
    draw, x = ImageDraw.Draw(image), 8
    for (ch, font), width in zip(glyphs, widths):
        draw.text((x, px * 1.1), ch, font=font, fill=colour, anchor="ls")
        x += width
    return image.crop(image.getchannel("A").getbbox())


def artwork(work: Path) -> None:
    """Every decal as a PNG, decals.json with each one's width and height in centimetres, and mark.json."""
    logo = (REFERENCES / "playstation-2-logo.svg").read_text(encoding="utf-8")
    decals = {}

    # "PlayStation 2" beside the mark, printed in gloss black: a white mask the scene colours.
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', logo[logo.index('<g id="layer1"'):])
    x, y, w, h = 189.72, 167.13, 370.94, 71.51
    decals["wordmark"] = (svg_png(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x - 4} {y - 4} {w + 8} {h + 8}">'
                                  + "".join(f'<path d="{d}" fill="#fff"/>' for d in paths) + "</svg>", 3000, work), None)

    # The colour PlayStation badge on the disc tray, from the official file.
    badge_svg = (REFERENCES / "playstation-logo.svg").read_text(encoding="utf-8")
    badge = svg_png(badge_svg.replace('<svg width="422" height="327"', '<svg viewBox="0 0 422 327"', 1), 1600, work)
    decals["badge"] = (badge.crop(badge.getchannel("A").getbbox()), 0.95)

    # The console's own legends and key glyphs; the eject glyph is an outline.
    decals["memory-card"] = (legend("MEMORY CARD", 160, GREY, spacing=6), 0.16)
    decals["magicgate"] = (legend("MAGICGATE", 160, GREY, spacing=4, small=(1, 2, 3, 4, 6, 7, 8)), 0.15)
    decals["one"] = (legend("1", 200, GREY), 0.2)
    decals["two"] = (legend("2", 200, GREY), 0.2)
    decals["reset"] = (legend("RESET", 160, TEAL, spacing=6), 0.13)
    power = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24">'
             '<path d="M-5.2,-5.6A7.6,7.6 0 1 0 5.2,-5.6" fill="none" stroke="#40c4b8" stroke-width="1.9" stroke-linecap="round"/>'
             '<path d="M0,-10V-1" stroke="#40c4b8" stroke-width="1.9" stroke-linecap="round"/></svg>')
    eject = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24">'
             f'<path d="M-8,1.5L0,-8L8,1.5Z" fill="none" stroke="{BLUE}" stroke-width="1.5" stroke-linejoin="miter"/>'
             f'<rect x="-8" y="4.5" width="16" height="3.6" fill="none" stroke="{BLUE}" stroke-width="1.5"/></svg>')
    decals["power"] = (svg_png(power, 512, work), 0.36)
    decals["eject"] = (svg_png(eject, 512, work), 0.42)

    sizes = {}
    for name, (image, height) in decals.items():
        image.save(work / f"{name}.png")
        aspect = image.width / image.height
        width = WORDMARK_WIDTH if height is None else height * aspect
        sizes[name] = [round(width, 4), round(width / aspect, 4)]
    (work / "decals.json").write_text(json.dumps(sizes, indent=1), encoding="utf-8")

    # The mark's three letters, outlined MARK_STROKE heavier, for the scene to raise off the top.
    letters = []
    for points in re.findall(r'<polygon[^>]*class="cls-[123]"[^>]*points="([^"]+)"', logo):
        v = list(map(float, points.replace(",", " ").split()))
        letter = Polygon(list(zip(v[0::2], v[1::2]))).buffer(MARK_STROKE / 2, join_style="mitre", mitre_limit=4).simplify(0.05)
        letters.append([list(c) for c in orient(letter, 1.0).exterior.coords[:-1]])
    assert len(letters) == 3, f"expected the mark's three letters, found {len(letters)}"
    (work / "mark.json").write_text(json.dumps(letters), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--blender", default="blender", help="Blender executable")
    parser.add_argument("--samples", type=int, default=512, help="Cycles samples")
    parser.add_argument("--out", type=Path, default=OUT, help=f"output PNG (default: {OUT.relative_to(HERE.parents[1])})")
    arguments = parser.parse_args()
    blender = shutil.which(arguments.blender)
    if not blender:
        raise SystemExit("Blender not found. Install Blender 5.3 or pass --blender /path/to/blender.")
    with tempfile.TemporaryDirectory(prefix="playstation-2-") as folder:
        work = Path(folder)
        artwork(work)
        render = work / "render.png"
        subprocess.run([blender, "-b", "--factory-startup", "-P", str(HERE / "scene.py"), "--",
                        str(work), str(render), str(arguments.samples)], check=True)
        # 16-bit from Blender; 8-bit is plenty for a source drawn at 880px.
        with Image.open(render) as image:
            image.convert("RGBA").save(arguments.out, optimize=True)
    print("wrote", arguments.out)


if __name__ == "__main__":
    main()
