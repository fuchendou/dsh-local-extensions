#!/usr/bin/env python
"""Copy a worksheet range into a Word table.

The header row is bolded and marked as a repeating header so it appears again
when the table breaks across pages, which is the detail hand-built tables usually
miss.  This script uses python-docx directly because it creates a new document
rather than editing an existing one.

Exit codes: 0 success, 1 sheet or data not found, 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.shared import Pt

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a .docx whose body is a table filled from an .xlsx sheet.")
    parser.add_argument("xlsx", help="Input .xlsx")
    parser.add_argument("output_docx", nargs="?", default=None, help="Output .docx")
    parser.add_argument("--out", default=None, help="Output .docx (alternative to the positional argument)")
    parser.add_argument("--sheet", default=None, help="Sheet name (default: the active sheet)")
    parser.add_argument("--header_rows", type=int, default=1, help="Rows to treat as headers (default 1)")
    parser.add_argument("--title", default=None, help="Heading added above the table")
    args = parser.parse_args(argv)

    out = args.out or args.output_docx
    if not out:
        parser.error("provide an output path (positional or --out)")

    try:
        from openpyxl import load_workbook
    except ImportError:
        print("error: openpyxl is required to read .xlsx", file=sys.stderr)
        return 2

    try:
        workbook = load_workbook(args.xlsx, data_only=True, read_only=True)
    except OSError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    if args.sheet:
        if args.sheet not in workbook.sheetnames:
            print("error: sheet %r not found (have %s)" % (args.sheet, ", ".join(workbook.sheetnames)), file=sys.stderr)
            return 1
        sheet = workbook[args.sheet]
    else:
        sheet = workbook[workbook.sheetnames[0]]

    rows = [[cell_text(value) for value in row] for row in sheet.iter_rows(values_only=True)]
    rows = [row for row in rows if any(cell for cell in row)]
    if not rows:
        print("error: sheet %r has no data" % sheet.title, file=sys.stderr)
        return 1

    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header_count = max(0, min(args.header_rows, len(rows)))

    document = Document()
    if args.title:
        document.add_heading(args.title, level=1)

    table = document.add_table(rows=len(rows), cols=width)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row_index, row in enumerate(rows):
        for column_index, value in enumerate(row):
            cell = table.cell(row_index, column_index)
            cell.text = value
            if row_index < header_count:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.bold = True
                        run.font.size = Pt(11)

    document.save(out)
    payload = {"ok": True, "output": str(Path(out)), "sheet": sheet.title, "rows": len(rows), "columns": width, "header_rows": header_count}

    if header_count:
        doc = kit.Docx(out)
        first_row = doc.body().find(".//" + kit.q("tr"))
        if first_row is not None:
            props = first_row.find(kit.q("trPr"))
            if props is None:
                props = etree.Element(kit.q("trPr"))
                first_row.insert(0, props)
            etree.SubElement(props, kit.q("tblHeader"))
            doc.save(out)
            payload["header_row_repeats"] = True

    kit.emit(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
