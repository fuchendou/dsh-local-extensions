#!/usr/bin/env python3
"""Write values or formulas into specific cells of an existing workbook.

Only the named cells change. Values are parsed with `json.loads` when they look
like JSON, so `42`, `3.5`, `true`, `null`, and `["a","b"]` become numbers and
structured values, while anything else (`hello`, `=SUM(B2:B9)`, `2026-01-31`) is
written as text. A leading `=` is a formula string and is stored as a formula.

Examples:
    set_cells.py --input book.xlsx --sheet Model --set B3=0.07 --set B4="=B2*(1+B3)"
    set_cells.py --input book.xlsx --spec cells.json

    cells.json: {"sheet": "Model", "cells": {"B3": 0.07, "D9": "=SUM(D2:D8)"}}
        or:    [{"sheet": "Model", "cells": {...}}, {"sheet": "Data", "cells": {...}}]

Exit codes:
  0  cells written (the JSON on stdout lists them)
  1  refused: unknown sheet or an unparseable assignment
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
    parser = argparse.ArgumentParser(
        description="Write values or formulas into specific cells of an .xlsx workbook.",
    )
    parser.add_argument("--input", required=True, help="source workbook")
    parser.add_argument("--out", help="destination workbook (default: <input>-edited.xlsx)")
    parser.add_argument("--sheet", help="target sheet for --set assignments")
    parser.add_argument("--set", action="append", default=[], metavar="A1=VALUE", help="assign one cell")
    parser.add_argument("--spec", help="JSON file with sheet/cells assignments")
    return parser.parse_args()


def _error(message: str, code: int) -> int:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    return code


def parse_value(raw: str):
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def assignments(args: argparse.Namespace) -> list[tuple[str, dict[str, object]]]:
    """Return [(sheet, {cell: value})] from --spec and --set, in that order."""
    batches: list[tuple[str, dict[str, object]]] = []
    if args.spec:
        payload = json.loads(Path(args.spec).expanduser().read_text(encoding="utf-8-sig"))
        items = payload if isinstance(payload, list) else [payload]
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("--spec items must be objects with sheet and cells")
            sheet = item.get("sheet")
            cells = item.get("cells")
            if not isinstance(sheet, str) or not isinstance(cells, dict):
                raise ValueError("--spec needs {sheet, cells: {A1: value}}")
            batches.append((sheet, dict(cells)))
    if args.set:
        if not args.sheet:
            raise ValueError("--set needs --sheet")
        cells: dict[str, object] = {}
        for pair in args.set:
            if "=" not in pair:
                raise ValueError(f"--set expects A1=VALUE, got: {pair}")
            address, raw = pair.split("=", 1)
            cells[address.strip().upper()] = parse_value(raw)
        batches.append((args.sheet, cells))
    if not batches:
        raise ValueError("nothing to do: pass --set A1=VALUE with --sheet, or --spec")
    return batches


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
        batches = assignments(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _error(str(error), 1)

    try:
        workbook = load_workbook(str(source))
    except Exception as error:  # noqa: BLE001
        return _error(f"cannot read workbook: {error}", 2)

    written: list[dict[str, object]] = []
    for sheet, cells in batches:
        if sheet not in workbook.sheetnames:
            return _error(f"sheet not found: {sheet}", 1)
        worksheet = workbook[sheet]
        for address, value in cells.items():
            worksheet[str(address)] = value
            written.append({"sheet": sheet, "cell": str(address), "value": value})

    out = Path(args.out).expanduser() if args.out else source.with_name(
        f"{source.stem}-edited{source.suffix}"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(str(out))
    workbook.close()

    print(
        json.dumps(
            {"ok": True, "input": str(source), "output": str(out), "written": written},
            ensure_ascii=False,
            indent=2,
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
