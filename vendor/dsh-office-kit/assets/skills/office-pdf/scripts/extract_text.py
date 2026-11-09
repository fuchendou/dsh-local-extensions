#!/usr/bin/env python3
"""Extract per-page text and tables from a PDF with pdfplumber.

Use this when you need the words, not the picture: page text, word counts, and
detected tables as row arrays. Visual fidelity is not part of the contract -
layout, wrapping, and column order may differ from what the rendered page
shows - so always render before judging a document on this output alone.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure.
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


def clean(cell):
    return "" if cell is None else str(cell).replace("\n", " ").strip()


def main():
    parser = argparse.ArgumentParser(
        description="Extract page text and detected tables from a PDF.",
        epilog="Example: extract_text.py --input report.pdf --pages 1-2 --layout",
    )
    parser.add_argument("--input", required=True, help="PDF file to read")
    parser.add_argument("--pages", default="all", help='1-based selection such as "1-3,7" (default: all)')
    parser.add_argument("--layout", action="store_true", help="Keep rough horizontal layout in the text output")
    parser.add_argument("--no-tables", action="store_true", help="Skip table detection (faster on long documents)")
    parser.add_argument("--text-out", help="Also save the joined page text to this file")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)

    try:
        import pdfplumber
    except ImportError:
        fail("pdfplumber is not installed; run the plugin postinstall again", code=2)

    try:
        pdf = pdfplumber.open(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)

    with pdf:
        page_count = len(pdf.pages)
        selected = parse_pages(args.pages, page_count)
        reports = []
        warnings = []
        joined = []
        total_chars = 0
        total_tables = 0
        for index in selected:
            page = pdf.pages[index - 1]
            try:
                text = page.extract_text(layout=args.layout) or ""
            except Exception as exc:
                fail(f"page {index} text extraction failed: {exc}", code=2)
            report = {
                "page": index,
                "width_pt": round(float(page.width), 2),
                "height_pt": round(float(page.height), 2),
                "rotation": int(page.rotation or 0),
                "chars": len(text),
                "words": len(text.split()),
                "text": text,
                "tables": [],
            }
            if not args.no_tables:
                try:
                    tables = page.find_tables()
                except Exception as exc:
                    tables = []
                    warnings.append(f"page {index}: table detection failed: {exc}")
                for order, table in enumerate(tables, start=1):
                    rows = [[clean(cell) for cell in row] for row in table.extract()]
                    report["tables"].append(
                        {
                            "index": order,
                            "bbox": [round(float(value), 2) for value in table.bbox],
                            "row_count": len(rows),
                            "column_count": max((len(row) for row in rows), default=0),
                            "rows": rows,
                        }
                    )
                total_tables += len(report["tables"])
            if report["chars"] == 0 and len(page.images) > 0:
                warnings.append(
                    f"page {index} has images but no extractable text: it is probably a scan, "
                    "and this runtime has no OCR"
                )
            total_chars += report["chars"]
            joined.append(f"===== page {index} =====\n{text}")
            reports.append(report)

    if args.text_out:
        try:
            target = Path(args.text_out).expanduser()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("\n\n".join(joined).rstrip() + "\n", encoding="utf-8")
        except OSError as exc:
            fail(f"cannot write text output: {exc}", code=2)

    emit(
        {
            "ok": True,
            "input": str(source),
            "page_count": page_count,
            "pages_read": len(selected),
            "text_out": str(Path(args.text_out).expanduser()) if args.text_out else None,
            "total_chars": total_chars,
            "total_tables": total_tables,
            "pages": reports,
            "warnings": warnings,
        },
        args.json_out,
    )


if __name__ == "__main__":
    main()
