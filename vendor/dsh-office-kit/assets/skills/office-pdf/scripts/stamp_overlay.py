#!/usr/bin/env python3
"""Stamp a running footer, header, or label onto selected pages of a PDF.

Draws the text on a transparent overlay with reportlab, then merges that overlay
into each chosen page with pypdf. The text supports {page} and {pages}, so one
template produces "Page 3 of 12" per page. Nothing in the source content stream
is rewritten, which keeps existing fonts, links, and form widgets intact.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure,
3 refused (encrypted document, bad page selection, or source overwrite).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

from pdf_fonts import find_cjk_font, has_non_latin, register_cjk_font

try:
    import pymupdf
except ImportError:  # pragma: no cover - PyMuPDF is a required dependency
    import fitz as pymupdf  # type: ignore[no-redef]

POSITIONS = {
    "bottom-left": "left",
    "bottom-center": "center",
    "bottom-right": "right",
    "top-left": "left",
    "top-center": "center",
    "top-right": "right",
}


def emit(value, out=None):
    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    if out:
        target = Path(out).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text + "\n", encoding="utf-8")
    print(text)


def fail(message, code=1):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(code)


def parse_pages(spec, page_count):
    if spec.strip().lower() in {"all", ""}:
        return list(range(1, page_count + 1))
    selected = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" not in part:
            selected.append(int(part))
        else:
            first, last = part.split("-", 1)
            selected.extend(range(int(first or 1), int(last or page_count) + 1))
    for number in selected:
        if number < 1 or number > page_count:
            fail(f"page {number} is outside 1-{page_count}", code=3)
    return sorted(set(selected))


def main():
    parser = argparse.ArgumentParser(
        description="Draw a text stamp on selected pages and merge it over the page content.",
        epilog='Example: stamp_overlay.py --input report.pdf --out stamped.pdf --text "Page {page} of {pages}" --position bottom-right',
    )
    parser.add_argument("--input", required=True, help="Source PDF; it is never modified")
    parser.add_argument("--out", required=True, help="Destination PDF")
    parser.add_argument("--text", required=True, help='Stamp text; {page} and {pages} are replaced, e.g. "Confidential - Page {page}/{pages}"')
    parser.add_argument(
        "--position",
        choices=sorted(POSITIONS),
        default="bottom-center",
        help="Anchor of the stamp (default: bottom-center)",
    )
    parser.add_argument("--font", default="Helvetica", help="reportlab font name (default: Helvetica)")
    parser.add_argument("--font-file", help="TTF/OTF/TTC file used for the stamp; required for CJK unless a system font is found")
    parser.add_argument("--font-size", type=float, default=9.0, help="Font size in points (default: 9)")
    parser.add_argument("--color", default="#666666", help="Hex text colour (default: #666666)")
    parser.add_argument("--margin", type=float, default=28.0, help="Page-edge margin in points (default: 28)")
    parser.add_argument("--opacity", type=float, default=1.0, help="Text opacity 0-1 (default: 1)")
    parser.add_argument("--pages", default="all", help='1-based selection, e.g. "1,3-5" (default: all)')
    parser.add_argument("--render-dir", help="Rasterise the stamped pages here for a visual check")
    parser.add_argument("--dpi", type=int, default=110, help="Render resolution (default: 110)")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    out = Path(args.out).expanduser()
    if out.resolve() == source.resolve():
        fail("refusing to overwrite the source PDF; choose a different --out", code=3)
    if args.font_size <= 0 or args.font_size > 96:
        fail("--font-size must be between 0 and 96")
    if not 0 < args.opacity <= 1:
        fail("--opacity must be greater than 0 and at most 1")
    if args.margin < 0 or args.margin > 200:
        fail("--margin must be between 0 and 200 points")
    try:
        colour = HexColor(args.color)
    except Exception:
        fail("--color must be a hex colour like #666666")

    try:
        reader = PdfReader(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)
    if reader.is_encrypted:
        fail("PDF is encrypted; decrypt it before stamping", code=3)
    page_count = len(reader.pages)
    selected = parse_pages(args.pages, page_count)

    sample = args.text.format(page=1, pages=page_count)
    font_name = args.font
    font_file = None
    if args.font_file or has_non_latin(sample):
        try:
            path = find_cjk_font(args.font_file)
        except FileNotFoundError as exc:
            fail(str(exc), code=2)
        if path is None:
            fail("stamp text needs a font beyond the base-14 Latin sets; pass --font-file with a CJK-capable TTF/TTC", code=2)
        try:
            font_name = register_cjk_font(path, "StampCJK")
        except Exception as exc:
            fail(f"cannot use font file {path}: {exc}", code=2)
        font_file = str(path)

    writer = PdfWriter()
    stamped = []
    for index, page in enumerate(reader.pages, start=1):
        if index in selected:
            box = page.mediabox
            width = float(box.width)
            height = float(box.height)
            label = args.text.format(page=index, pages=page_count)
            buffer = io.BytesIO()
            stamp = canvas.Canvas(buffer, pagesize=(width, height))
            stamp.setFillColor(colour)
            stamp.setFont(font_name, args.font_size)
            stamp.setFillAlpha(args.opacity)
            text_width = stamp.stringWidth(label, font_name, args.font_size)
            anchor = POSITIONS[args.position]
            if anchor == "left":
                x = args.margin
            elif anchor == "right":
                x = width - args.margin - text_width
            else:
                x = (width - text_width) / 2
            baseline = args.margin if args.position.startswith("bottom") else height - args.margin - args.font_size * 0.35
            stamp.drawString(x, baseline, label)
            stamp.save()
            buffer.seek(0)
            overlay = PdfReader(buffer).pages[0]
            page.merge_page(overlay)
            stamped.append({"page": index, "text": label, "x": round(x, 2), "y": round(baseline, 2)})
        writer.add_page(page)

    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with out.open("wb") as handle:
            writer.write(handle)
    except Exception as exc:
        fail(f"cannot write {out}: {exc}", code=2)

    rendered = []
    if args.render_dir:
        if args.dpi < 24 or args.dpi > 600:
            fail("--dpi must be between 24 and 600")
        target_dir = Path(args.render_dir).expanduser()
        target_dir.mkdir(parents=True, exist_ok=True)
        zoom = args.dpi / 72.0
        with pymupdf.open(str(out)) as rendered_doc:
            for page_number in selected:
                page = rendered_doc[page_number - 1]
                target = target_dir / f"page-{page_number}.png"
                page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).save(str(target))
                rendered.append(str(target))

    result = {
        "ok": True,
        "input": str(source),
        "output": str(out),
        "pages": page_count,
        "stamped_pages": stamped,
        "position": args.position,
        "font": font_name,
        "font_file": font_file,
        "font_size": args.font_size,
        "color": args.color,
        "rendered_pages": rendered,
    }
    if len(result["stamped_pages"]) != len(selected):
        fail(f"stamped {len(result['stamped_pages'])} pages but selected {len(selected)}", code=3)
    emit(result, args.json_out)


if __name__ == "__main__":
    main()
