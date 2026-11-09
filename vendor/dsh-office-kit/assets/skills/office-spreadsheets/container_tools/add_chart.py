#!/usr/bin/env python3
"""Add a native, editable chart to an existing worksheet.

The chart is bound to cells, not to copied values: read the numbers you want to
plot straight from the sheet so the chart tracks later edits. Chart types are
the helper CLI's: `bar`, `column`, `line`, `pie`.

Reference rows/columns are 1-based sheet coordinates. `--data`-style flags
describe the plotted values; category flags describe the labels.

Examples:
    add_chart.py --input book.xlsx --sheet Trend --type line --title "Monthly revenue (USD)" \
        --anchor A6 --data-min-col 2 --data-min-row 3 --data-max-col 13 --data-max-row 3 \
        --cat-min-col 2 --cat-min-row 2 --cat-max-row 2
    add_chart.py --input book.xlsx --sheet Model --spec chart.json

    chart.json: {"title": "Q4 plan (USD)", "type": "column", "anchor": "A16",
                 "data": {"min_col": 2, "min_row": 11, "max_col": 2, "max_row": 14,
                          "titles_from_data": true,
                          "categories": {"min_col": 1, "min_row": 11, "max_row": 14}}}

A chart added this way has no explicit axis number format and keeps the default
series name, so check the rendered page and fix the title, units, and legend.

Exit codes:
  0  chart added (the JSON on stdout reports the sheet's chart count)
  1  refused: unknown sheet, incomplete reference, or unsupported chart type
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
CHART_TYPES = {"bar", "column", "line", "pie"}


def load_office_cli():
    """Reuse the helper CLI's chart builder so create-time and edit-time charts match."""
    scripts = ROOT / "python"
    if not (scripts / "office_cli.py").is_file():
        raise RuntimeError(f"helper CLI not found next to the skill: {scripts / 'office_cli.py'}")
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    import office_cli

    return office_cli


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add a native chart to an .xlsx worksheet.")
    parser.add_argument("--input", required=True, help="source workbook")
    parser.add_argument("--out", help="destination workbook (default: <input>-edited.xlsx)")
    parser.add_argument("--sheet", help="target worksheet (required unless --spec names one)")
    parser.add_argument("--spec", help="JSON file with a chart object or a list of chart objects")
    parser.add_argument("--type", default="column", choices=sorted(CHART_TYPES), help="chart type")
    parser.add_argument("--title", default="", help="chart title")
    parser.add_argument("--anchor", default="E2", help="top-left cell the chart floats over")
    parser.add_argument("--height", type=float, default=8.0, help="chart height in cm")
    parser.add_argument("--width", type=float, default=14.0, help="chart width in cm")
    parser.add_argument("--data-min-col", type=int, help="first data column (1-based)")
    parser.add_argument("--data-min-row", type=int, help="first data row (1-based)")
    parser.add_argument("--data-max-col", type=int, help="last data column (1-based)")
    parser.add_argument("--data-max-row", type=int, help="last data row (1-based)")
    parser.add_argument("--titles-from-data", action="store_true", help="first data row holds series names")
    parser.add_argument("--cat-min-col", type=int, help="first category column (1-based)")
    parser.add_argument("--cat-min-row", type=int, help="first category row (1-based)")
    parser.add_argument("--cat-max-row", type=int, help="last category row (1-based)")
    return parser.parse_args()


def _error(message: str, code: int) -> int:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    return code


def charts_from_flags(args: argparse.Namespace) -> list[dict[str, object]]:
    if args.data_min_col is None or args.data_min_row is None:
        raise ValueError("--data-min-col and --data-min-row are required without --spec")
    data: dict[str, object] = {
        "min_col": args.data_min_col,
        "min_row": args.data_min_row,
        "max_col": args.data_max_col if args.data_max_col is not None else args.data_min_col,
        "max_row": args.data_max_row if args.data_max_row is not None else args.data_min_row,
        "titles_from_data": bool(args.titles_from_data),
    }
    if args.cat_min_col is not None:
        categories: dict[str, object] = {"min_col": args.cat_min_col}
        if args.cat_min_row is not None:
            categories["min_row"] = args.cat_min_row
        if args.cat_max_row is not None:
            categories["max_row"] = args.cat_max_row
        data["categories"] = categories
    return [
        {
            "type": args.type,
            "title": args.title,
            "anchor": args.anchor,
            "height": args.height,
            "width": args.width,
            "data": data,
        }
    ]


