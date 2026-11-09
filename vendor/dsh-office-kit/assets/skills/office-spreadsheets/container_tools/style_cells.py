#!/usr/bin/env python3
"""Apply number formats, fonts, fills, and alignment to existing cells.

The style vocabulary is the helper CLI's, so a style written here behaves exactly
like one written at create time: `bold`, `italic`, `size`, `color` (hex), `fill`
(hex), `number_format`, `align` (left/center/right).

Examples:
    style_cells.py --input book.xlsx --sheet Model --range B11:B14 \
        --style '{"number_format": "#,##0"}'
    style_cells.py --input book.xlsx --sheet Pipeline --range A1:G1 \
        --style '{"bold": true, "fill": "FF1F3864", "color": "FFFFFFFF", "align": "center"}'
    style_cells.py --input book.xlsx --spec styles.json

    styles.json: {"sheet": "Model", "styles": {"A11:B11": {"bold": true}, "C11:C14": {"number_format": "0.0%"}}}

Only cells covered by the given ranges change; neighbouring cells keep their
existing formatting.

Exit codes:
  0  styles applied (the JSON on stdout lists the ranges and styles)
  1  refused: unknown sheet, bad range, or no style given
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

ROOT = Path(__file__).resolve().parents[4]


def load_office_cli():
    """Import the helper CLI's style helpers so both paths format identically."""
    scripts = ROOT / "python"
    if not (scripts / "office_cli.py").is_file():
        raise RuntimeError(f"helper CLI not found next to the skill: {scripts / 'office_cli.py'}")
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    import office_cli

    return office_cli


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply number formats, fonts, fills, and alignment to cells in an .xlsx workbook.",
    )
    parser.add_argument("--input", required=True, help="source workbook")
    parser.add_argument("--out", help="destination workbook (default: <input>-edited.xlsx)")
    parser.add_argument("--sheet", help="target sheet for --range/--style")
    parser.add_argument("--range", action="append", default=[], metavar="A1:B2", help="cell or range to style")
    parser.add_argument("--style", help="JSON style object applied to every --range")
    parser.add_argument("--spec", help="JSON file with sheet/styles assignments")
    return parser.parse_args()


def _error(message: str, code: int) -> int:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    return code


def assignments(args: argparse.Namespace) -> list[tuple[str, dict[str, dict[str, object]]]]:
    batches: list[tuple[str, dict[str, dict[str, object]]]] = []
    if args.spec:
        payload = json.loads(Path(args.spec).expanduser().read_text(encoding="utf-8-sig"))
        items = payload if isinstance(payload, list) else [payload]
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("styles"), dict):
                raise ValueError("--spec items need {sheet, styles: {range: style}}")
            batches.append((str(item.get("sheet", "")), dict(item["styles"])))
    if args.range:
        if not args.sheet or not args.style:
            raise ValueError("--range needs both --sheet and --style")
        style = json.loads(args.style)
        if not isinstance(style, dict):
            raise ValueError("--style must be a JSON object")
        batches.append((args.sheet, {address: style for address in args.range}))
    if not batches:
        raise ValueError("nothing to do: pass --range with --style, or --spec")
    return batches


def main() -> int:
    args = parse_args()
    source = Path(args.input).expanduser()
    if not source.is_file():
        return _error(f"input file not found: {source}", 2)

    try:
        office_cli = load_office_cli()
        from openpyxl import load_workbook
    except (ImportError, RuntimeError) as error:  # pragma: no cover - environment guard
        return _error(str(error), 2)

    try:
        batches = assignments(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _error(str(error), 1)

    workbook = load_workbook(str(source))
    applied: list[dict[str, object]] = []
    for sheet, styles in batches:
        if sheet not in workbook.sheetnames:
            return _error(f"sheet not found: {sheet}", 1)
        worksheet = workbook[sheet]
        for address, style in styles.items():
            if not isinstance(style, dict):
                return _error(f"style for {address} must be an object", 1)
            cells = list(office_cli._xlsx_cells(worksheet, str(address).upper()))
            for cell in cells:
                office_cli._xlsx_apply_style(cell, style)
            applied.append({"sheet": sheet, "range": str(address).upper(), "cells": len(cells), "style": style})

    out = Path(args.out).expanduser() if args.out else source.with_name(
        f"{source.stem}-edited{source.suffix}"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(str(out))
    workbook.close()

    print(json.dumps({"ok": True, "input": str(source), "output": str(out), "applied": applied}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
