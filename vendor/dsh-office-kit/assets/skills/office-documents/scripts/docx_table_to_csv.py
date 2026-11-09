#!/usr/bin/env python
"""Export one table from a .docx to CSV.

Merged cells are expanded so the CSV has a rectangular shape: a horizontally
merged cell repeats its text across the spanned columns and a vertically merged
cell inherits the value from the row above.  That keeps downstream spreadsheets
aligned instead of silently shifting columns.

Exit codes: 0 success, 1 table index out of range, 2 bad input.
"""

from __future__ import annotations

import argparse
import csv
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


def cell_span(cell) -> int:
    props = cell.find(kit.q("tcPr"))
    if props is None:
        return 1
    span = props.find(kit.q("gridSpan"))
    if span is None:
        return 1
    try:
        return max(1, int(span.get(kit.q("val")) or 1))
    except ValueError:
        return 1


def vertical_merge(cell) -> str:
    props = cell.find(kit.q("tcPr"))
    if props is None:
        return ""
    merge = props.find(kit.q("vMerge"))
    if merge is None:
        return ""
    return merge.get(kit.q("val")) or "continue"


def table_rows(table) -> list[list[str]]:
    rows: list[list[str]] = []
    grid_width = 0
    for row in table.findall(kit.q("tr")):
        values: list[str] = []
        for cell in row.findall(kit.q("tc")):
            text = " ".join(" ".join(kit.text_of(paragraph).split()) for paragraph in cell.findall(kit.q("p"))).strip()
            span = cell_span(cell)
            merge = vertical_merge(cell)
            if merge == "continue":
                column = len(values)
                inherited = ""
                if rows and column < len(rows[-1]):
                    inherited = rows[-1][column]
                text = inherited
            values.extend([text] * span)
        grid_width = max(grid_width, len(values))
        rows.append(values)
    for row in rows:
        while len(row) < grid_width:
            row.append("")
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export a table from a .docx to CSV, expanding merged cells.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--table_index", type=int, default=0, help="Zero-based table index")
    parser.add_argument("--out", required=True, help="Output .csv path")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    tables = list(doc.xml("word/document.xml").iter(kit.q("tbl")))
    if args.table_index < 0 or args.table_index >= len(tables):
        print("error: table_index %d out of range (document has %d)" % (args.table_index, len(tables)), file=sys.stderr)
        return 1

    rows = table_rows(tables[args.table_index])
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(rows)

    kit.emit({"ok": True, "output": str(out), "tables": len(tables), "table_index": args.table_index, "rows": len(rows), "columns": len(rows[0]) if rows else 0})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
