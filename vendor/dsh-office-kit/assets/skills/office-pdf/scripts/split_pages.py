#!/usr/bin/env python3
"""Split a PDF into one file per page, per page range, or in fixed-size chunks.

Ranges are 1-based and inclusive; "6-" runs to the last page, "-4" starts at
page 1. Without --ranges or --every every page becomes its own file. Each part
copies the source metadata and reports its page count so the caller can check
the split before delivering it.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure,
3 refused (range outside the document, or output path collision).
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


def parse_ranges(spec, page_count):
    spans = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" not in part:
            start = end = int(part)
        else:
            first, last = part.split("-", 1)
            start = int(first) if first.strip() else 1
            end = int(last) if last.strip() else page_count
        if start < 1 or end > page_count or start > end:
            fail(f"range {part!r} is outside pages 1-{page_count}", code=3)
        spans.append((start, end))
    if not spans:
        fail("--ranges listed no usable range")
    spans.sort()
    for previous, current in zip(spans, spans[1:]):
        if current[0] <= previous[1]:
            fail(f"ranges overlap: {previous[0]}-{previous[1]} and {current[0]}-{current[1]}", code=3)
    return spans


def main():
    parser = argparse.ArgumentParser(
        description="Split a PDF into page ranges, single pages, or fixed-size chunks.",
        epilog='Example: split_pages.py --input report.pdf --out-dir parts --ranges "1-2,3,4-"',
    )
    parser.add_argument("--input", required=True, help="Source PDF")
    parser.add_argument("--out-dir", required=True, help="Directory for the parts")
    parser.add_argument("--ranges", help='1-based inclusive ranges, e.g. "1-2,5,8-"')
    parser.add_argument("--every", type=int, metavar="N", help="Fixed chunk size in pages")
    parser.add_argument("--prefix", help="Filename prefix (default: source stem)")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    if args.ranges and args.every:
        fail("use either --ranges or --every, not both")
    if args.every is not None and args.every < 1:
        fail("--every must be at least 1")

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    out_dir = Path(args.out_dir).expanduser()
    prefix = args.prefix or source.stem

    try:
        document = pymupdf.open(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)
    if document.needs_pass:
        document.close()
        fail("PDF is encrypted; decrypt it before splitting", code=3)
    page_count = document.page_count
    if page_count == 0:
        document.close()
        fail("the PDF has no pages", code=3)

    if args.ranges:
        spans = parse_ranges(args.ranges, page_count)
    elif args.every:
        spans = [(start, min(start + args.every - 1, page_count)) for start in range(1, page_count + 1, args.every)]
    else:
        spans = [(number, number) for number in range(1, page_count + 1)]

    out_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    for start, end in spans:
        name = f"{prefix}-p{start}.pdf" if start == end else f"{prefix}-p{start}-{end}.pdf"
        target = out_dir / name
        if target.resolve() == source.resolve():
            document.close()
            fail(f"refusing to overwrite the source PDF: {target}", code=3)
        part = pymupdf.open()
        part.insert_pdf(document, from_page=start - 1, to_page=end - 1)
        try:
            part.set_metadata(document.metadata or {})
        except Exception:
            pass
        try:
            part.save(str(target), garbage=3, deflate=True)
        except Exception as exc:
            part.close()
            document.close()
            fail(f"cannot write {target}: {exc}", code=2)
        written_pages = part.page_count
        part.close()
        parts.append({"file": str(target), "first_page": start, "last_page": end, "pages": written_pages})

    document.close()
    result = {
        "ok": True,
        "input": str(source),
        "source_pages": page_count,
        "out_dir": str(out_dir),
        "parts": parts,
        "parts_total_pages": sum(part["pages"] for part in parts),
    }
    if result["parts_total_pages"] != page_count:
        fail(
            f"wrote {result['parts_total_pages']} pages but the source has {page_count}; check the ranges",
            code=3,
        )
    emit(result, args.json_out)


if __name__ == "__main__":
    main()
