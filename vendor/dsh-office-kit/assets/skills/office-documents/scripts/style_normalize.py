#!/usr/bin/env python
"""Push formatting back onto styles so the document can be restyled again.

Two passes, both opt-in:

``--clear_paragraph_format``
    delete paragraph-mark direct formatting and stray run formatting, keeping
    character styles, so the paragraph style governs again.
``--enforce_heading_spacing``
    give headings consistent spacing and "keep with next" so a page break cannot
    strand a heading at the bottom of a page.

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

HEADING_SPACING = {1: (320, 120), 2: (240, 80), 3: (200, 60)}
KEEP_RUN_PROPS = {kit.q("rStyle"), kit.q("rtl"), kit.q("lang")}


def strip_run_formatting(paragraph) -> int:
    removed = 0
    for run in paragraph.iter(kit.q("r")):
        props = run.find(kit.q("rPr"))
        if props is None:
            continue
        for child in list(props):
            if child.tag not in KEEP_RUN_PROPS:
                props.remove(child)
                removed += 1
        if len(props) == 0:
            run.remove(props)
    return removed


def enforce_spacing(paragraph, level: int) -> None:
    props = paragraph.find(kit.q("pPr"))
    if props is None:
        props = etree.Element(kit.q("pPr"))
        paragraph.insert(0, props)
    for tag in ("spacing", "keepNext"):
        for existing in props.findall(kit.q(tag)):
            props.remove(existing)
    before, after = HEADING_SPACING.get(level, (240, 120))
    spacing = etree.SubElement(props, kit.q("spacing"))
    spacing.set(kit.q("before"), str(before))
    spacing.set(kit.q("after"), str(after))
    etree.SubElement(props, kit.q("keepNext"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Remove direct formatting and normalize heading spacing.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("output_docx", nargs="?", default=None, help="Output .docx")
    parser.add_argument("--out", default=None, help="Output .docx (alternative to the positional argument)")
    parser.add_argument("--clear_paragraph_format", action="store_true", help="Strip direct run and paragraph-mark formatting")
    parser.add_argument("--enforce_heading_spacing", action="store_true", help="Apply consistent heading spacing and keep-with-next")
    args = parser.parse_args(argv)

    out = args.out or args.output_docx
    if not out:
        parser.error("provide an output path (positional or --out)")
    if not (args.clear_paragraph_format or args.enforce_heading_spacing):
        parser.error("choose --clear_paragraph_format and/or --enforce_heading_spacing")

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    runs_cleaned = 0
    headings_spaced = 0
    for paragraph in doc.paragraphs():
        if args.clear_paragraph_format:
            props = paragraph.find(kit.q("pPr"))
            if props is not None:
                for mark in props.findall(kit.q("rPr")):
                    props.remove(mark)
            runs_cleaned += strip_run_formatting(paragraph)
        if args.enforce_heading_spacing:
            level = kit.heading_level(paragraph)
            if level:
                enforce_spacing(paragraph, level)
                headings_spaced += 1

    doc.save(out)
    kit.emit({"ok": True, "output": str(Path(out)), "runs_cleaned": runs_cleaned, "headings_spaced": headings_spaced})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
