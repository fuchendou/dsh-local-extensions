#!/usr/bin/env python3
"""Rasterise PDF pages to PNG and report the geometry of each page.

Rendering runs here in-process through PyMuPDF, so no external rasteriser has
to be installed. Besides the PNGs, this prints the numbers an agent needs to
judge a file: page size, rotation, text volume, image and vector path counts,
annotations, form widgets, and links. A normalised region can be rendered on
its own so a change request can be checked against the exact area it named.

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

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def emit(value, out=None):
    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    if out:
        target = Path(out).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text + "\n", encoding="utf-8")
    print(text)


def fail(message, code=1, detail=None):
    payload = {"ok": False, "error": message}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str), file=sys.stderr)
    raise SystemExit(code)


def parse_pages(spec, page_count):
    if not spec or spec.strip().lower() == "all":
        return list(range(1, page_count + 1))
    pages = []
    try:
        for part in spec.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                start_text, end_text = part.split("-", 1)
                start, end = int(start_text), int(end_text)
            else:
                start = end = int(part)
            if start < 1 or end > page_count or start > end:
                fail(f"page range out of bounds: {part} (document has {page_count} pages)")
            pages.extend(range(start, end + 1))
    except ValueError:
        fail(f"cannot parse page selection: {spec!r}")
    return sorted(dict.fromkeys(pages))


def parse_region(spec, page_count):
    """Parse PAGE:LEFT,TOP,WIDTH,HEIGHT with normalised 0-1 geometry."""
    page_text, _, box_text = spec.partition(":")
    if not box_text:
        fail("region must look like PAGE:LEFT,TOP,WIDTH,HEIGHT, for example 1:0.1,0.2,0.8,0.1")
    try:
        page = int(page_text)
        left, top, width, height = (float(value) for value in box_text.split(","))
    except ValueError:
        fail(f"cannot parse region: {spec!r}")
    if not 1 <= page <= page_count:
        fail(f"region page {page} is outside 1-{page_count}")
    if left < 0 or top < 0 or width <= 0 or height <= 0:
        fail("region needs left/top >= 0 and width/height > 0")
    if left + width > 1.000001 or top + height > 1.000001:
        fail("region must fit inside the page: left+width and top+height are normalised 0-1")
    return page, left, top, width, height


def region_rect(page, left, top, width, height, padding):
    box = page.rect
    rect = pymupdf.Rect(
        box.x0 + left * box.width,
        box.y0 + top * box.height,
        box.x0 + (left + width) * box.width,
        box.y0 + (top + height) * box.height,
    )
    return (rect + (-padding, -padding, padding, padding)) & box


def page_report(page, index):
    text = page.get_text()
    words = page.get_text("words")
    return {
        "page": index,
        "width_pt": round(page.rect.width, 2),
        "height_pt": round(page.rect.height, 2),
        "rotation": page.rotation,
        "chars": len(text),
        "words": len(words),
        "images": len(page.get_images(full=True)),
        "drawings": len(page.get_drawings()),
        "annotations": sum(1 for _ in page.annots() or []),
        "widgets": sum(1 for _ in page.widgets() or []),
        "links": len(page.get_links()),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Rasterise PDF pages to PNG and report per-page geometry.",
        epilog="Example: render_pages.py --input report.pdf --out-dir tmp/render --dpi 144 --pages 1-2",
    )
    parser.add_argument("--input", required=True, help="PDF file to inspect")
    parser.add_argument("--out-dir", help="Directory for the PNGs; omitted means inspect only")
    parser.add_argument("--pages", default="all", help='1-based selection such as "1-3,7" (default: all)')
    parser.add_argument("--dpi", type=int, default=110, help="Rasterisation resolution (default: 110)")
    parser.add_argument(
        "--region",
        help='Also render one normalised region, PAGE:LEFT,TOP,WIDTH,HEIGHT (0-1, 1-based page)',
    )
    parser.add_argument("--pad", type=float, default=2.5, help="Padding in points around --region (default: 2.5)")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    if args.dpi < 24 or args.dpi > 600:
        fail("--dpi must be between 24 and 600")
    if args.region and not args.out_dir:
        fail("--region needs --out-dir so the crop has somewhere to land")

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)

    try:
        document = pymupdf.open(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)

    out_dir = Path(args.out_dir).expanduser() if args.out_dir else None
    if out_dir:
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            fail(f"cannot create output directory: {exc}", code=2)

    pages = parse_pages(args.pages, document.page_count)
    region = parse_region(args.region, document.page_count) if args.region else None

    zoom = args.dpi / 72.0
    matrix = pymupdf.Matrix(zoom, zoom)
    reports = []
    warnings = []
    for index in pages:
        page = document[index - 1]
        report = page_report(page, index)
        if out_dir:
            png = out_dir / f"page-{index}.png"
            page.get_pixmap(matrix=matrix, alpha=False).save(str(png))
            report["png"] = str(png)
        if report["chars"] == 0 and report["images"] > 0:
            warnings.append(f"page {index} has images but no text layer: it may be a scan, which cannot be read as text")
        reports.append(report)

    if region:
        page_no, left, top, width, height = region
        rect = region_rect(document[page_no - 1], left, top, width, height, args.pad)
        png = out_dir / f"region-p{page_no}.png"
        document[page_no - 1].get_pixmap(matrix=matrix, clip=rect, alpha=False).save(str(png))
        crop = {
            "page": page_no,
            "region": {"left": left, "top": top, "width": width, "height": height},
            "rect_pt": [round(value, 2) for value in rect],
            "pad_pt": args.pad,
            "png": str(png),
            "chars_inside": len(document[page_no - 1].get_textbox(rect)),
        }
    else:
        crop = None

    emit(
        {
            "ok": True,
            "input": str(source),
            "page_count": document.page_count,
            "dpi": args.dpi,
            "out_dir": str(out_dir) if out_dir else None,
            "pages": reports,
            "region": crop,
            "warnings": warnings,
        },
        args.json_out,
    )


if __name__ == "__main__":
    main()
