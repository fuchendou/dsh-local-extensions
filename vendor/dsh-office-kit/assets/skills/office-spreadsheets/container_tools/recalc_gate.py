#!/usr/bin/env python3
"""Gate a workbook on formulas that actually resolve.

Recomputes the file through the helper CLI (`xlsx recalc`, which drives the DSH
LibreOffice kit on every platform), then classifies every formula cell: a real
value, a spreadsheet error, or no cached value at all. Also flags formulas that
point at sheets the workbook does not contain, and formulas whose text already
carries a `#REF!` literal.

Without the kit the recomputation cannot happen; `--no-recalc` then inspects the
cached values a previous producer left in the file instead of failing outright. A
file whose formulas carry no cached value at all cannot be certified.

Exit codes:
  0  verified: every formula resolved to a value
  1  failed: error cells, unverified formulas after recomputation, or formulas
     that point at sheets the workbook does not contain
  2  usage error, missing file, or unreadable workbook
  3  unverified: no formula engine and no complete set of cached values
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
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

SHEET_REF = re.compile(r"(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify that a workbook's formulas recalculate to values; "
        "report errors, missing cached results and dangling sheet references.",
    )
    parser.add_argument("--input", required=True, help="workbook to check")
    parser.add_argument(
        "--out",
        help="where to write the recalculated copy (default: <input>-recalculated.xlsx)",
    )
    parser.add_argument(
        "--cli",
        help="path to python/office_cli.py (default: guessed from this script's location)",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="interpreter that runs the helper CLI (default: this interpreter)",
    )
    parser.add_argument(
        "--no-recalc",
        action="store_true",
        help="do not recompute; check the cached values already stored in the file",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="treat formulas without a cached value as failures even without recalculation",
    )
    parser.add_argument("--ignore", help="comma-separated cells to accept as known errors, e.g. 'Rates!B7,B9'")
    return parser.parse_args()


def _default_cli() -> Path:
    return Path(__file__).resolve().parents[4] / "python" / "office_cli.py"


def _formula_cells(path: Path) -> tuple[list[str], list[tuple[str, str, str]]]:
    from openpyxl import load_workbook

    workbook = load_workbook(str(path), data_only=False)
    try:
        names = list(workbook.sheetnames)
        cells = [
            (worksheet.title, cell.coordinate, str(cell.value))
            for worksheet in workbook.worksheets
            for row in worksheet.iter_rows()
            for cell in row
            if isinstance(cell.value, str) and cell.value.startswith("=")
        ]
    finally:
        workbook.close()
    return names, cells


def _cached_values(path: Path, cells: list[tuple[str, str, str]]) -> dict[tuple[str, str], object]:
    from openpyxl import load_workbook

    workbook = load_workbook(str(path), data_only=True)
    try:
        return {
            (sheet, cell): workbook[sheet][cell].value
            for sheet, cell, _ in cells
            if sheet in workbook.sheetnames
        }
    finally:
        workbook.close()


def _referenced_sheets(formula: str) -> list[str]:
    found = []
    for match in SHEET_REF.finditer(formula):
        if match.start() and formula[match.start() - 1] == "#":
            continue  # error literal such as #REF!, not a sheet named REF
        name = (match.group(1) or match.group(2)).replace("''", "'")
        if name.startswith("[") or name.startswith("file:"):
            continue
        found.append(name)
    return found


def _recalculate(python: str, cli: Path, source: Path, out: Path) -> tuple[bool, str | None, str | None]:
    command = [python, str(cli), "xlsx", "recalc", "--input", str(source), "--out", str(out)]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=300)
    except FileNotFoundError as error:
        return False, f"cannot start the helper CLI: {error}", None
    except subprocess.TimeoutExpired:
        return False, "recalculation timed out after 300 seconds", None
    if completed.returncode == 0 and out.is_file():
        renderer = None
        try:
            renderer = json.loads(completed.stdout).get("renderer")
        except (json.JSONDecodeError, AttributeError):
            renderer = None
        return True, None, renderer
    message = (completed.stderr or completed.stdout or "").strip()
    try:
        parsed = json.loads(message)
        message = str(parsed.get("error", message))
    except json.JSONDecodeError:
        pass
    return False, message or f"helper CLI exited with code {completed.returncode}", None


def _ignored(entries: str | None) -> dict[str, set[str]]:
    allowed: dict[str, set[str]] = {}
    for entry in (entries or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "!" in entry:
            sheet, cell = entry.split("!", 1)
            allowed.setdefault(sheet.strip("'"), set()).add(cell.upper())
        else:
            allowed.setdefault("*", set()).add(entry.upper())
    return allowed


def main() -> int:
    args = parse_args()
    source = Path(args.input).expanduser()
    if not source.is_file():
        print(json.dumps({"ok": False, "error": f"file not found: {source}"}), file=sys.stderr)
        return 2

    try:
        sheet_names, cells = _formula_cells(source)
    except Exception as error:  # noqa: BLE001 - every unreadable workbook fails the same way
        print(json.dumps({"ok": False, "error": f"cannot read workbook: {error}"}), file=sys.stderr)
        return 2

    recalculated = False
    engine = None
    recalc_error = None
    checked = source
    if args.no_recalc:
        recalc_error = "recalculation skipped by --no-recalc"
    else:
        cli = Path(args.cli).expanduser() if args.cli else _default_cli()
        out = Path(args.out).expanduser() if args.out else source.with_name(
            f"{source.stem}-recalculated{source.suffix}"
        )
        if not cli.is_file():
            recalc_error = f"helper CLI not found: {cli}; pass --cli or use --no-recalc"
        else:
            recalculated, recalc_error, renderer = _recalculate(args.python, cli, source, out)
            if recalculated:
                checked = out
                engine = renderer or "recalculation engine"

    try:
        cached = _cached_values(checked, cells) if cells else {}
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"cannot read values: {error}"}), file=sys.stderr)
        return 2

    allowed = _ignored(args.ignore)
    errors: list[dict[str, object]] = []
    missing: list[dict[str, object]] = []
    dangling: list[dict[str, object]] = []
    ignored_cells: list[str] = []
    sheets_seen: dict[str, int] = {}
    valued = 0

    for sheet, coordinate, formula in cells:
        sheets_seen[sheet] = sheets_seen.get(sheet, 0) + 1
        value = cached.get((sheet, coordinate))
        accepted = coordinate.upper() in allowed.get(sheet, set()) or coordinate.upper() in allowed.get("*", set())

        if "#REF!" in formula:
            entry = {"sheet": sheet, "cell": coordinate, "formula": formula, "value": "#REF!"}
            if accepted:
                ignored_cells.append(f"{sheet}!{coordinate}")
            else:
                errors.append(entry)
        elif isinstance(value, str) and value.startswith("#"):
            entry = {"sheet": sheet, "cell": coordinate, "formula": formula, "value": value}
            if accepted:
                ignored_cells.append(f"{sheet}!{coordinate}")
            else:
                errors.append(entry)
        elif value is None:
            entry = {"sheet": sheet, "cell": coordinate, "formula": formula}
            if accepted:
                ignored_cells.append(f"{sheet}!{coordinate}")
            else:
                missing.append(entry)
        else:
            valued += 1

        if accepted:
            continue
        for reference in _referenced_sheets(formula):
            base = reference.split(":", 1)
            if all(part in sheet_names for part in base):
                continue
            dangling.append(
                {"sheet": sheet, "cell": coordinate, "formula": formula, "references": reference}
            )

    failures = bool(errors or dangling)
    if missing and (recalculated or args.strict):
        failures = True

    # Verified means every formula resolved on this run or arrived fully cached;
    # a file whose formulas have never been computed cannot be certified.
    if failures:
        verdict = "failed"
    elif not cells or recalculated or not missing:
        verdict = "verified"
    else:
        verdict = "unverified"

    payload = {
        "ok": verdict == "verified",
        "input": str(source),
        "checked_against": str(checked),
        "recalculated": recalculated,
        "engine": engine,
        "value_source": "recalculated" if recalculated else ("cached" if cells and not missing else None),
        "recalc_error": recalc_error,
        "verdict": verdict,
        "formulas_by_sheet": sheets_seen,
        "counts": {
            "formulas": len(cells),
            "valued": valued,
            "errors": len(errors),
            "missing": len(missing),
            "dangling": len(dangling),
            "ignored": len(ignored_cells),
        },
        "errors": errors,
        "missing": missing,
        "dangling": dangling,
        "ignored": ignored_cells,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    return {"verified": 0, "failed": 1, "unverified": 3}[verdict]


if __name__ == "__main__":
    sys.exit(main())
