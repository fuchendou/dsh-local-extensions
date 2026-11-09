#!/usr/bin/env python
"""Turn marker text such as ``[[REF:tbl1]]`` into real REF cross-reference fields.

Markers keep the source text readable while drafting; this pass converts them to
fields that Word resolves to the bookmark's caption or number.  The field is
inserted at the marker position with an optional text prefix, and the paragraph
is rebuilt with the formatting of its first run.

Exit codes: 0 success (no markers means no change), 1 pattern has no 'bookmark'
group, 2 bad input.
"""

from __future__ import annotations

import argparse
import re
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


def rebuild(paragraph, pattern: re.Pattern, prefix: str) -> int:
    text = kit.paragraph_text(paragraph)
    matches = list(pattern.finditer(text))
    if not matches:
        return 0
    rpr = kit.first_rpr(paragraph)
    pieces: list = []
    cursor = 0
    for match in matches:
        if match.start() > cursor:
            pieces.append(kit.make_run(text[cursor : match.start()], etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
        bookmark = match.groupdict().get("bookmark") or ""
        if prefix:
            pieces.append(kit.make_run(prefix, etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
        pieces.extend(kit.field_runs("REF %s \\h" % bookmark, "", etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
        cursor = match.end()
    if cursor < len(text):
        pieces.append(kit.make_run(text[cursor:], etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
    ppr = paragraph.find(kit.q("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    for piece in pieces:
        paragraph.append(piece)
    return len(matches)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replace [[REF:bookmark]] markers with REF cross-reference fields.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("output_docx", help="Output .docx")
    parser.add_argument("--pattern", default=r"\[\[REF:(?P<bookmark>[A-Za-z0-9_:\-]+)\]\]", help="Regex for markers; must contain a 'bookmark' group")
    parser.add_argument("--prefix", default="", help="Text inserted immediately before each field")
    args = parser.parse_args(argv)

    try:
        pattern = re.compile(args.pattern)
    except re.error as exc:
        print("error: bad --pattern: %s" % exc, file=sys.stderr)
        return 1
    if "bookmark" not in pattern.groupindex:
        print("error: --pattern needs a named group 'bookmark'", file=sys.stderr)
        return 1

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    replaced = 0
    touched = 0
    for paragraph in doc.paragraphs():
        count = rebuild(paragraph, pattern, args.prefix)
        if count:
            replaced += count
            touched += 1

    doc.save(args.output_docx)
    kit.emit({"ok": True, "output": str(Path(args.output_docx)), "fields": replaced, "paragraphs": touched})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
