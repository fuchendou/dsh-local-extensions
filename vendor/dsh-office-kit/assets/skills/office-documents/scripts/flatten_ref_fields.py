#!/usr/bin/env python
"""Replace REF and PAGEREF fields with the text they resolve to.

A focused subset of field freezing: cross-reference fields are the ones that
most often render blank outside Word, so this script rewrites only those and
leaves TOC, SEQ and date fields untouched.

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

TARGETS = {"REF", "PAGEREF"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Flatten REF/PAGEREF cross-reference fields to literal text.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    flattened = 0
    for part in doc.text_parts():
        for paragraph in doc.paragraphs(part):
            for field in reversed(kit.paragraph_fields(paragraph)):
                if field["type"] not in TARGETS or not field["span"]:
                    continue
                first = field["span"][0]
                rpr = first.find(kit.q("rPr")) if first.tag == kit.q("r") else None
                position = paragraph.index(first)
                for node in field["span"]:
                    if node.getparent() is paragraph:
                        paragraph.remove(node)
                if field["result"]:
                    paragraph.insert(
                        position,
                        kit.make_run(field["result"], etree.fromstring(etree.tostring(rpr)) if rpr is not None else None),
                    )
                flattened += 1

    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "flattened": flattened})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
