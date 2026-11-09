#!/usr/bin/env python3
"""Erase a normalised page region and report exactly what disappeared.

Accepts the annotation payload the client sends (1-based page, region
normalised 0-1 against the rendered page) or explicit values, converts the
region into a PDF rectangle, pads it by a couple of points, and removes the text
and drawings the rectangle covers. The JSON result lists the removed characters
and removed drawing objects, so an agent can tell whether the region hit what
the user circled and nothing else.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure,
3 refused (page or region outside the document).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    import pymupdf
except ImportError:  # pragma: no cover - PyMuPDF is a required dependency
    import fitz as pymupdf  # type: ignore[no-redef]

PDF_REDACT_IMAGE_NONE = getattr(pymupdf, "PDF_REDACT_IMAGE_NONE", 0)
PDF_REDACT_IMAGE_PIXELS = getattr(pymupdf, "PDF_REDACT_IMAGE_PIXELS", 1)
PDF_REDACT_LINE_ART_NONE = getattr(pymupdf, "PDF_REDACT_LINE_ART_NONE", 0)
PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED = getattr(pymupdf, "PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED", 2)
PDF_REDACT_TEXT_REMOVE = getattr(pymupdf, "PDF_REDACT_TEXT_REMOVE", 0)


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


def parse_annotations(spec):
    if spec == "-":
        raw = sys.stdin.read()
    elif spec.strip().startswith(("{", "[")):
        raw = spec
    else:
        path = Path(spec).expanduser()
        if not path.is_file():
            fail(f"annotation payload not found: {path}", code=2)
        raw = path.read_text(encoding="utf-8-sig")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"invalid annotation JSON: {exc}")
    if isinstance(data, dict):
        data = data.get("annotations", [data])
    if not isinstance(data, list) or not data:
        fail("annotation payload must be a non-empty list of annotations")
    annotations = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            fail(f"annotation {index} is not an object")
        region = item.get("region")
        if not isinstance(region, dict):
            fail(f"annotation {index} has no region object")
        try:
            page = int(item["page"])
            left = float(region["left"])
            top = float(region["top"])
            width = float(region["width"])
            height = float(region["height"])
        except (KeyError, TypeError, ValueError):
            fail(f"annotation {index} needs numeric page and region left/top/width/height")
        annotations.append(
            {
                "index": index,
                "page": page,
                "region": {"left": left, "top": top, "width": width, "height": height},
                "text": item.get("text"),
                "requirement": item.get("requirement"),
            }
        )
    return annotations


def parse_fill(spec):
    if spec.lower() in {"none", "erase", ""}:
        return None
    value = spec.lstrip("#")
    if len(value) != 6:
        fail("--fill must be 'none' or a 6-digit hex colour like #ffffff")
    try:
        return tuple(int(value[offset : offset + 2], 16) / 255.0 for offset in (0, 2, 4))
    except ValueError:
        fail("--fill must be 'none' or a 6-digit hex colour like #ffffff")


def page_chars(page):
    return len(page.get_text("text"))


def page_words(page):
    return len(page.get_text("words"))


def rounded(rect):
    return [round(float(value), 2) for value in rect]


def main():
    parser = argparse.ArgumentParser(
        description="Remove the text and drawings inside a normalised page region and report what vanished.",
        epilog='Example: redact_region.py --input in.pdf --out out.pdf --annotations \'{"page":1,"region":{"left":0.064,"top":0.318,"width":0.891,"height":0.153}}\'',
    )
    parser.add_argument("--input", required=True, help="Source PDF; it is never modified")
    parser.add_argument("--out", required=True, help="Destination PDF")
    parser.add_argument(
        "--annotations",
        help="Draft annotation payload: a JSON list of {page, region:{left,top,width,height}}, a file path, inline JSON, or '-'",
    )
    parser.add_argument("--page", type=int, help="Single-region shorthand: 1-based page number")
    parser.add_argument(
        "--region",
        help="Single-region shorthand: left,top,width,height normalised 0-1, e.g. 0.06,0.32,0.89,0.15",
    )
    parser.add_argument("--pad", type=float, default=2.5, help="Points added around the region (default: 2.5)")
    parser.add_argument(
        "--fill",
        default="none",
        help="Paint the cleared area: 'none' erases content without drawing (default), or a hex colour",
    )
    parser.add_argument(
        "--images",
        choices=("none", "pixels"),
        default="none",
        help="Leave images alone (default) or also blank image pixels inside the region",
    )
    parser.add_argument(
        "--graphics",
        choices=("remove", "keep"),
        default="remove",
        help="Remove line art touching the region (default) or leave it",
    )
    parser.add_argument("--render-dir", help="Rasterise the pages this tool changed for a visual check")
    parser.add_argument("--dpi", type=int, default=120, help="Render resolution (default: 120)")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    out = Path(args.out).expanduser()
    if out.resolve() == source.resolve():
        fail("refusing to overwrite the source PDF; choose a different --out", code=3)
    if args.pad < 0 or args.pad > 36:
        fail("--pad must be between 0 and 36 points")
    if args.dpi < 24 or args.dpi > 600:
        fail("--dpi must be between 24 and 600")

    if args.annotations and (args.page or args.region):
        fail("use either --annotations or --page/--region, not both")
    if args.annotations:
        annotations = parse_annotations(args.annotations)
    elif args.page and args.region:
        try:
            parts = [float(part) for part in args.region.split(",")]
        except ValueError:
            fail("--region must be four comma-separated numbers")
        if len(parts) != 4:
            fail("--region must be four comma-separated numbers: left,top,width,height")
        annotations = [
            {
                "index": 1,
                "page": args.page,
                "region": dict(zip(("left", "top", "width", "height"), parts)),
                "text": None,
                "requirement": None,
            }
        ]
    else:
        fail("provide --annotations or both --page and --region")

    fill = parse_fill(args.fill)
    image_mode = PDF_REDACT_IMAGE_NONE if args.images == "none" else PDF_REDACT_IMAGE_PIXELS
    graphics_mode = (
        PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED if args.graphics == "remove" else PDF_REDACT_LINE_ART_NONE
    )

    try:
        document = pymupdf.open(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)
    if document.needs_pass:
        fail("PDF is encrypted; decrypt it before redacting", code=3)

    for annotation in annotations:
        if annotation["page"] < 1 or annotation["page"] > document.page_count:
            fail(
                f"annotation {annotation['index']} names page {annotation['page']} but the document has {document.page_count} pages",
                code=3,
            )
        region = annotation["region"]
        if any(value < 0 or value > 1 for value in region.values()):
            fail(f"annotation {annotation['index']} region must be normalised 0-1", code=3)

    by_page = {}
    for annotation in annotations:
        by_page.setdefault(annotation["page"], []).append(annotation)

    records = []
    page_changes = []
    for page_number in sorted(by_page):
        page = document[page_number - 1]
        page_rect = page.rect
        before_chars = page_chars(page)
        before_words = page_words(page)
        before_drawings = len(page.get_drawings())
        entries = []
        for annotation in by_page[page_number]:
            region = annotation["region"]
            base = pymupdf.Rect(
                page_rect.x0 + region["left"] * page_rect.width,
                page_rect.y0 + region["top"] * page_rect.height,
                page_rect.x0 + (region["left"] + region["width"]) * page_rect.width,
                page_rect.y0 + (region["top"] + region["height"]) * page_rect.height,
            )
            padded = pymupdf.Rect(
                base.x0 - args.pad,
                base.y0 - args.pad,
                base.x1 + args.pad,
                base.y1 + args.pad,
            )
            padded &= page_rect
            covered = page.get_textbox(padded)
            entries.append(
                {
                    "annotation": annotation,
                    "base": base,
                    "padded": padded,
                    "text_before": covered,
                    "words_before": len(page.get_textbox(padded).split()),
                }
            )
            page.add_redact_annot(padded, fill=fill)

        page.apply_redactions(images=image_mode, graphics=graphics_mode, text=PDF_REDACT_TEXT_REMOVE)

        after_chars = page_chars(page)
        after_words = page_words(page)
        after_drawings = len(page.get_drawings())
        page_changes.append(
            {
                "page": page_number,
                "chars_before": before_chars,
                "chars_after": after_chars,
                "removed_chars": before_chars - after_chars,
                "words_before": before_words,
                "words_after": after_words,
                "removed_words": before_words - after_words,
                "drawings_before": before_drawings,
                "drawings_after": after_drawings,
                "removed_drawings": before_drawings - after_drawings,
            }
        )
        for entry in entries:
            leftover = page.get_textbox(entry["padded"])
            region_text = entry["text_before"]
            records.append(
                {
                    "page": page_number,
                    "region": entry["annotation"]["region"],
                    "rect": rounded(entry["base"]),
                    "padded_rect": rounded(entry["padded"]),
                    "region_chars_removed": len(region_text) - len(leftover),
                    "leftover_chars_in_rect": len(leftover.strip()),
                    "text_before": region_text[:400],
                    "user_text": entry["annotation"]["text"],
                    "requirement": entry["annotation"]["requirement"],
                }
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        document.save(str(out), garbage=3, deflate=True)
    except Exception as exc:
        document.close()
        fail(f"cannot write {out}: {exc}", code=2)
    page_count = document.page_count
    document.close()

    try:
        from pypdf import PdfReader

        reader = PdfReader(str(out))
        pypdf_chars = [len(page.extract_text() or "") for page in reader.pages]
    except Exception:
        pypdf_chars = []

    rendered = []
    if args.render_dir:
        target_dir = Path(args.render_dir).expanduser()
        target_dir.mkdir(parents=True, exist_ok=True)
        zoom = args.dpi / 72.0
        with pymupdf.open(str(out)) as rendered_doc:
            for page_number in sorted(by_page):
                page = rendered_doc[page_number - 1]
                target = target_dir / f"page-{page_number}.png"
                page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).save(str(target))
                rendered.append(str(target))

    result = {
        "ok": True,
        "input": str(source),
        "output": str(out),
        "pages": page_count,
        "pad_points": args.pad,
        "fill": args.fill,
        "images": args.images,
        "graphics": args.graphics,
        "removed_chars": sum(change["removed_chars"] for change in page_changes),
        "removed_drawings": sum(change["removed_drawings"] for change in page_changes),
        "page_changes": page_changes,
        "annotations": records,
        "pypdf_page_chars": pypdf_chars,
        "rendered_pages": rendered,
    }
    emit(result, args.json_out)


if __name__ == "__main__":
    main()
