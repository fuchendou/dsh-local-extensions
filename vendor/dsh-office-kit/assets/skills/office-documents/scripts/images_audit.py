#!/usr/bin/env python
"""Inventory images: where they come from, how big they are, and alt text.

Alt text lives on ``wp:docPr`` (``descr`` preferred, ``title`` accepted).  Missing
alt text is the accessibility defect readers hit first, and an oversized image is
the layout defect authors hit first, so both are reported with the numbers that
need changing.

Exit codes: 0 clean, 1 findings, 2 bad input.
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

EMU_PER_INCH = 914400
MAX_WIDTH_INCHES = 8.0


def part_for(rel_id: str, rels: dict) -> str | None:
    entry = rels.get(rel_id)
    return entry["resolved"] if entry else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List inline images with size, source part and alt-text status.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--max_rows", type=int, default=50)
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    rows = []
    findings = []
    for part in ["word/document.xml"] + doc.names("word/header") + doc.names("word/footer"):
        if not doc.exists(part):
            continue
        rels = {entry["id"]: entry for entry in doc.relationships(part)}
        for doc_pr in doc.xml(part).iter(kit.q("docPr", kit.WP)):
            blip = doc_pr.getparent().find(".//" + kit.q("blip", kit.A))
            embed = blip.get(kit.q("embed", kit.R)) if blip is not None else None
            extent = doc_pr.getparent().find(".//" + kit.q("extent", kit.WP))
            width = int(extent.get("cx")) / EMU_PER_INCH if extent is not None and extent.get("cx") else 0.0
            height = int(extent.get("cy")) / EMU_PER_INCH if extent is not None and extent.get("cy") else 0.0
            alt = doc_pr.get("descr") or doc_pr.get("title") or ""
            row = {
                "part": part,
                "name": doc_pr.get("name"),
                "source": part_for(embed, rels) if embed else None,
                "width_in": round(width, 2),
                "height_in": round(height, 2),
                "alt": alt or None,
            }
            rows.append(row)
            if not alt.strip():
                findings.append({"kind": "missing_alt", "part": part, "name": row["name"], "source": row["source"]})
            if width > MAX_WIDTH_INCHES:
                findings.append({"kind": "oversized", "part": part, "name": row["name"], "width_in": row["width_in"]})

    counts = {}
    for finding in findings:
        counts[finding["kind"]] = counts.get(finding["kind"], 0) + 1

    kit.emit({"ok": not findings, "images": len(rows), "counts": counts, "rows": rows[: args.max_rows], "findings": findings[: args.max_rows]})
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
