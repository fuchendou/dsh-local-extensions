#!/usr/bin/env python3
"""Compare two .xlsx workbooks and report every difference.

Compares what the files store, not what they display: cell values, formula
text, number formats and font/fill/alignment, merged ranges, column widths,
freeze panes, tables, conditional formats, charts and defined names. Use it to
prove that an edit touched only the cells that were asked for.

Computed results are not compared here; run recalc_gate.py for that.

Exit codes:
  0  the compared scope is identical
  1  differences found (the JSON on stdout lists them)
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
    # Legacy console codepages (cp936, cp1252) must not abort a report.
    sys.stdout.reconfigure(errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Diff two .xlsx workbooks: sheets, cells, formulas, "
        "formatting, merges, widths, tables, charts, defined names.",
    )
    parser.add_argument("--before", required=True, help="baseline .xlsx file")
    parser.add_argument("--after", required=True, help="edited .xlsx file")
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="maximum cell changes reported per sheet (default 200)",
    )
    parser.add_argument(
        "--no-formats",
        action="store_true",
        help="compare values and formulas only, ignore styling and number formats",
    )
    parser.add_argument("--sheet", action="append", help="restrict to this sheet (repeatable)")
    return parser.parse_args()


def _color_signature(color) -> str | None:
    if color is None:
        return None
    rgb = getattr(color, "rgb", None)
    if isinstance(rgb, str) and rgb.upper() not in ("00000000", "000000"):
        return rgb.upper()
    theme = getattr(color, "theme", None)
    if theme is not None:
        return f"theme{theme}"
    return None


def _style(cell) -> dict[str, object]:
    font = cell.font
    fill = cell.fill
    return {
        "format": cell.number_format,
        "bold": bool(font.bold),
        "italic": bool(font.italic),
        "size": font.sz,
        "color": _color_signature(font.color),
        "fill": _color_signature(fill.fgColor) if getattr(fill, "patternType", None) else None,
        "align": cell.alignment.horizontal,
    }


def _cells(worksheet) -> dict[str, tuple[object, dict[str, object]]]:
    found: dict[str, tuple[object, dict[str, object]]] = {}
    for row in worksheet.iter_rows():
        for cell in row:
            if cell.value is None and not cell.has_style:
                continue
            found[cell.coordinate] = (cell.value, _style(cell))
    return found


def _chart_entry(chart) -> dict[str, object]:
    from openpyxl.utils import get_column_letter

    refs = []
    for series in getattr(chart, "series", None) or []:
        value = getattr(series, "val", None)
        reference = getattr(getattr(value, "numRef", None), "f", None) or getattr(
            getattr(value, "strRef", None), "f", None
        )
        if reference:
            refs.append(reference)
    anchor = getattr(chart, "anchor", None)
    start = getattr(anchor, "_from", None)
    position = (
        f"{get_column_letter(start.col + 1)}{start.row + 1}" if start is not None else type(anchor).__name__
    )
    return {"anchor": position, "series": refs}


def _structure(worksheet) -> dict[str, object]:
    conditions = [
        {"range": str(item.sqref), "rules": [rule.type for rule in item.rules]}
        for item in worksheet.conditional_formatting
    ]
    return {
        "dimensions": worksheet.dimensions,
        "freeze_panes": worksheet.freeze_panes,
        "merged": sorted(str(item) for item in worksheet.merged_cells.ranges),
        "auto_filter": getattr(worksheet.auto_filter, "ref", None),
        "gridlines": bool(worksheet.sheet_view.showGridLines),
        "conditional_formats": conditions,
        "data_validations": len(worksheet.data_validations.dataValidation),
        "tables": {table.name: str(table.ref) for table in worksheet.tables.values()},
        "charts": [_chart_entry(chart) for chart in getattr(worksheet, "_charts", [])],
        "images": len(getattr(worksheet, "_images", [])),
        "column_widths": {
            name: round(dimension.width, 2)
            for name, dimension in worksheet.column_dimensions.items()
            if dimension.width
        },
    }


def _is_formula(value: object) -> bool:
    return isinstance(value, str) and value.startswith("=")


def _cell_changes(before, after, *, formats: bool, limit: int) -> list[dict[str, object]]:
    left = _cells(before)
    right = _cells(after)
    changes: list[dict[str, object]] = []
    for coordinate in sorted(set(left) | set(right)):
        a_value, a_style = left.get(coordinate, (None, None))
        b_value, b_style = right.get(coordinate, (None, None))
        if coordinate not in left:
            changes.append({"cell": coordinate, "kind": "added", "after": b_value})
        elif coordinate not in right:
            changes.append({"cell": coordinate, "kind": "removed", "before": a_value})
        elif a_value != b_value:
            if _is_formula(a_value) and not _is_formula(b_value):
                kind = "formula_removed"
            elif _is_formula(b_value) and not _is_formula(a_value):
                kind = "formula_added"
            elif _is_formula(a_value) and _is_formula(b_value):
                kind = "formula"
            else:
                kind = "value"
            changes.append(
                {"cell": coordinate, "kind": kind, "before": a_value, "after": b_value}
            )
        elif formats and a_style != b_style:
            fields = [
                key for key in a_style if a_style.get(key) != b_style.get(key)  # type: ignore[union-attr]
            ]
            changes.append(
                {
                    "cell": coordinate,
                    "kind": "format",
                    "fields": fields,
                    "before": {key: a_style[key] for key in fields},  # type: ignore[index]
                    "after": {key: b_style[key] for key in fields},  # type: ignore[index]
                }
            )
        if len(changes) > limit:
            break
    return changes


def _structure_changes(before, after) -> dict[str, object]:
    left = _structure(before)
    right = _structure(after)
    return {
        key: {"before": left[key], "after": right[key]}
        for key in left
        if left[key] != right[key]
    }


def _defined_names(workbook) -> dict[str, str | None]:
    return {
        entry.name: (entry.attr_text if entry.localSheetId is None else f"[{entry.localSheetId}] {entry.attr_text}")
        for entry in workbook.defined_names.values()
    }


def _names_changes(before, after) -> dict[str, object]:
    left = _defined_names(before)
    right = _defined_names(after)
    return {
        "added": sorted(set(right) - set(left)),
        "removed": sorted(set(left) - set(right)),
        "changed": {
            name: {"before": left[name], "after": right[name]}
            for name in sorted(set(left) & set(right))
            if left[name] != right[name]
        },
    }


def main() -> int:
    args = parse_args()
    before_path = Path(args.before).expanduser()
    after_path = Path(args.after).expanduser()
    for label, path in (("before", before_path), ("after", after_path)):
        if not path.is_file():
            print(json.dumps({"ok": False, "error": f"{label} file not found: {path}"}), file=sys.stderr)
            return 2

    try:
        from openpyxl import load_workbook
    except ImportError as error:  # pragma: no cover - environment guard
        print(json.dumps({"ok": False, "error": f"openpyxl missing: {error}"}), file=sys.stderr)
        return 2

    try:
        before = load_workbook(str(before_path), data_only=False)
        after = load_workbook(str(after_path), data_only=False)
    except Exception as error:  # noqa: BLE001 - any unreadable file is reported the same way
        print(json.dumps({"ok": False, "error": f"cannot read workbook: {error}"}), file=sys.stderr)
        return 2

    try:
        before_names = list(before.sheetnames)
        after_names = list(after.sheetnames)
        added = [name for name in after_names if name not in before_names]
        removed = [name for name in before_names if name not in after_names]
        common = [name for name in before_names if name in after_names]
        if args.sheet:
            common = [name for name in common if name in set(args.sheet)]

        sheet_reports = []
        for name in common:
            before_sheet = before[name]
            after_sheet = after[name]
            changes = _cell_changes(
                before_sheet, after_sheet, formats=not args.no_formats, limit=args.limit
            )
            structure = _structure_changes(before_sheet, after_sheet)
            if changes or structure:
                kinds: dict[str, int] = {}
                for change in changes:
                    kinds[change["kind"]] = kinds.get(change["kind"], 0) + 1
                sheet_reports.append(
                    {
                        "name": name,
                        "change_count": len(changes),
                        "kinds": kinds,
                        "truncated": len(changes) > args.limit,
                        "structure": structure,
                        "changes": changes,
                    }
                )

        workbook_names = _names_changes(before, after)
        identical = not (
            added
            or removed
            or sheet_reports
            or any(workbook_names.values())  # type: ignore[arg-type]
        )
        by_kind: dict[str, int] = {}
        for report in sheet_reports:
            for kind, count in report["kinds"].items():  # type: ignore[union-attr]
                by_kind[kind] = by_kind.get(kind, 0) + count

        payload = {
            "ok": True,
            "before": str(before_path),
            "after": str(after_path),
            "identical": identical,
            "workbook": {
                "sheets_added": added,
                "sheets_removed": removed,
                "sheet_order_changed": [
                    name
                    for name in after_names
                    if name in before_names and after_names.index(name) != before_names.index(name)
                ],
                "defined_names": workbook_names,
            },
            "sheets": sheet_reports,
            "summary": {
                "sheets_compared": len(common),
                "sheets_added": len(added),
                "sheets_removed": len(removed),
                "sheets_changed": len(sheet_reports),
                "cells_changed": sum(report["change_count"] for report in sheet_reports),  # type: ignore[arg-type]
                "by_kind": by_kind,
            },
        }
    finally:
        before.close()
        after.close()

    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    return 0 if payload["identical"] else 1


if __name__ == "__main__":
    sys.exit(main())
