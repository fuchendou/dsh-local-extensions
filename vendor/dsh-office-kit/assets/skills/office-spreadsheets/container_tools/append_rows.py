#!/usr/bin/env python3
"""Append rows to the bottom of an existing worksheet.

Rows are JSON arrays. The new rows start one row below the sheet's current last
row, so a table that ends at row 13 grows at row 14. Pass `null` for a blank
cell; do not pad with empty strings, which turn into text.

Because appending a row does not extend Excel Tables, conditional formats, or
chart ranges, follow up with the checks in the workbook's own conventions:
extend `tables[].ref`, copy the format of the row above, and widen any chart
that is supposed to include the new data.

Examples:
    append_rows.py --input book.xlsx --sheet Pipeline --rows '[["Delta Co","R. Osei","Proposal",98000,0.4]]'
    append_rows.py --input book.xlsx --sheet Pipeline --rows-file rows.json

    rows.json: [["Delta Co", "R. Osei", "Proposal", 98000, 0.4]]

Exit codes:
  0  rows appended (the JSON on stdout reports the new dimensions)
  1  refused: unknown sheet or malformed rows
  2  usage error, missing file, or unreadable workbook
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Append rows to the bottom of an .xlsx worksheet.")
    parser.add_argument("--input", required=True, help="source workbook")
    parser.add_argument("--out", help="destination workbook (default: <input>-edited.xlsx)")
    parser.add_argument("--sheet", required=True, help="target worksheet")
    parser.add_argument("--rows", metavar="JSON", help="rows as a JSON array of arrays")
    parser.add_argument("--rows-file", help="JSON file holding the rows array")
    return parser.parse_args()


def _error(message: str, code: int) -> int:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    return code


def read_rows(args: argparse.Namespace) -> list[list[object]]:
    if args.rows_file:
        payload = json.loads(Path(args.rows_file).expanduser().read_text(encoding="utf-8-sig"))
    elif args.rows:
        payload = json.loads(args.rows)
    else:
        raise ValueError("nothing to do: pass --rows or --rows-file")
    if isinstance(payload, dict):
        payload = payload.get("rows")
    if not isinstance(payload, list) or not all(isinstance(row, list) for row in payload):
        raise ValueError("rows must be a JSON array of arrays")
    if not payload:
        raise ValueError("rows array is empty")
    return payload


def main() -> int:
    args = parse_args()
    source = Path(args.input).expanduser()
    if not source.is_file():
        return _error(f"input file not found: {source}", 2)

    try:
        from openpyxl import load_workbook
    except ImportError as error:  # pragma: no cover - environment guard
        return _error(f"openpyxl missing: {error}", 2)

    try:
        rows = read_rows(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _error(str(error), 1)

    workbook = load_workbook(str(source))
    if args.sheet not in workbook.sheetnames:
        return _error(f"sheet not found: {args.sheet}", 1)

    worksheet = workbook[args.sheet]
    before = worksheet.dimensions
    start = worksheet.max_row + 1
    for offset, row in enumerate(rows):
        for column, value in enumerate(row, start=1):
            worksheet.cell(row=start + offset, column=column, value=value)

    out = Path(args.out).expanduser() if args.out else source.with_name(
        f"{source.stem}-edited{source.suffix}"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(str(out))
    after = worksheet.dimensions
    workbook.close()

    print(
        json.dumps(
            {
                "ok": True,
                "input": str(source),
                "output": str(out),
                "sheet": args.sheet,
                "rows_appended": len(rows),
                "first_row": start,
                "dimensions_before": before,
                "dimensions_after": after,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
