#!/usr/bin/env python
"""Add numbered captions under tables and figures, with optional bookmarks.

The number is written as a ``SEQ`` field by default so Word renumbers when
captions move, with the current value cached as the field result so a renderer
that skips fields still shows a number.  ``--bookmarks`` adds stable bookmark
names (tbl1, fig1, ...) which ``insert_ref_fields.py`` can then reference.

Exit codes: 0 success, 2 bad input, 3 --materialize requested alongside a field
mode conflict (never raised: materialize simply writes literal numbers).
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

CAPTION_LABEL = {"table": "Table", "figure": "Figure"}


def caption_paragraph(label: str, number: int, text: str, bookmark: str | None, ident: int, materialize: bool):
    paragraph = etree.Element(kit.q("p"))
    props = etree.SubElement(paragraph, kit.q("pPr"))
    etree.SubElement(props, kit.q("pStyle")).set(kit.q("val"), "Caption")
    paragraph.append(kit.make_run("%s " % label))
    if bookmark:
        start = etree.SubElement(paragraph, kit.q("bookmarkStart"))
        start.set(kit.q("id"), str(ident))
        start.set(kit.q("name"), bookmark)
    if materialize:
        paragraph.append(kit.make_run(str(number)))
    else:
        for run in kit.field_runs("SEQ %s \\* ARABIC" % label, str(number)):
            paragraph.append(run)
    if bookmark:
        end = etree.SubElement(paragraph, kit.q("bookmarkEnd"))
        end.set(kit.q("id"), str(ident))
    if text:
        paragraph.append(kit.make_run(". " + text))
    return paragraph


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Insert numbered table/figure captions, optionally bookmarking them.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("output_docx", help="Output .docx")
    parser.add_argument("--tables", action="store_true", help="Caption tables")
    parser.add_argument("--figures", action="store_true", help="Caption figures (paragraphs containing a drawing)")
    parser.add_argument("--caption_text", default="", help="Text placed after the number")
    parser.add_argument("--bookmarks", action="store_true", help="Add tblN/figN bookmarks around the number")
    parser.add_argument("--materialize", action="store_true", help="Write literal numbers instead of SEQ fields")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    do_tables = args.tables or args.figures
    want_tables = args.tables or not do_tables
    want_figures = args.figures or not do_tables

    body = doc.body()
    tables = list(body.iter(kit.q("tbl"))) if want_tables else []
    figures = []
    if want_figures:
        for paragraph in body.iter(kit.q("p")):
            if paragraph.find(".//" + kit.q("drawing")) is not None or paragraph.find(".//" + kit.q("pict", kit.V)) is not None:
                figures.append(paragraph)

    ident = doc.next_id()
    added = []
    for index, table in enumerate(tables, start=1):
        bookmark = "tbl%d" % index if args.bookmarks else None
        paragraph = caption_paragraph(CAPTION_LABEL["table"], index, args.caption_text, bookmark, ident, args.materialize)
        table.addnext(paragraph)
        added.append({"kind": "table", "number": index, "bookmark": bookmark})
        ident += 1
    for index, figure in enumerate(figures, start=1):
        bookmark = "fig%d" % index if args.bookmarks else None
        paragraph = caption_paragraph(CAPTION_LABEL["figure"], index, args.caption_text, bookmark, ident, args.materialize)
        figure.addnext(paragraph)
        added.append({"kind": "figure", "number": index, "bookmark": bookmark})
        ident += 1

    if not added:
        print("error: no tables or figures found to caption", file=sys.stderr)
        return 2
    doc.save(args.output_docx)
    kit.emit({"ok": True, "output": str(Path(args.output_docx)), "captions": added})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
