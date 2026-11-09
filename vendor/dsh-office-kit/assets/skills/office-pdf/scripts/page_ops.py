#!/usr/bin/env python3
"""Rearrange PDF pages: rotate, remove, reorder, and merge.

Loads the input document, optionally appends pages from other PDFs, then
applies the requested operations in a fixed order — merge, reorder, remove,
rotate — so a command means the same thing every time. Page content streams
are carried over as-is; nothing is re-flowed or re-drawn.

Page indices are zero-based. After the merge step they address the combined
page list, which is the list the other operations see.

Exit codes: 0 success, 1 bad arguments or nothing to do, 2 unreadable input or
write failure, 3 refused (encrypted document or source overwrite attempt).
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

from pypdf import PdfReader, PdfWriter  # noqa: E402


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


def parse_indices(spec, label):
    values = []
    for part in spec.split(","):
        part = part.strip()
        if part == "":
            continue
        try:
            values.append(int(part))
        except ValueError:
            fail(f"{label} needs comma-separated integers, got {spec!r}")
    return values


def check_indices(values, page_count, label):
    bad = [value for value in values if not 0 <= value < page_count]
    if bad:
        fail(f"{label} references page(s) {bad} but the combined document has pages 0..{page_count - 1}")
    return values


def load(path):
    file = Path(path).expanduser()
    if not file.is_file():
        fail(f"input not found: {file}", code=2)
    try:
        reader = PdfReader(str(file))
    except Exception as exc:
        fail(f"cannot open {file}: {exc}", code=2)
    if reader.is_encrypted:
        fail(f"{file} is encrypted; remove the password before rearranging pages", code=3)
    return file, reader


def main():
    parser = argparse.ArgumentParser(
        description="Rotate, remove, reorder, and merge PDF pages into a new file.",
        epilog=(
            'Example: page_ops.py --input in.pdf --out out.pdf --merge cover.pdf --order 2,0,1 --remove 0 --rotate 90 --pages 0'
        ),
    )
    parser.add_argument("--input", required=True, help="Source PDF; it is never modified")
    parser.add_argument("--out", help="Destination PDF (default: <input>-edited.pdf)")
    parser.add_argument("--merge", action="append", default=[], metavar="PDF[,PDF]",
                        help="Append pages from these PDFs; repeatable or comma-separated")
    parser.add_argument("--order", metavar="N,N,N",
                        help="Keep and reorder pages by these zero-based indices; unlisted pages are dropped")
    parser.add_argument("--remove", metavar="N,N", help="Drop these zero-based indices from the combined list")
    parser.add_argument("--rotate", type=int, choices=(90, 180, 270),
                        help="Clockwise rotation to apply to --pages")
    parser.add_argument("--pages", metavar="N,N", help="Pages the rotation applies to (default: all)")
    parser.add_argument("--json-out", help="Also write the JSON report to this path")
    args = parser.parse_args()

    merge_paths = []
    for chunk in args.merge:
        merge_paths.extend(part.strip() for part in chunk.split(",") if part.strip())

    rotating = bool(args.rotate) or bool(args.pages)
    if rotating and not args.rotate:
        fail("--pages needs --rotate")
    if args.rotate and not args.pages:
        args.pages = None
    if not (merge_paths or args.order or args.remove is not None or args.rotate):
        fail("nothing to do: pass --merge, --order, --remove, or --rotate/--pages")

    source, reader = load(args.input)
    out = Path(args.out).expanduser() if args.out else source.with_name(f"{source.stem}-edited.pdf")
    if out.resolve() == source.resolve():
        fail("refusing to overwrite the source PDF; choose a different --out", code=3)

    pages = list(reader.pages)
    sources = [str(source)]

    for path in merge_paths:
        _, extra = load(path)
        pages.extend(extra.pages)
        sources.append(str(Path(path).expanduser()))

    combined = len(pages)

    if args.order is not None:
        order = parse_indices(args.order, "--order")
        check_indices(order, combined, "--order")
        if len(set(order)) != len(order):
            fail("--order contains a duplicate page index")
        pages = [pages[index] for index in order]

    removed = []
    if args.remove is not None:
        remove = parse_indices(args.remove, "--remove")
        check_indices(remove, len(pages), "--remove")
        removed = sorted(set(remove))
        pages = [page for index, page in enumerate(pages) if index not in set(removed)]

    if not pages:
        fail("the operations removed every page")

    selected = None
    if args.rotate:
        selected = parse_indices(args.pages, "--pages") if args.pages is not None else list(range(len(pages)))
        check_indices(selected, len(pages), "--pages")

    writer = PdfWriter()
    for page in pages:
        writer.add_page(page)
    if reader.metadata:
        writer.add_metadata({key: str(value) for key, value in reader.metadata.items()})
    if args.rotate:
        for index in selected:
            writer.pages[index].rotate(args.rotate)

    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "wb") as handle:
            writer.write(handle)
    except Exception as exc:
        fail(f"cannot write {out}: {exc}", code=2)

    try:
        with open(out, "rb") as handle:
            written = PdfReader(handle)
            report = [
                {
                    "page": number,
                    "rotation": page.rotation,
                    "width": round(float(page.mediabox.width), 2),
                    "height": round(float(page.mediabox.height), 2),
                }
                for number, page in enumerate(written.pages, start=1)
            ]
            page_count = len(written.pages)
    except Exception as exc:
        fail(f"cannot reopen {out}: {exc}", code=2)

    emit(
        {
            "ok": True,
            "input": str(source),
            "sources": sources,
            "output": str(out),
            "pages_in": combined,
            "pages_out": page_count,
            "order": args.order,
            "removed": removed,
            "rotated": {"angle": args.rotate, "pages": selected} if args.rotate else None,
            "pages": report,
        },
        args.json_out,
    )


if __name__ == "__main__":
    main()
