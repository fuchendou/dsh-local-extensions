#!/usr/bin/env python
"""Freeze SEQ/REF field results into plain text so renders match Word.

Headless renderers do not always evaluate fields, so a caption may show "Table"
with no number.  The cached result is already inside the document; this script
throws away the field machinery and keeps that result as ordinary runs.

Exit codes: 0 success, 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def freeze(doc: kit.Docx, allowed: set[str]) -> int:
    flattened = 0
    for part in doc.text_parts():
        for paragraph in doc.paragraphs(part):
            for field in reversed(kit.paragraph_fields(paragraph)):
                if field["type"] not in allowed:
                    continue
                span = field["span"]
                if not span:
                    continue
                first = span[0]
                rpr = first.find(kit.q("rPr")) if first.tag == kit.q("r") else None
                position = paragraph.index(first)
                for node in span:
                    if node.getparent() is paragraph:
                        paragraph.remove(node)
                if field["result"]:
                    run = kit.make_run(field["result"], etree.fromstring(etree.tostring(rpr)) if rpr is not None else None)
                    paragraph.insert(position, run)
                flattened += 1
    return flattened


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replace SEQ/REF fields with their cached result text.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--only", nargs="+", default=["SEQ", "REF"], choices=["SEQ", "REF"], help="Field types to freeze")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    flattened = freeze(doc, set(args.only))
    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "only": args.only, "fields_frozen": flattened})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
