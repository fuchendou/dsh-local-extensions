#!/usr/bin/env python
"""Replace a TOC placeholder with a real Word table-of-contents field.

The field is the portable choice: Word rebuilds the entries, numbering and page
numbers when it opens the file.  ``w:updateFields`` is set so that refresh
happens without the user pressing F9.  A cached hint line is included as the
field result so the area is not simply blank in renderers that ignore fields.

Exit codes: 0 success, 1 placeholder not found, 2 bad input.
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


def level_range(raw: str) -> str:
    cleaned = raw.replace(" ", "")
    if "-" in cleaned:
        low, high = cleaned.split("-", 1)
        if low.isdigit() and high.isdigit() and 1 <= int(low) <= int(high) <= 9:
            return "%s-%s" % (low, high)
    raise argparse.ArgumentTypeError("--levels must look like 1-3")


def request_update(settings) -> None:
    for node in settings.findall(kit.q("updateFields")):
        settings.remove(node)
    etree.SubElement(settings, kit.q("updateFields")).set(kit.q("val"), "true")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Insert a TOC field where a placeholder paragraph sits.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--out", default=None, help="Output .docx (default: overwrite the input)")
    parser.add_argument("--placeholder", default="[[TOC]]", help="Paragraph text token to replace")
    parser.add_argument("--levels", default="1-3", help='Heading levels to include, e.g. "1-3"')
    args = parser.parse_args(argv)

    try:
        levels = level_range(args.levels)
    except argparse.ArgumentTypeError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    target = None
    for paragraph in doc.paragraphs():
        if args.placeholder in kit.paragraph_text(paragraph):
            target = paragraph
            break
    if target is None:
        print("error: placeholder %r not found" % args.placeholder, file=sys.stderr)
        return 1

    parent = target.getparent()
    position = parent.index(target)
    root = etree.Element(kit.q("p"))
    for run in kit.field_runs('#TOC \\o "%s" \\h \\z \\u' % levels, "Right-click and choose Update Field to build the contents."):
        root.append(run)
    parent.remove(target)
    parent.insert(position, root)

    request_update(doc.xml("word/settings.xml"))
    out = args.out or args.docx
    doc.save(out)
    kit.emit({"ok": True, "output": str(Path(out)), "levels": levels, "paragraph_index": position})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
