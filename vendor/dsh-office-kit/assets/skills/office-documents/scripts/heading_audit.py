#!/usr/bin/env python
"""Audit the heading outline: skipped levels, empty headings, style escapes.

A reader who meets "Heading 3" straight after "Heading 1" loses the document's
shape, and a heading drawn with bold text instead of a heading style is invisible
to the navigation pane, the TOC field and every outline tool.

Exit codes: 0 clean, 1 findings, 2 bad input.
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

BOLD_LIKE = ("Heading", "Title")
HEADING_SIZE_HALF_POINTS = 26  # 13pt: larger than any body style should be


def manual_heading(paragraph) -> bool:
    """True when bold, oversized runs stand in for a heading style."""
    for run in paragraph.iter(kit.q("r")):
        props = run.find(kit.q("rPr"))
        if props is None or props.find(kit.q("b")) is None:
            continue
        size = props.find(kit.q("sz"))
        if size is not None and (size.get(kit.q("val")) or "0").isdigit() and int(size.get(kit.q("val"))) >= HEADING_SIZE_HALF_POINTS:
            return True
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report heading-level jumps, empty headings and manual heading formatting.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--max_findings", type=int, default=50, help="Cap the reported findings")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    findings = []
    outline = []
    previous = 0
    for index, paragraph in enumerate(doc.paragraphs(), start=1):
        text = kit.paragraph_text(paragraph).strip()
        level = kit.heading_level(paragraph)
        style = (kit.paragraph_style(paragraph) or "").strip().lower()
        if style == "title":
            outline.append({"index": index, "style": "Title", "text": text})
            continue
        if level:
            if not text:
                findings.append({"kind": "empty_heading", "index": index, "level": level})
                continue
            outline.append({"index": index, "level": level, "text": text})
            if previous and level > previous + 1:
                findings.append({"kind": "skipped_level", "index": index, "from": previous, "to": level, "text": text})
            if manual_heading(paragraph):
                findings.append({"kind": "manual_formatting", "index": index, "text": text})
            previous = level
        elif text and manual_heading(paragraph) and len(text) <= 120:
            findings.append({"kind": "heading_not_styled", "index": index, "text": text})

    counts = {}
    for finding in findings:
        counts[finding["kind"]] = counts.get(finding["kind"], 0) + 1

    kit.emit({"ok": not findings, "counts": counts, "headings": len(outline), "findings": findings[: args.max_findings], "truncated": max(0, len(findings) - args.max_findings)})
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
