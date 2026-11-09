#!/usr/bin/env python
"""Find and remove text watermarks from headers.

Both DrawingML watermarks (what ``watermark_add.py`` writes) and legacy VML
``v:textpath`` shapes are detected. A watermark that was meant for a draft can
end up in a signed document, and it is invisible in text extraction because it
lives in a shape, not in a paragraph run.

Exit codes: 0 clean, 1 watermarks found (report mode), 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report or remove watermarks stored as DrawingML or VML shapes in headers.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("--mode", choices=("report", "remove"), default="report")
    parser.add_argument("--contains", default=None, help="Only match watermarks containing this text")
    parser.add_argument("--out", default=None, help="Output .docx for --mode remove")
    args = parser.parse_args(argv)

    if args.mode == "remove" and not args.out:
        print("error: --mode remove needs --out", file=sys.stderr)
        return 2

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    found = kit.watermark_texts(doc)
    if args.contains:
        wanted = args.contains.lower()
        found = [item for item in found if wanted in (item["text"] or "").lower()]

    removed = 0
    if args.mode == "remove" and found:
        for item in found:
            paragraph = item["paragraph"]
            if paragraph is not None and paragraph.getparent() is not None:
                paragraph.getparent().remove(paragraph)
                removed += 1
        doc.save(args.out)
    elif args.mode == "remove":
        doc.save(args.out)

    kit.emit(
        {
            "ok": args.mode == "remove" or not found,
            "mode": args.mode,
            "watermarks": [{"part": item["part"], "text": item["text"]} for item in found],
            "removed": removed,
            "output": str(Path(args.out)) if args.out else None,
        }
    )
    return 0 if (args.mode == "remove" or not found) else 1


if __name__ == "__main__":
    raise SystemExit(main())