def charts_from_spec(path: Path) -> list[dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    items = payload if isinstance(payload, list) else payload.get("charts", [payload])
    charts = [item for item in items if isinstance(item, dict)]
    if not charts:
        raise ValueError("--spec holds no chart objects")
    return charts


def is_row_oriented(spec: dict[str, object]) -> bool:
    """A one-row data range holds one series of many points, not many series of one."""
    data = spec.get("data")
    if not isinstance(data, dict):
        return False
    if data.get("from_rows"):
        return True
    min_row = int(data.get("min_row", 0))
    max_row = int(data.get("max_row", min_row))
    min_col = int(data.get("min_col", 0))
    max_col = int(data.get("max_col", min_col))
    return min_row == max_row and max_col > min_col


def add_row_oriented_chart(worksheet, spec: dict[str, object]) -> None:
    """Build the chart directly: the helper CLI's reference builder reads columns only."""
    from openpyxl.chart import BarChart, LineChart, PieChart, Reference

    chart_type = str(spec.get("type", "column")).lower()
    chart = {"bar": BarChart, "column": BarChart, "line": LineChart, "pie": PieChart}[chart_type]()
    chart.title = str(spec.get("title", ""))
    chart.height = float(spec.get("height", 8))
    chart.width = float(spec.get("width", 14))

    data = spec["data"]
    values = Reference(
        worksheet,
        min_col=int(data["min_col"]),
        min_row=int(data["min_row"]),
        max_col=int(data.get("max_col", data["min_col"])),
        max_row=int(data.get("max_row", data["min_row"])),
    )
    chart.add_data(values, titles_from_data=bool(data.get("titles_from_data", False)), from_rows=True)
    categories = data.get("categories")
    if isinstance(categories, dict):
        chart.set_categories(Reference(
            worksheet,
            min_col=int(categories.get("min_col", 1)),
            min_row=int(categories.get("min_row", 1)),
            max_row=int(categories.get("max_row", data.get("max_row", 1))),
        ))
    worksheet.add_chart(chart, str(spec.get("anchor", "E2")))


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
        charts = charts_from_spec(Path(args.spec).expanduser()) if args.spec else charts_from_flags(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _error(str(error), 1)

    if not args.sheet:
        return _error("--sheet is required", 2)

    workbook = load_workbook(str(source))
    if args.sheet not in workbook.sheetnames:
        return _error(f"sheet not found: {args.sheet}", 1)

    worksheet = workbook[args.sheet]
    added = []
    for chart in charts:
        chart_type = str(chart.get("type", "column")).lower()
        if chart_type not in CHART_TYPES:
            return _error(f"unsupported chart type: {chart_type}", 1)
        if is_row_oriented(chart):
            add_row_oriented_chart(worksheet, chart)
        else:
            office_cli._xlsx_add_chart(worksheet, chart)
        added.append(
            {
                "type": chart_type,
                "title": chart.get("title", ""),
                "anchor": chart.get("anchor", "E2"),
                "data": chart.get("data"),
            }
        )

    out = Path(args.out).expanduser() if args.out else source.with_name(
        f"{source.stem}-edited{source.suffix}"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(str(out))
    charts_on_sheet = len(worksheet._charts)
    workbook.close()

    print(
        json.dumps(
            {
                "ok": True,
                "input": str(source),
                "output": str(out),
                "sheet": args.sheet,
                "charts_added": len(added),
                "charts_on_sheet": charts_on_sheet,
                "charts": added,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
