#!/usr/bin/env python
"""Lint a document for formatting that fights its own styles.

The report answers "can Word restyle this document?"  Direct run formatting,
undefined style ids, hand-typed bullets and one-off font sizes are the usual
reasons a restyle pass does nothing.  Findings are advisory: a few are legitimate.

Exit codes: 0 clean, 1 findings, 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

MAX_FINDINGS = 50
BULLET_TEXT = ("\u2022", "- ", "* ")


def known_styles(doc: kit.Docx) -> dict[str, str]:
    styles = {}
    root = doc.xml("word/styles.xml")
    for node in root.findall(kit.q("style")):
        ident = node.get(kit.q("styleId"))
        name = node.find(kit.q("name"))
        styles[ident] = name.get(kit.q("val")) if name is not None else ident
    return styles


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report direct formatting, undefined styles and other style conflicts.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--json", default=None, help="Also write the report to this path")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    styles = known_styles(doc)
    findings = []
    sizes = Counter()
    direct = 0

    for index, paragraph in enumerate(doc.paragraphs(), start=1):
        text = kit.paragraph_text(paragraph).strip()
        style_id = kit.paragraph_style(paragraph)
        level = kit.heading_level(paragraph)
        if style_id and style_id not in styles:
            findings.append({"kind": "undefined_style", "index": index, "style": style_id})
        if level and paragraph.find(kit.q("pPr") + "/" + kit.q("rPr")) is not None:
            findings.append({"kind": "heading_paragraph_formatting", "index": index, "text": text[:80]})
        for run in paragraph.iter(kit.q("r")):
            props = run.find(kit.q("rPr"))
            if props is None or len(props) == 0:
                continue
            direct += 1
            if level and any(props.find(kit.q(tag)) is not None for tag in ("b", "i", "color", "sz")):
                findings.append({"kind": "heading_direct_formatting", "index": index, "text": text[:80]})
                break
            size = props.find(kit.q("sz"))
            if size is not None and not level and (size.get(kit.q("val")) or "").isdigit():
                sizes[int(size.get(kit.q("val")))] += 1
            if not kit.text_of(run):
                findings.append({"kind": "empty_run", "index": index})
                break
        if text.startswith(BULLET_TEXT) and paragraph.find(kit.q("pPr") + "/" + kit.q("numPr")) is None:
            findings.append({"kind": "manual_bullet", "index": index, "text": text[:80]})
        if "  " in text:
            findings.append({"kind": "double_space", "index": index, "text": text[:80]})
        if text != text.rstrip():
            findings.append({"kind": "trailing_space", "index": index})

    if sizes:
        common, _ = sizes.most_common(1)[0]
        for size, count in sizes.items():
            if size != common and count <= 3:
                findings.append({"kind": "body_size_outlier", "half_points": size, "count": count, "common_half_points": common})

    for table in doc.body().iter(kit.q("tbl")):
        if table.find(kit.q("tblPr") + "/" + kit.q("tblStyle")) is None:
            findings.append({"kind": "table_without_style"})

    counts = {}
    for finding in findings:
        counts[finding["kind"]] = counts.get(finding["kind"], 0) + 1

    report = {
        "ok": not findings,
        "styles_defined": len(styles),
        "directly_formatted_runs": direct,
        "counts": counts,
        "findings": findings[:MAX_FINDINGS],
        "truncated": max(0, len(findings) - MAX_FINDINGS),
    }
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2), encoding="utf-8")
    kit.emit(report)
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
