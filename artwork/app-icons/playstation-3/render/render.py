"""Render the PlayStation 3 console to references/playstation-3-render.png.

Draws the console's printed artwork from the official logos in references/ and the
console's own markings, then renders scene.py in Blender. Each render's noise
differs, so run this only to change the console, then run ../generate.py and
build.py --rebuild.

Requires Blender 5.3 (pass --blender PATH if it isn't on PATH), macOS's
Superclarendon, vectorcraft-cli, and the packages in requirements.txt.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REFERENCES = HERE.parents[1] / "references"
OUT = REFERENCES / "playstation-3-render.png"
CLARENDON = "/System/Library/Fonts/Supplemental/SuperClarendon.ttc"
SILVER, GREY = (214, 216, 222, 255), (150, 152, 158, 255)
MARK_WIDTH = 26.0  # cm across the top: 80% of the console's width, as for the PS2


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


def legend(text: str, font: str, px: int, colour: tuple, spacing: int = 0) -> Image.Image:
    face = ImageFont.truetype(font, px)
    widths = [face.getlength(ch) + spacing for ch in text]
    image = Image.new("RGBA", (int(sum(widths)) + 16, int(px * 1.4)))
    draw, x = ImageDraw.Draw(image), 8
    for ch, width in zip(text, widths):
        draw.text((x, px * 1.1), ch, font=face, fill=colour, anchor="ls")
        x += width
    return image.crop(image.getchannel("A").getbbox())


def vent_grid(columns: int, rows: int, cell: int = 24, hole: float = 0.62) -> Image.Image:
    """The base's vent: square holes in rows, as a mask (white = hole)."""
    image = Image.new("L", (columns * cell, rows * cell))
    draw = ImageDraw.Draw(image)
    inset = cell * (1 - hole) / 2
    for c in range(columns):
        for r in range(rows):
            draw.rectangle((c * cell + inset, r * cell + inset, (c + 1) * cell - inset, (r + 1) * cell - inset), fill=255)
    return Image.merge("RGBA", (image, image, image, image))


def artwork(work: Path) -> None:
    """Every decal as a PNG, decals.json with each one's width and height in centimetres, and mark.json."""
    decals = {}

    # The PS3 mark across the top, from Sony's 2009 logo (its last three shapes; the rest is the "PlayStation 3"
    # lettering beneath, which the icon leaves out), traced into outlines for the scene to raise.
    logo = (REFERENCES / "playstation-3-logo.svg").read_text(encoding="utf-8")
    shapes = re.findall(r'<path[^>]*\sd="([^"]+)"', logo, re.S)[-3:]
    mark = svg_png('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 667 279.5">'
                   + "".join(f'<path d="{d}" fill="#fff"/>' for d in shapes) + "</svg>", 5000, work)
    mark = np.asarray(mark.crop(mark.getchannel("A").getbbox()).getchannel("A"))
    contours, _ = cv2.findContours((mark > 127).astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cm = MARK_WIDTH / mark.shape[1]
    centre = mark.shape[1] / 2, mark.shape[0] / 2
    loops = [[[round((x - centre[0]) * cm, 4), round((centre[1] - y) * cm, 4)] for x, y in cv2.approxPolyDP(c, 1.5, True)[:, 0]]
             for c in contours]
    (work / "mark.json").write_text(json.dumps({"loops": loops, "height": round(mark.shape[0] * cm, 4)}), encoding="utf-8")

    # The colour PlayStation badge under the disc slot, from the official file.
    badge_svg = (REFERENCES / "playstation-logo.svg").read_text(encoding="utf-8")
    badge = svg_png(badge_svg.replace('<svg width="422" height="327"', '<svg viewBox="0 0 422 327"', 1), 1600, work)
    decals["badge"] = (badge.crop(badge.getchannel("A").getbbox()), ("height", 1.2))

    # The console's own markings: SONY in silver serif, the power and eject touch marks, the flap's dots.
    decals["sony"] = (legend("SONY", CLARENDON, 300, SILVER, spacing=12), ("height", 0.34))
    power = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -12 40 24">'
             '<path d="M-14,-7V7M-4,-8L-10,8" stroke="#d6d8de" stroke-width="2" stroke-linecap="round" fill="none"/>'
             '<path d="M5.4,-5.4A7.6,7.6 0 1 0 14.6,-5.4" fill="none" stroke="#d6d8de" stroke-width="2" stroke-linecap="round"/>'
             '<path d="M10,-9.5V-1" stroke="#d6d8de" stroke-width="2" stroke-linecap="round"/></svg>')
    decals["power"] = (svg_png(power, 800, work), ("height", 0.42))
    eject = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24">'
             '<path d="M-8,2L0,-8L8,2Z" fill="none" stroke="#3a3c42" stroke-width="1.6" stroke-linejoin="miter"/>'
             '<path d="M-8,6H8" stroke="#3a3c42" stroke-width="1.6"/></svg>')
    decals["eject"] = (svg_png(eject, 512, work), ("height", 0.5))
    dots = Image.new("RGBA", (300, 60))
    for i in range(3):
        ImageDraw.Draw(dots).ellipse((20 + i * 100, 10, 60 + i * 100, 50), fill=GREY)
    decals["dots"] = (dots, ("width", 0.55))
    decals["vent"] = (vent_grid(120, 6), ("width", 1.0))  # stretched to the vent's size by the scene

    sizes = {}
    for name, (image, (axis, cm)) in decals.items():
        image.save(work / f"{name}.png")
        aspect = image.width / image.height
        width = cm if axis == "width" else cm * aspect
        sizes[name] = [round(width, 4), round(width / aspect, 4)]
    (work / "decals.json").write_text(json.dumps(sizes, indent=1), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--blender", default="blender", help="Blender executable")
    parser.add_argument("--samples", type=int, default=512, help="Cycles samples")
    parser.add_argument("--resolution", type=int, default=2048, help="render size in pixels")
    parser.add_argument("--out", type=Path, default=OUT, help="output PNG")
    arguments = parser.parse_args()
    blender = shutil.which(arguments.blender)
    if not blender:
        raise SystemExit("Blender not found. Install Blender 5.3 or pass --blender /path/to/blender.")
    with tempfile.TemporaryDirectory(prefix="playstation-3-") as folder:
        work = Path(folder)
        artwork(work)
        render = work / "render.png"
        subprocess.run([blender, "-b", "--factory-startup", "-P", str(HERE / "scene.py"), "--",
                        str(work), str(render), str(arguments.samples), str(arguments.resolution)], check=True)
        with Image.open(render) as image:
            image.convert("RGBA").save(arguments.out, optimize=True)
    print("wrote", arguments.out)


if __name__ == "__main__":
    main()
