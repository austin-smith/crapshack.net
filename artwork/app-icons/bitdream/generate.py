"""Generate the BitDream icon.svg files from the app's own Icon Composer icons.

BitDream offers these as alternate app icons on iOS only. Each is Icon
Composer's macOS rendering of the app's .icon document, saved as an sRGB PNG in
references/ and placed in the macOS icon grid with the system drop shadow.
Titles and descriptions come from catalog.json.

Requires Pillow. Pass --export with BitDream's AppIcons folder to re-export the
references first; that needs Icon Composer's ictool (from Xcode). Run build.py
--rebuild afterwards to refresh the published files.
"""
from __future__ import annotations

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tempfile
from xml.sax.saxutils import escape

from PIL import Image, ImageCms, ImageFilter

HERE = Path(__file__).resolve().parent
REFERENCES = HERE.parent / "references"
CATALOG = json.loads((HERE.parent / "catalog.json").read_text(encoding="utf-8"))
COLLECTION = {app["id"]: app for app in CATALOG["collections"]}[HERE.name]
ICTOOL = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"

# Each variant's .icon document in BitDream's AppIcons folder. The default icon
# already ships with the Mac app, so only the alternates are here.
DOCUMENTS = {
    "blue-clouds": "BitDreamAppIconBlue.icon",
    "cloudy-day": "BitDreamAppIconPixelyClouds.icon",
}
# The macOS icon grid's 824px body, and its drop shadow (as vlc/test-pattern draws it).
BODY, INSET = 824, 100
SHADOW = {"blur": 10.8, "dy": 4, "opacity": 0.37}


def reference(variant: str) -> Path:
    return REFERENCES / f"bitdream-{variant}.png"


def export(app_icons: Path, ictool: str) -> None:
    """Render each document as Icon Composer draws it on macOS, converted from Display P3 to sRGB."""
    srgb = ImageCms.createProfile("sRGB")
    with tempfile.TemporaryDirectory() as scratch:
        for variant, document in DOCUMENTS.items():
            raw = Path(scratch) / f"{variant}.png"
            subprocess.run([ictool, str(app_icons / document), "--export-image", "--output-file", str(raw),
                            "--platform", "macOS", "--rendition", "Default",
                            "--width", str(BODY), "--height", str(BODY), "--scale", "1"], check=True, capture_output=True)
            with Image.open(raw) as image:
                profile = ImageCms.ImageCmsProfile(BytesIO(image.info["icc_profile"]))
                converted = ImageCms.profileToProfile(image.convert("RGBA"), profile, srgb, outputMode="RGBA")
            converted.save(reference(variant), optimize=True)
            print(reference(variant).relative_to(HERE.parent))


def data_uri(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def shadow(icon: Image.Image) -> Image.Image:
    """The icon's own outline, offset, blurred, and faded, on the full canvas."""
    alpha = Image.new("L", (1024, 1024))
    alpha.paste(icon.getchannel("A"), (INSET, INSET + SHADOW["dy"]))
    alpha = alpha.filter(ImageFilter.GaussianBlur(SHADOW["blur"])).point(lambda v: round(v * SHADOW["opacity"]))
    cast = Image.new("RGBA", (1024, 1024), (0, 0, 0, 255))
    cast.putalpha(alpha)
    return cast


def svg(icon: Image.Image, title: str, desc: str) -> str:
    layers = [
        ("shadow", f'<image x="0" y="0" width="1024" height="1024" href="{data_uri(shadow(icon))}"/>'),
        ("icon", f'<image x="{INSET}" y="{INSET}" width="{BODY}" height="{BODY}" href="{data_uri(icon)}"/>'),
    ]
    groups = "".join(f'<g id="{i:02d}-{name}" inkscape:groupmode="layer" inkscape:label="{i:02d}-{name}">{body}</g>'
                     for i, (name, body) in enumerate(layers, 1))
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
            f'width="1024" height="1024" viewBox="0 0 1024 1024"><title>{escape(title)}</title><desc>{escape(desc)}</desc>'
            f'{groups}</svg>')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=HERE, help="output directory (default: this collection)")
    parser.add_argument("--export", type=Path, metavar="APP_ICONS", help="re-export the references from BitDream's AppIcons folder first")
    parser.add_argument("--ictool", default=ICTOOL, help="Icon Composer's ictool executable")
    arguments = parser.parse_args()
    if arguments.export:
        export(arguments.export, arguments.ictool)
    for icon in COLLECTION["variants"]:
        with Image.open(reference(icon["id"])) as image:
            source = image.convert("RGBA")
        target = arguments.out / icon["id"] / "icon.svg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(svg(source, f"{COLLECTION['name']} — {icon['name']}", icon["description"]), encoding="utf-8")
        print(target.relative_to(arguments.out))


if __name__ == "__main__":
    main()
