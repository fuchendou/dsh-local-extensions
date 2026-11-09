#!/usr/bin/env python
"""Add a text watermark to the page background.

The watermark is a DrawingML text box in the default header: Word rotates it
-45 degrees, while VML-only renderers that drop VML shapes still show the mark.
It prints behind the body on every page and can be removed again by deleting
the header paragraph.

Exit codes: 0 success, 2 bad input.
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
    parser = argparse.ArgumentParser(description="Add a DrawingML text watermark to the document header.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--text", required=True, help="Watermark text, e.g. CONFIDENTIAL")
    parser.add_argument("--color", default="#C0C0C0", help="Shape fill colour (hex)")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    if kit.watermark_texts(doc):
        print("error: this document already has a watermark; remove it first", file=sys.stderr)
        return 2

    part = doc.ensure_header_footer("header")
    root = doc.xml(part)
    root.append(kit.watermark_paragraph(args.text, doc.next_id(), args.color))
    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "text": args.text, "part": part})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
