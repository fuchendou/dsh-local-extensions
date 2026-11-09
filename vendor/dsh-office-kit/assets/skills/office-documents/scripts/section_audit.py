#!/usr/bin/env python
"""Report section geometry in inches so layout problems are visible as numbers.

Every ``sectPr`` is one page-layout decision: page size, orientation (portrait is
a page size where width < height, not a flag), margins, columns, header/footer
links, and the section start type.  Mixed page sizes in one file are the most
common cause of "why did page 4 shrink" reports, so a summary flag calls it out.

Exit codes: 0 clean, 1 suspicious geometry, 2 bad input.
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

TWIPS_PER_INCH = 1440


def inches(value: str | None) -> float | None:
    return round(int(value) / TWIPS_PER_INCH, 3) if value and value.lstrip("-").isdigit() else None


def describe(part: str, sect, index: int, doc: kit.Docx) -> dict:
    page = sect.find(kit.q("pgSz"))
    margins = sect.find(kit.q("pgMar"))
    columns = sect.find(kit.q("cols"))
    kind = sect.find(kit.q("type"))
    info = {
        "index": index,
        "part": part,
        "width_in": inches(page.get(kit.q("w"))) if page is not None else None,
        "height_in": inches(page.get(kit.q("h"))) if page is not None else None,
        "orientation": None,
        "margin_in": {},
        "columns": int(columns.get(kit.q("num"))) if columns is not None and columns.get(kit.q("num")) else 1,
        "start": kind.get(kit.q("val")) if kind is not None else "nextPage",
        "headers": [],
        "footers": [],
        "title_page": sect.find(kit.q("titlePg")) is not None,
        "page_number_start": None,
    }
    if info["width_in"] and info["height_in"]:
        info["orientation"] = "portrait" if info["width_in"] < info["height_in"] else "landscape"
    if margins is not None:
        for side in ("top", "bottom", "left", "right", "header", "footer", "gutter"):
            info["margin_in"][side] = inches(margins.get(kit.q(side)))
    numbering = sect.find(kit.q("pgNumType"))
    if numbering is not None and numbering.get(kit.q("start")):
        info["page_number_start"] = int(numbering.get(kit.q("start")))
    rels = {entry["id"]: entry for entry in doc.relationships(part)}
    for tag, key in (("headerReference", "headers"), ("footerReference", "footers")):
        for ref in sect.findall(kit.q(tag)):
            rid = ref.get(kit.q("id", kit.R))
            info[key].append({"type": ref.get(kit.q("type")), "part": rels[rid]["resolved"] if rid in rels else None})
    return info


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report page size, orientation, margins and columns per section.")
    parser.add_argument("docx", help="Input .docx")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    sections = [describe("word/document.xml", sect, index, doc) for index, sect in enumerate(doc.sections(), start=1)]
    findings = []
    sizes = {(item["width_in"], item["height_in"]) for item in sections}
    if len(sizes) > 1:
        findings.append({"kind": "mixed_page_sizes", "sizes": sorted(sizes, key=lambda pair: (pair[0] or 0, pair[1] or 0))})
    for item in sections:
        margins = item["margin_in"]
        if margins.get("left") is not None and margins.get("right") is not None and margins["left"] + margins["right"] >= (item["width_in"] or 8.5) - 1:
            findings.append({"kind": "narrow_text_column", "section": item["index"], "left": margins["left"], "right": margins["right"]})
        if item["width_in"] and item["width_in"] > 8.5 and item["orientation"] == "portrait":
            findings.append({"kind": "portrait_wider_than_letter", "section": item["index"]})

    kit.emit({"ok": not findings, "sections": sections, "findings": findings})
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
