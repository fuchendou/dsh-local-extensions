#!/usr/bin/env python3
"""Read or rewrite the document information dictionary of a PDF.

Shows the standard metadata fields plus any custom keys the producer stored,
page geometry, and the PDF version. With --set it writes a new file whose
standard fields are merged over the originals and then reopens that file to
confirm the values actually persisted.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure,
3 refused (encrypted document or source overwrite attempt).
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

STANDARD = ("title", "author", "subject", "keywords", "creator", "producer", "creationDate", "modDate")
ALIASES = {
    "creationdate": "creationDate",
    "moddate": "modDate",
    "modified": "modDate",
    "creation_date": "creationDate",
    "modified_date": "modDate",
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


def normalise(key):
    lowered = key.strip().lstrip("/").lower()
    lowered = ALIASES.get(lowered, lowered)
    if lowered in STANDARD:
        return lowered
    fail(f"unknown metadata field {key!r}; supported: {', '.join(STANDARD)} (plain names or /Name keys)")


def clean(info):
    values = {}
    for key in STANDARD:
        value = (info or {}).get(key)
        if value:
            values[key] = value
    return values


def main():
    parser = argparse.ArgumentParser(
        description="Read PDF metadata, or write a copy with new standard fields.",
        epilog='Example: metadata.py --input in.pdf --set "title=Field report" --set "author=Ada" --out out.pdf',
    )
    parser.add_argument("--input", required=True, help="Source PDF; it is never modified")
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Metadata field to write; repeatable (title, author, subject, keywords, creator, producer, creationDate, modDate)",
    )
    parser.add_argument("--out", help="Destination PDF when --set is used")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    if args.set and not args.out:
        fail("--set needs --out; the input PDF is never overwritten")
    if args.out and not args.set:
        fail("--out is only meaningful together with --set")

    try:
        document = pymupdf.open(str(source))
    except Exception as exc:
        fail(f"cannot open PDF: {exc}", code=2)
    if document.needs_pass:
        document.close()
        fail("PDF is encrypted; remove the password before reading or writing metadata", code=3)

    before = clean(document.metadata)
    info = document.metadata or {}
    custom = {key: value for key, value in info.items() if key not in STANDARD and key not in {"format", "encryption"}}
    page_sizes = [
        {"page": number, "width": round(page.rect.width, 2), "height": round(page.rect.height, 2), "rotation": page.rotation}
        for number, page in enumerate(document, start=1)
    ]
    result = {
        "ok": True,
        "input": str(source),
        "page_count": document.page_count,
        "pdf_version": info.get("format"),
        "metadata": before,
        "custom_metadata": custom,
        "page_sizes": page_sizes,
    }

    if args.set:
        updates = {}
        for assignment in args.set:
            if "=" not in assignment:
                document.close()
                fail(f"--set needs KEY=VALUE, got {assignment!r}")
            key, value = assignment.split("=", 1)
            updates[normalise(key)] = value
        out = Path(args.out).expanduser()
        if out.resolve() == source.resolve():
            document.close()
            fail("refusing to overwrite the source PDF; choose a different --out", code=3)
        merged = dict(before)
        merged.update(updates)
        try:
            document.set_metadata(merged)
            out.parent.mkdir(parents=True, exist_ok=True)
            document.save(str(out), garbage=3, deflate=True)
        except Exception as exc:
            document.close()
            fail(f"cannot write {out}: {exc}", code=2)
        document.close()

        try:
            with pymupdf.open(str(out)) as written:
                after = clean(written.metadata)
        except Exception as exc:
            fail(f"cannot reopen {out} to verify metadata: {exc}", code=2)
        result["output"] = str(out)
        result["metadata_after"] = after
        result["applied"] = {key: value for key, value in updates.items() if after.get(key) == value}
        result["not_applied"] = [key for key in updates if after.get(key) != updates[key]]
    else:
        document.close()

    emit(result, args.json_out)


if __name__ == "__main__":
    main()
