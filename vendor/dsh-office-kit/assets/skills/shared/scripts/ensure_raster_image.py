#!/usr/bin/env python3
"""Rasterise SVG artwork, one PDF page, or a raster image to a PNG.

Decks, workbooks and documents can only embed raster images, so vector art has
to become pixels before it can go in, and an oversized raster has to be scaled
down before it makes a file huge. SVG and PDF go through PyMuPDF in-process;
raster inputs go through Pillow (first frame, alpha kept or flattened).

Success prints exactly one JSON object on stdout. Failures print a JSON error
object on stderr and exit non-zero. The input file is never overwritten.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - PyMuPDF is a required dependency
    import fitz as pymupdf  # type: ignore[no-redef]

from PIL import Image, ImageColor

VECTOR_SUFFIXES = {".svg", ".pdf"}
RASTER_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def fail(message, code=1):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def background_color(spec):
    """Return an RGB tuple, or None for a transparent background."""
    if spec.strip().lower() == "transparent":
        return None
    try:
        return ImageColor.getrgb(spec.strip())[:3]
    except ValueError:
        fail(f"--background must be 'transparent' or a colour such as #ffffff, got {spec!r}")


def fit_size(width, height, target_width, target_height):
    """Scale a native pixel size toward the requested box, keeping the aspect ratio.

    One requested axis sizes the other; with both, the image fits inside the box.
    """
    if not target_width and not target_height:
        return round(width), round(height)
    scales = [t / n for t, n in ((target_width, width), (target_height, height)) if t]
    scale = min(scales)
    return max(1, round(width * scale)), max(1, round(height * scale))


def flatten(image, color):
    """Composite an RGBA image over a solid colour and drop the alpha channel."""
    canvas = Image.new("RGB", image.size, color)
    canvas.paste(image, (0, 0), image)
    return canvas


def vector_page(source, args, background):
    """Rasterise one SVG/PDF page at --dpi, optionally scaled or flattened."""
    try:
        document = pymupdf.open(str(source))
    except Exception as exc:  # noqa: BLE001 - surface the library message verbatim
        fail(f"cannot open input: {exc}", code=2)
    if not 1 <= args.page <= document.page_count:
        fail(f"--page {args.page} is outside 1-{document.page_count} for {source.name}")
    page = document[args.page - 1]
    if page.rect.width <= 0 or page.rect.height <= 0:
        fail(f"{source.name} page {args.page} has no drawable area", code=2)

    base = args.dpi / 72.0
    natural_width = page.rect.width * base
    natural_height = page.rect.height * base
    out_width, out_height = fit_size(natural_width, natural_height, args.width, args.height)
    zoom = base * (out_width / natural_width)
    try:
        pixmap = page.get_pixmap(
            matrix=pymupdf.Matrix(zoom, zoom),
            colorspace=pymupdf.csRGB,
            alpha=True,
        )
    except Exception as exc:  # noqa: BLE001 - rasterisation failure is an input problem
        fail(f"cannot rasterize page {args.page}: {exc}", code=2)
    image = Image.frombytes("RGBA", (pixmap.width, pixmap.height), pixmap.samples)
    return flatten(image, background) if background is not None else image


def raster_image(source, args, background):
    """Convert the first frame of a raster input to RGBA, then resize/flatten."""
    try:
        with Image.open(source) as raw:
            raw.seek(0)
            image = raw.convert("RGBA")
    except (OSError, ValueError) as exc:
        fail(f"cannot read raster input: {exc}", code=2)
    if args.width or args.height:
        image = image.resize(fit_size(*image.size, args.width, args.height), Image.Resampling.LANCZOS)
    return flatten(image, background) if background is not None else image


def main():
    parser = argparse.ArgumentParser(
        description="Rasterise an SVG file, one PDF page, or a raster image to PNG.",
        epilog='Example: ensure_raster_image.py --input logo.svg --dpi 300 --out logo.png',
    )
    parser.add_argument("--input", required=True, help="SVG, PDF, or raster image (.png/.jpg/.webp/.bmp/.tif/.gif)")
    parser.add_argument("--out", help="PNG output path (default: <input>-p<page>.png beside the input)")
    parser.add_argument("--dpi", type=int, default=150, help="resolution for SVG/PDF input (default: 150)")
    parser.add_argument("--page", type=int, default=1, help="1-based page for PDF/SVG input (default: 1)")
    parser.add_argument("--width", type=int, help="target width in pixels; the height follows the aspect ratio")
    parser.add_argument("--height", type=int, help="target height in pixels; the width follows the aspect ratio")
    parser.add_argument(
        "--background",
        default="#ffffff",
        help="colour behind transparent pixels, or 'transparent' to keep alpha (default: #ffffff)",
    )
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    suffix = source.suffix.lower()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    if suffix in VECTOR_SUFFIXES:
        kind = suffix.lstrip(".")
    elif suffix in RASTER_SUFFIXES:
        kind = "raster"
    else:
        fail(f"unsupported input extension {suffix or '(none)'}; expected .svg, .pdf, or a raster image")
    if args.dpi <= 0:
        fail("--dpi must be a positive integer")
    if args.page < 1:
        fail("--page must be 1 or greater")
    for label, value in (("--width", args.width), ("--height", args.height)):
        if value is not None and value <= 0:
            fail(f"{label} must be a positive integer")
    if kind == "raster" and args.page != 1:
        fail("raster inputs have one frame; use --page 1")
    background = background_color(args.background)

    out = Path(args.out).expanduser() if args.out else source.with_name(f"{source.stem}-p{args.page}.png")
    if out.resolve() == source.resolve():
        fail("--out points at the input file; refusing to overwrite it")
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        fail(f"cannot create output directory {out.parent}: {exc}", code=2)

    image = raster_image(source, args, background) if kind == "raster" else vector_page(source, args, background)
    try:
        image.save(str(out), "PNG")
    except OSError as exc:
        fail(f"cannot write {out}: {exc}", code=2)

    print(
        json.dumps(
            {
                "ok": True,
                "input": str(source),
                "out": str(out),
                "source_kind": kind,
                "page": args.page,
                "width": image.width,
                "height": image.height,
                "dpi": args.dpi if kind != "raster" else None,
                "bytes": out.stat().st_size,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
