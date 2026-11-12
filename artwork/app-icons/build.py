"""Verify published icons, or rebuild them offline from the self-contained SVGs.

Requires Pillow. --rebuild also requires vectorcraft-cli on PATH (or pass
--vectorcraft). The website build does not run this script.
"""
from __future__ import annotations

import argparse
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image
from PIL.IcnsImagePlugin import IcnsFile

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parents[1] / "public"
CATALOG = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
SVG = "{http://www.w3.org/2000/svg}"
SIZES = (16, 32, 64, 128, 256, 512, 1024)
REPRESENTATIONS = tuple((point, point, scale) for point in (16, 32, 128, 256, 512) for scale in (1, 2))
PNG_TYPES = {
    (16, 2): b"ic11", (32, 2): b"ic12",
    (128, 1): b"ic07", (128, 2): b"ic13",
    (256, 1): b"ic08", (256, 2): b"ic14",
    (512, 1): b"ic09", (512, 2): b"ic10",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def slug(value: str) -> str:
    require(SLUG.fullmatch(value) is not None, f"Not a lowercase kebab-case id: {value!r}")
    return value


def variant_source(app: dict, icon: dict) -> Path:
    return ROOT / slug(app["id"]) / slug(icon["id"])


def published(public: Path, app: dict, icon: dict) -> tuple[Path, Path]:
    """A variant's preview directory and .icns file; src/data/app-icons.ts derives the same URLs."""
    collection = public / slug(CATALOG["publicDir"]) / slug(app["id"])
    return collection / slug(icon["id"]), collection / f"{icon['id']}.icns"


def chunk(tag: bytes, payload: bytes) -> bytes:
    return tag + struct.pack(">I", len(payload) + 8) + payload


def encode_icns(previews: dict[int, Image.Image]) -> bytes:
    """Use straight RGB RLE + masks at small sizes, PNG for the other slots.

    This avoids the alpha conversion observed in iconutil's ic04/ic05 output.
    All ten slots are independently decoded and compared by verify_variant().
    """
    parts = []
    for point, _, scale in REPRESENTATIONS:
        image = previews[point * scale]
        if scale == 1 and point in (16, 32):
            bands = image.split()
            encoded = bytearray()
            for band in bands[:3]:
                raw = band.tobytes()
                for offset in range(0, len(raw), 128):
                    run = raw[offset:offset + 128]
                    encoded.append(len(run) - 1)
                    encoded.extend(run)
            parts.append(chunk(b"is32" if point == 16 else b"il32", bytes(encoded)))
            parts.append(chunk(b"s8mk" if point == 16 else b"l8mk", bands[3].tobytes()))
        else:
            buffer = BytesIO()
            image.save(buffer, format="PNG", optimize=True)
            parts.append(chunk(PNG_TYPES[(point, scale)], buffer.getvalue()))
    payload = b"".join(parts)
    return b"icns" + struct.pack(">I", len(payload) + 8) + payload


def source_file(relative: str) -> Path:
    path = (ROOT / relative).resolve()
    require(path.is_relative_to(ROOT.resolve()), f"Source escapes artwork directory: {relative}")
    return path


def optical_sources(app: dict, icon: dict) -> dict[int, Path]:
    source = variant_source(app, icon)
    sources = {}
    for size, relative in icon.get("opticalSources", {}).items():
        pixels = int(size)
        require(pixels in SIZES and pixels != 1024, f"Unsupported optical size: {size}")
        path = (source / relative).resolve()
        require(path.is_relative_to(source), f"Optical source escapes variant: {relative}")
        sources[pixels] = path
    return sources


def validate_svg(path: Path, title: str, description: str | None) -> None:
    """A self-contained SVG with the given title, and the given description or else any description."""
    svg = ET.parse(path).getroot()
    require(svg.findtext(f"{SVG}title") == title, f"{path}: title should be {title!r}")
    desc = svg.findtext(f"{SVG}desc")
    require(desc == description if description else bool(desc), f"{path}: description should be {description or 'present'!r}")
    # Everything it draws is embedded or defined inside it: no linked files, and no stylesheets that could load them
    for element in svg.iter():
        require(element.tag != f"{SVG}style", f"{path}: <style> element")
        for attribute, value in element.attrib.items():
            if attribute.split("}")[-1] == "href":
                require(value.startswith(("data:", "#")), f"{path}: external SVG dependency {value}")
            for target in re.findall(r"url\(\s*['\"]?([^)'\"]*)", value):
                require(target.startswith("#"), f"{path}: external SVG dependency url({target})")


def validate_sources(app: dict, icon: dict) -> None:
    """Title every SVG from the catalog; small-size sources add the sizes they cover and describe themselves."""
    title = f"{app['name']} — {icon['name']}"
    validate_svg(variant_source(app, icon) / "icon.svg", title, icon["description"])
    optical = optical_sources(app, icon)
    for svg in set(optical.values()):
        sizes = sorted(size for size, path in optical.items() if path == svg)
        covered = f"{sizes[0]}–{sizes[-1]}px" if len(sizes) > 1 else f"{sizes[0]}px"
        validate_svg(svg, f"{title} ({covered})", None)


def read_render(path: Path) -> Image.Image:
    with Image.open(path) as image:
        require(image.size == (1024, 1024), f"{path}: rendered source must be 1024 × 1024")
        return image.convert("RGBA")


def housing(app: dict) -> tuple[Image.Image, Image.Image] | None:
    profile = app.get("housing")
    if profile is None:
        return None
    return (read_render(source_file(profile["reference"])),
            Image.open(source_file(profile["screenMask"])).convert("1"))


def verify_variant(app: dict, icon: dict, public: Path = PUBLIC, rendered_sources: dict[Path, Path] | None = None) -> None:
    label = f"{app['name']} / {icon['name']}"
    validate_sources(app, icon)
    optical = optical_sources(app, icon)
    base, icns = published(public, app, icon)
    master = read_render(base / "icon-1024.png")
    profile = housing(app)
    if profile is not None:
        reference, screen = profile
        restored = Image.composite(master, reference, screen)
        require(master.tobytes() == restored.tobytes(), f"{label}: original housing changed")
    renders = {svg:read_render((rendered_sources or {}).get(svg, svg.with_name("render.png"))) for svg in set(optical.values())}
    previews = {}
    for size in SIZES:
        with Image.open(base / f"icon-{size}.png") as image:
            expected = renders.get(optical.get(size), master).resize((size, size), Image.Resampling.LANCZOS)
            require(image.size == (size, size), f"{label}: preview size {size}")
            require(image.convert("RGBA").tobytes() == expected.tobytes(), f"{label}: preview pixels {size}")
            previews[size] = expected
    with icns.open("rb") as handle:
        decoded = IcnsFile(handle)
        require(set(decoded.itersizes()) == set(REPRESENTATIONS), f"{label}: missing ICNS representation")
        for point, _, scale in REPRESENTATIONS:
            expected = previews[point * scale]
            actual = decoded.getimage((point, point, scale)).convert("RGBA")
            require(actual.size == expected.size and actual.tobytes() == expected.tobytes(), f"{label}: ICNS mismatch at {point}pt @{scale}x")
    detail = ", exact reference housing" if profile is not None else ""
    if optical:
        detail += f", optical artwork at {', '.join(map(str, sorted(optical)))}px"
    print(f"{label}: 1024px master, 7 previews{detail}, all 10 ICNS representations verified")


def verify_all(public: Path = PUBLIC, rendered_sources: dict[Path, Path] | None = None) -> None:
    """Verify every variant, and that the published folder holds nothing else (hidden files aside)."""
    keys = [f"{app['id']}-{icon['id']}" for app in CATALOG["collections"] for icon in app["variants"]]
    repeated = sorted({key for key in keys if keys.count(key) > 1})
    require(not repeated, f"Variants share an id or a page key (collection-variant): {', '.join(repeated)}")
    expected = set()
    for app in CATALOG["collections"]:
        for icon in app["variants"]:
            verify_variant(app, icon, public, rendered_sources)
            previews, icns = published(public, app, icon)
            expected |= {previews / f"icon-{size}.png" for size in SIZES} | {icns}
    folder = public / CATALOG["publicDir"]
    actual = {path for path in folder.rglob("*") if path.is_file() and not path.name.startswith(".")}
    extra = sorted(str(path.relative_to(folder)) for path in actual - expected)
    require(not extra, f"{folder}: files no variant publishes (run --rebuild to remove them): {', '.join(extra)}")


def publish(staged: Path) -> None:
    """Swap the verified folder in for the published one, so removed or renamed icons leave nothing behind."""
    target = PUBLIC / CATALOG["publicDir"]
    incoming, outgoing = (target.with_name(f".{target.name}-{name}") for name in ("incoming", "outgoing"))
    for leftover in (incoming, outgoing):
        shutil.rmtree(leftover, ignore_errors=True)
    shutil.copytree(staged, incoming)  # same filesystem as the target, so both renames are atomic
    if target.exists():
        target.rename(outgoing)
    incoming.rename(target)
    shutil.rmtree(outgoing, ignore_errors=True)


def rebuild(vectorcraft: str) -> None:
    executable = shutil.which(vectorcraft)
    if not executable:
        raise SystemExit("vectorcraft-cli not found. Install it separately or pass --vectorcraft /path/to/vectorcraft-cli.")
    # Stage the whole collection and verify it before replacing published files.
    with tempfile.TemporaryDirectory(prefix="app-icons-") as folder:
        stage = Path(folder)
        rendered_sources = {}
        for app in CATALOG["collections"]:
            for icon in app["variants"]:
                rendered = stage / f"{app['id']}-{icon['id']}.png"
                validate_sources(app, icon)
                svg = variant_source(app, icon) / "icon.svg"
                subprocess.run([executable, "convert", str(svg), str(rendered)], check=True, capture_output=True)
                master = read_render(rendered)
                profile = housing(app)
                if profile is not None:
                    master = Image.composite(master, *profile)
                optical = optical_sources(app, icon)
                renders = {}
                for index, svg in enumerate(sorted(set(optical.values()))):
                    raster = stage / f"{app['id']}-{icon['id']}-optical-{index}.png"
                    subprocess.run([executable, "convert", str(svg), str(raster)], check=True, capture_output=True)
                    renders[svg] = read_render(raster)
                    rendered_sources[svg] = raster
                preview, icns = published(stage, app, icon)
                preview.mkdir(parents=True, exist_ok=True)
                previews = {}
                for size in SIZES:
                    previews[size] = renders.get(optical.get(size), master).resize((size, size), Image.Resampling.LANCZOS)
                    previews[size].save(preview / f"icon-{size}.png", optimize=True)
                icns.write_bytes(encode_icns(previews))
        verify_all(stage, rendered_sources)
        publish(stage / CATALOG["publicDir"])
        for svg, raster in rendered_sources.items():
            shutil.copy2(raster, svg.with_name("render.png"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true", help="Render the SVGs and replace the published folder")
    parser.add_argument("--vectorcraft", default="vectorcraft-cli", help="VectorCraft CLI executable")
    arguments = parser.parse_args()
    if arguments.rebuild:
        rebuild(arguments.vectorcraft)
    verify_all()
