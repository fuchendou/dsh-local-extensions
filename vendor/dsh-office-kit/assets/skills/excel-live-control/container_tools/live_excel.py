#!/usr/bin/env python3
"""Change a workbook that is already open in Excel or WPS Spreadsheets.

The file on disk is not the target here: the user is looking at a live
document, possibly with unsaved edits. This tool attaches to the running
application through COM and issues commands against the workbook window, so
what the user sees after the call is what the script changed.

Mechanism: `powershell.exe` (Windows PowerShell 5.1) is started with a script
on stdin. That script calls
`[Runtime.InteropServices.Marshal]::GetActiveObject(...)` for 'Excel.Application'
and then 'Ket.Application' (WPS Spreadsheets) and reports one JSON object.
pywin32 and comtypes are not used and are not required.

Normal operation never starts a spreadsheet application. If neither ProgID is
in the running-object table the call fails and prints what the user should do
instead. `--launch-hidden` is the one exception and exists for self-tests.

Every mutating operation writes through `Range.Value2`, `Range.Formula` or a
named COM object (chart, table). None of them is transactional: a failure part
way through leaves what already landed in place, so a retry must be preceded by
a read, not by a repeat of the same call.

Exit codes:
  0  success: one JSON object on stdout
  1  the operation failed (attach, COM, validation); a JSON error object is
     printed on stdout and stderr
  2  usage error (argparse)
  3  powershell.exe is unavailable or timed out; a JSON error object is printed
"""

from __future__ import annotations

import argparse
import base64
import json
import locale
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    # JSON is UTF-8 by definition; a cp936 console would mangle sheet names.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CHART_TYPES = {
    "column": 51,
    "column-stacked": 52,
    "bar": 57,
    "bar-stacked": 58,
    "line": 4,
    "line-markers": 65,
    "area": 1,
    "area-stacked": 76,
    "pie": 5,
    "doughnut": -4120,
    "scatter": -4169,
    "scatter-lines": 74,
}

ALIGN_H = {"left": -4131, "center": -4108, "right": -4152, "general": 1, "justify": -4130}
ALIGN_V = {"top": -4160, "center": -4108, "bottom": -4104}

STYLE_KEYS = {
    "font_name",
    "font_size",
    "bold",
    "italic",
    "color",
    "fill",
    "number_format",
    "h_align",
    "v_align",
    "wrap",
    "indent",
    "border",
    "column_width",
}

CELL = re.compile(r"^([A-Za-z]{1,3})([0-9]{1,7})$")
HEX = re.compile(r"^#?[0-9A-Fa-f]{6}$")

ATTACH_REMEDIATION = (
    "Open the workbook in Excel or WPS Spreadsheets and keep it open, then run the "
    "command again. Nothing was started: this tool never creates a hidden instance "
    "for normal work (--launch-hidden exists only for self-tests)."
)


class ToolError(Exception):
    """A failure this script can explain, with the stage it happened in."""

    def __init__(self, message: str, stage: str = "request", remediation: str | None = None):
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.remediation = remediation


# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--workbook",
        metavar="NAME|PATH",
        help="which open workbook to drive (default: the only one open)",
    )
    common.add_argument(
        "--launch-hidden",
        action="store_true",
        help="start a hidden spreadsheet application when none is running "
        "(self-tests only; normal use must attach to the user's window)",
    )
    common.add_argument(
        "--timeout",
        type=int,
        default=180,
        metavar="SECONDS",
        help="how long to wait for the COM call (default 180)",
    )

    parser = argparse.ArgumentParser(
        prog="live_excel.py",
        description="Drive a workbook that is already open in Excel or WPS "
        "Spreadsheets: read it, write values and formulas, style ranges, add "
        "charts and tables, recalculate, save and close.",
    )
    parser.add_argument(
        "--diagnose",
        action="store_true",
        help="report the attach mechanism, application, workbooks and sheets; "
        "no operation is run",
    )

    commands = parser.add_subparsers(dest="command", metavar="COMMAND")

    def add(name: str, help_text: str) -> argparse.ArgumentParser:
        return commands.add_parser(name, parents=[common], help=help_text, description=help_text)

    add("info", "list the open workbooks and the structure of the target workbook")
    add(
        "read_range",
        "read values (and optionally formulas or displayed text) from one range",
    ).add_argument("--sheet", required=True)
    read = commands.choices["read_range"]
    read.add_argument("--range", required=True, help="A1 range, or 'used' for the used range")
    read.add_argument("--formulas", action="store_true", help="also return the formula grid")
    read.add_argument(
        "--display",
        action="store_true",
        help="also return the displayed text of every cell (max 500 cells)",
    )
    read.add_argument("--max-cells", type=int, default=5000, help="refuse ranges above this size")

    write = add("write_range", "write a rectangular block of values into one range")
    write.add_argument("--sheet", required=True)
    write.add_argument("--range", required=True, help="rectangular A1 range, for example A1:B3")
    write.add_argument(
        "--data",
        help='JSON 2D array, for example \'[[1,2],[3,4]]\'; one row per spreadsheet row',
    )
    write.add_argument("--data-file", help="path to a JSON file holding the 2D array")
    write.add_argument(
        "--clear",
        action="store_true",
        help="clear the contents of the range instead of writing (formats survive)",
    )

    formula = add("set_formula", "write formulas into one range or into named cells")
    formula.add_argument("--sheet", required=True)
    formula.add_argument("--range", help="range the --formula applies to")
    formula.add_argument("--formula", help="formula text starting with '='")
    formula.add_argument(
        "--cells",
        help='JSON object mapping addresses to formulas: \'{"C1":"=A1+B1"}\'',
    )
    formula.add_argument("--cells-file", help="path to a JSON file holding that object")
    formula.add_argument(
        "--r1c1",
        action="store_true",
        help="treat the formulas as R1C1 notation (FormulaR1C1)",
    )

    style = add("style_range", "apply font, fill, number format, alignment or borders")
    style.add_argument("--sheet", required=True)
    style.add_argument("--range", required=True)
    style.add_argument("--style", help="JSON style object, for example '{\"bold\":true}'")
    style.add_argument("--style-file", help="path to a JSON file holding the style object")
    style.add_argument(
        "--merge",
        action="store_true",
        help="merge the range after styling it (one value survives)",
    )

    chart = add("add_chart", "embed a chart on a sheet and point it at a range")
    chart.add_argument("--sheet", required=True)
    chart.add_argument(
        "--type",
        required=True,
        choices=sorted(CHART_TYPES),
        help="chart type",
    )
    chart.add_argument(
        "--data",
        required=True,
        help="source range on --sheet, or 'OtherSheet!A1:B10' for another sheet",
    )
    chart.add_argument("--anchor", required=True, help="top-left cell the chart is placed at")
    chart.add_argument("--title", help="chart title")
    chart.add_argument("--width", type=float, default=420.0, help="points (default 420)")
    chart.add_argument("--height", type=float, default=260.0, help="points (default 260)")

    table = add("add_table", "turn a range into a native Excel/WPS table (ListObject)")
    table.add_argument("--sheet", required=True)
    table.add_argument("--range", required=True)
    table.add_argument("--name", help="table name (letters, digits, underscore)")
    table.add_argument("--style", help="table style name, for example TableStyleMedium2")
    table.add_argument(
        "--no-headers",
        action="store_true",
        help="treat the first row as data and generate header names",
    )

    add("recalc", "recalculate every open workbook (CalculateFull)")

    save = add("save", "save the workbook over its own file, or save a copy elsewhere")
    save.add_argument("--path", help="save a copy here instead of saving in place")

    close = add("close", "close the target workbook, optionally quitting the application")
    close.add_argument("--save", action="store_true", help="save before closing")
    close.add_argument(
        "--discard",
        action="store_true",
        help="close without saving, discarding unsaved changes",
    )
    close.add_argument(
        "--quit-app",
        action="store_true",
        help="quit the application after closing (refused while other workbooks are open)",
    )

    return parser


def _require_sheet(args: argparse.Namespace) -> str:
    if not args.sheet or not args.sheet.strip():
        raise ToolError("--sheet is required: this tool never falls back to the active sheet", "usage")
    return args.sheet


def _json_payload(inline: str | None, path: str | None, name: str):
    if inline and path:
        raise ToolError(f"pass either {name} or the matching file flag, not both", "usage")
    if path:
        source = Path(path).expanduser()
        if not source.is_file():
            raise ToolError(f"{name}: file not found: {source}", "usage")
        try:
            return json.loads(source.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as error:
            raise ToolError(f"{name}: {source} is not valid JSON: {error}", "usage") from error
    if inline is None:
        raise ToolError(f"{name} is required", "usage")
    try:
        return json.loads(inline)
    except json.JSONDecodeError as error:
        raise ToolError(f"{name} is not valid JSON: {error}", "usage") from error


def _column_number(letters: str) -> int:
    value = 0
    for character in letters.upper():
        value = value * 26 + (ord(character) - ord("A") + 1)
    return value


def parse_rectangle(address: str) -> tuple[int, int, int, int]:
    """Return (top_row, left_column, rows, columns) for 'A1:C12'; -1 marks a bad address."""
    parts = address.split(":")
    if len(parts) not in (1, 2):
        raise ToolError(f"not a rectangular A1 range: '{address}'", "usage")
    first = CELL.match(parts[0].strip())
    second = CELL.match(parts[-1].strip())
    if not first or not second:
        raise ToolError(
            f"not a rectangular A1 range: '{address}' (use rows and columns, not A:A)",
            "usage",
        )
    row_one, column_one = int(first.group(2)), _column_number(first.group(1))
    row_two, column_two = int(second.group(2)), _column_number(second.group(1))
    top, bottom = min(row_one, row_two), max(row_one, row_two)
    left, right = min(column_one, column_two), max(column_one, column_two)
    return top, left, bottom - top + 1, right - left + 1


def _two_dimensional(data, field: str) -> list[list[object]]:
    if not isinstance(data, list) or not data:
        raise ToolError(f"{field} must be a non-empty JSON array of rows", "usage")
    rows: list[list[object]] = []
    for index, row in enumerate(data, start=1):
        if not isinstance(row, list):
            row = [row]
        rows.append(list(row))
    width = len(rows[0])
    for index, row in enumerate(rows, start=1):
        if len(row) != width:
            raise ToolError(
                f"{field}: row {index} has {len(row)} values but row 1 has {width}; "
                "every row must be the same length",
                "usage",
            )
    return rows


def _check_color(value, key: str) -> str:
    if not isinstance(value, str) or not HEX.match(value):
        raise ToolError(f"style.{key} must be a 6-digit hex RGB string like '#1F3864'", "usage")
    return value


def build_params(args: argparse.Namespace) -> dict[str, object]:
    command = args.command

    if command == "info":
        return {}

    if command == "read_range":
        if not args.range:
            raise ToolError("read_range needs --range (an A1 range, or 'used')", "usage")
        if args.max_cells < 1:
            raise ToolError("--max-cells must be at least 1", "usage")
        return {
            "sheet": _require_sheet(args),
            "range": args.range.strip(),
            "formulas": bool(args.formulas),
            "display": bool(args.display),
            "max_cells": int(args.max_cells),
        }

    if command == "write_range":
        sheet = _require_sheet(args)
        if not args.range:
            raise ToolError("write_range needs --range (a rectangular A1 range)", "usage")
        _, _, rows, columns = parse_rectangle(args.range)
        if args.clear:
            if args.data is not None or args.data_file is not None:
                raise ToolError("--clear writes nothing; drop --data and --data-file", "usage")
            return {
                "sheet": sheet,
                "range": args.range.strip(),
                "clear": True,
                "rows": 0,
                "cols": 0,
                "cells": [],
            }
        data = _two_dimensional(_json_payload(args.data, args.data_file, "--data"), "--data")
        if len(data) != rows or len(data[0]) != columns:
            raise ToolError(
                f"data is {len(data)} rows by {len(data[0])} columns but {args.range} is "
                f"{rows} rows by {columns} columns; make them match",
                "usage",
            )
        flat = [value for row in data for value in row]
        return {
            "sheet": sheet,
            "range": args.range.strip(),
            "clear": False,
            "rows": rows,
            "cols": columns,
            "cells": flat,
        }

    if command == "set_formula":
        sheet = _require_sheet(args)
        if bool(args.formula) == bool(args.cells or args.cells_file):
            raise ToolError("pass exactly one of --formula or --cells/--cells-file", "usage")
        if args.formula:
            if not args.range:
                raise ToolError("--formula needs --range", "usage")
            text = args.formula.strip()
            if not text.startswith("="):
                raise ToolError(f"formula must start with '=': '{args.formula}'", "usage")
            return {
                "sheet": sheet,
                "range": args.range.strip(),
                "formula": text,
                "r1c1": bool(args.r1c1),
            }
        mapping = _json_payload(args.cells, args.cells_file, "--cells")
        if not isinstance(mapping, dict) or not mapping:
            raise ToolError('--cells must be a JSON object such as {"C1":"=A1+B1"}', "usage")
        cleaned: dict[str, str] = {}
        for address, text in mapping.items():
            if not isinstance(text, str) or not text.strip().startswith("="):
                raise ToolError(f"formula for {address} must start with '='", "usage")
            if not CELL.match(address.strip()):
                raise ToolError(f"not a single-cell A1 address: '{address}'", "usage")
            cleaned[address.strip().upper()] = text.strip()
        return {"sheet": sheet, "cells": cleaned, "r1c1": bool(args.r1c1)}

    if command == "style_range":
        sheet = _require_sheet(args)
        if not args.range:
            raise ToolError("style_range needs --range", "usage")
        style = _json_payload(args.style, args.style_file, "--style")
        if not isinstance(style, dict) or not style:
            raise ToolError("--style must be a non-empty JSON object", "usage")
        unknown = sorted(set(style) - STYLE_KEYS)
        if unknown:
            raise ToolError(
                f"unknown style key(s): {', '.join(unknown)}; allowed: {', '.join(sorted(STYLE_KEYS))}",
                "usage",
            )
        if "color" in style:
            _check_color(style["color"], "color")
        if "fill" in style:
            _check_color(style["fill"], "fill")
        if "h_align" in style and style["h_align"] not in ALIGN_H:
            raise ToolError(
                f"style.h_align must be one of {', '.join(sorted(ALIGN_H))}", "usage"
            )
        if "v_align" in style and style["v_align"] not in ALIGN_V:
            raise ToolError(
                f"style.v_align must be one of {', '.join(sorted(ALIGN_V))}", "usage"
            )
        if "border" in style and style["border"] not in ("outline", "all", "none"):
            raise ToolError("style.border must be 'outline', 'all' or 'none'", "usage")
        return {"sheet": sheet, "range": args.range.strip(), "style": style, "merge": bool(args.merge)}

    if command == "add_chart":
        if args.width < 40 or args.height < 40:
            raise ToolError("--width and --height are in points and must be at least 40", "usage")
        return {
            "sheet": _require_sheet(args),
            "chart_type": CHART_TYPES[args.type],
            "type": args.type,
            "data": args.data.strip(),
            "anchor": args.anchor.strip().upper(),
            "title": args.title,
            "width": float(args.width),
            "height": float(args.height),
        }

    if command == "add_table":
        if args.name and not re.match(r"^[A-Za-z_][A-Za-z0-9_.]*$", args.name):
            raise ToolError(
                "--name must start with a letter or underscore and contain only letters, "
                "digits, underscores or dots",
                "usage",
            )
        return {
            "sheet": _require_sheet(args),
            "range": args.range.strip(),
            "name": args.name,
            "style": args.style,
            "no_headers": bool(args.no_headers),
        }

    if command == "recalc":
        return {}

    if command == "save":
        target = None
        existed = False
        if args.path:
            target = Path(args.path).expanduser().resolve()
            existed = target.exists()
            if target.is_dir():
                raise ToolError(f"--path is a directory, expected a file: {target}", "usage")
        return {"path": str(target) if target else "", "path_existed": existed}

    if command == "close":
        if args.save and args.discard:
            raise ToolError("--save and --discard are mutually exclusive", "usage")
        return {"save": bool(args.save), "discard": bool(args.discard), "quit_app": bool(args.quit_app)}

    raise ToolError(f"unknown command '{command}'", "usage")


# ---------------------------------------------------------------------------
# PowerShell bridge
# ---------------------------------------------------------------------------


def powershell_exe() -> str:
    found = shutil.which("powershell.exe") or shutil.which("powershell")
    if found:
        return found
    windows = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    candidate = windows / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if candidate.is_file():
        return str(candidate)
    raise ToolError(
        "Windows PowerShell 5.1 (powershell.exe) was not found; this tool drives COM "
        "through it because PowerShell 7 has no Marshal.GetActiveObject",
        "powershell",
    )


def decode_output(raw: bytes) -> str:
    for encoding in ("utf-8", locale.getpreferredencoding(False), "cp1252"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def extract_json(text: str) -> dict[str, object] | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def run_powershell(request: dict[str, object], timeout: int) -> dict[str, object]:
    payload = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.b64encode(payload).decode("ascii")
    try:
        # A trailing blank line is load-bearing: `powershell.exe -Command -` reads
        # statements from stdin and never runs the very last one when the input
        # ends on it, so the JSON would be swallowed.
        script = (_POWERSHELL_SCRIPT.replace("__REQUEST_B64__", encoded) + "\n").encode("ascii")
    except UnicodeEncodeError as error:  # pragma: no cover - guard against edited constants
        raise ToolError(f"the embedded PowerShell script is not ASCII: {error}", "internal") from error

    command = [powershell_exe(), "-NoProfile", "-NonInteractive", "-Command", "-"]
    try:
        completed = subprocess.run(
            command, input=script, capture_output=True, timeout=max(1, timeout)
        )
    except FileNotFoundError as error:
        raise ToolError(f"cannot start powershell.exe: {error}", "powershell") from error
    except subprocess.TimeoutExpired as error:
        raise ToolError(
            f"the COM call did not finish within {timeout}s; a dialog may be waiting for "
            "input in the spreadsheet application, or the operation was too large to batch",
            "timeout",
        ) from error

    stdout = decode_output(completed.stdout).strip()
    stderr = decode_output(completed.stderr).strip()
    result = extract_json(stdout)
    if result is None:
        detail = stderr or stdout or "(no output)"
        raise ToolError(
            f"PowerShell returned no JSON (exit {completed.returncode}): {detail[:900]}",
            "powershell",
        )
    if not result.get("ok") and stderr and "powershell_stderr" not in result:
        result["powershell_stderr"] = stderr[-900:]
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def failure_payload(op: str, error: ToolError) -> dict[str, object]:
    payload: dict[str, object] = {
        "ok": False,
        "op": op,
        "stage": error.stage,
        "error": error.message,
    }
    if error.remediation:
        payload["remediation"] = error.remediation
    return payload


def emit(payload: dict[str, object], code: int) -> int:
    text = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
    print(text)
    if code:
        print(text, file=sys.stderr)
    return code


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.diagnose and args.command:
        parser.error("--diagnose runs on its own; drop the command")
    if not args.diagnose and not args.command:
        parser.error("choose a command (info, read_range, ...) or pass --diagnose")

    op = "diagnose" if args.diagnose else str(args.command)
    try:
        params = {} if args.diagnose else build_params(args)
    except ToolError as error:
        return emit(failure_payload(op, error), 2)

    # macOS and Linux ship pwsh but no COM, and `shutil.which('powershell')` can find
    # that binary; fail on the platform instead of surfacing a cryptic attach error.
    if sys.platform != "win32":
        return emit(failure_payload(op, ToolError(
            "Excel/WPS live control drives the application through Windows PowerShell 5.1 "
            "COM, which only exists on Windows",
            "powershell",
        )), 3)

    request = {
        "op": op,
        "launch_hidden": bool(getattr(args, "launch_hidden", False)),
        "workbook": getattr(args, "workbook", None),
        "params": params,
    }

    started = time.monotonic()
    try:
        result = run_powershell(request, int(getattr(args, "timeout", 180)))
    except ToolError as error:
        if error.stage == "attach":
            payload = failure_payload(op, error)
            payload["remediation"] = ATTACH_REMEDIATION
            return emit(payload, 1)
        code = 3 if error.stage in ("powershell", "timeout") else 1
        return emit(failure_payload(op, error), code)

    if not result.get("ok"):
        payload = dict(result)
        payload.setdefault("op", op)
        if payload.get("stage") == "attach" and "remediation" not in payload:
            payload["remediation"] = ATTACH_REMEDIATION
        return emit(payload, 1)

    result["op"] = op
    result["elapsed_seconds"] = round(time.monotonic() - started, 2)
    return emit(result, 0)


# ---------------------------------------------------------------------------
# The PowerShell side. ASCII only: it travels through stdin, which Windows
# PowerShell decodes with the console codepage; all request data is base64.
# ---------------------------------------------------------------------------

_POWERSHELL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Get-OleColor {
    param([string]$Hex)
    $text = $Hex.Trim()
    if ($text.StartsWith('#')) { $text = $text.Substring(1) }
    if ($text.Length -ne 6 -or $text -notmatch '^[0-9A-Fa-f]{6}$') {
        throw "colour must be a 6-digit hex RGB string like '#1F3864'; got '$Hex'"
    }
    $r = [Convert]::ToInt32($text.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($text.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($text.Substring(4, 2), 16)
    return ($r + ($g * 256) + ($b * 65536))
}

function Get-SaveFormat {
    param([string]$Path)
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -eq '.xlsx') { return 51 }
    if ($extension -eq '.xlsm') { return 52 }
    if ($extension -eq '.xls')  { return 56 }
    if ($extension -eq '.csv')  { return 6 }
    if ($extension -eq '.txt')  { return -4158 }
    if ($extension -eq '.html' -or $extension -eq '.htm') { return 44 }
    throw "cannot save to '$Path': supported extensions are .xlsx, .xlsm, .xls, .csv, .txt, .html"
}

function Get-WorkbookList {
    param($App)
    $list = New-Object System.Collections.ArrayList
    $count = 0
    try { $count = [int]$App.Workbooks.Count } catch { $count = 0 }
    for ($i = 1; $i -le $count; $i++) {
        $book = $null
        try { $book = $App.Workbooks.Item($i) } catch { $book = $null }
        if ($null -ne $book) { [void]$list.Add($book) }
    }
    # Workbook objects are not enumerable, so the list can flow out unrolled.
    return $list
}

function Get-BookInfo {
    param($Book)
    $full = ''
    try { $full = [string]$Book.FullName } catch { $full = '' }
    $directory = ''
    try { $directory = [string]$Book.Path } catch { $directory = '' }
    $saved = $null
    try { $saved = [bool]$Book.Saved } catch { $saved = $null }
    $names = New-Object System.Collections.ArrayList
    try {
        for ($i = 1; $i -le $Book.Sheets.Count; $i++) {
            [void]$names.Add([string]$Book.Sheets.Item($i).Name)
        }
    } catch { }
    $path = $null
    if ($directory -ne '') { $path = $full }
    return [ordered]@{
        name      = [string]$Book.Name
        full_name = $full
        path      = $path
        saved     = $saved
        sheets    = @($names)
    }
}

function Get-SheetInfo {
    param($Sheet)
    $used = ''
    try { $used = [string]$Sheet.UsedRange.Address() } catch { $used = '' }
    $charts = 0
    try { $charts = [int]$Sheet.ChartObjects().Count } catch { $charts = 0 }
    $tables = New-Object System.Collections.ArrayList
    try {
        for ($i = 1; $i -le $Sheet.ListObjects.Count; $i++) {
            [void]$tables.Add([string]$Sheet.ListObjects.Item($i).Name)
        }
    } catch { }
    $pivots = 0
    try { $pivots = [int]$Sheet.PivotTables().Count } catch { $pivots = 0 }
    $visible = 1
    try { $visible = [int]$Sheet.Visible } catch { $visible = 1 }
    $protected = $false
    try { $protected = [bool]$Sheet.ProtectContents } catch { $protected = $false }
    return [ordered]@{
        name         = [string]$Sheet.Name
        used_range   = $used
        charts       = $charts
        tables       = @($tables)
        pivot_tables = $pivots
        visible      = $visible
        protected    = $protected
    }
}

function Resolve-Workbook {
    param($App, [string]$Selector)
    $books = @(Get-WorkbookList $App)
    if ($books.Count -eq 0) { throw 'no workbook is open in the attached application' }
    if ([string]::IsNullOrEmpty($Selector)) {
        if ($books.Count -eq 1) { return $books[0] }
        $names = @()
        foreach ($book in $books) { $names += [string]$book.Name }
        throw "several workbooks are open ($($names -join ', ')); pass --workbook with the file name or full path"
    }
    $hits = @()
    foreach ($book in $books) {
        $full = ''
        try { $full = [string]$book.FullName } catch { $full = '' }
        $name = [string]$book.Name
        if ($full -ne '' -and ($full -eq $Selector -or $full -ieq $Selector)) { $hits += $book; continue }
        if ([string]::Equals($name, $Selector, [StringComparison]::OrdinalIgnoreCase)) { $hits += $book; continue }
        if ($full -ne '' -and $full.IndexOf($Selector, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hits += $book; continue }
        if ($name.IndexOf($Selector, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hits += $book }
    }
    if ($hits.Count -eq 1) { return $hits[0] }
    if ($hits.Count -eq 0) { throw "no open workbook matches '$Selector'" }
    throw "'$Selector' matches $($hits.Count) open workbooks; pass the full path instead"
}

function Resolve-Sheet {
    param($Book, [string]$Name)
    if ([string]::IsNullOrEmpty($Name)) {
        throw '--sheet is required: this tool never falls back to the active sheet'
    }
    $sheet = $null
    try { $sheet = $Book.Worksheets.Item($Name) } catch { $sheet = $null }
    if ($null -eq $sheet) {
        $names = @()
        try {
            for ($i = 1; $i -le $Book.Worksheets.Count; $i++) {
                $names += [string]$Book.Worksheets.Item($i).Name
            }
        } catch { }
        throw "the workbook has no sheet named '$Name'; its sheets are: $($names -join ', ')"
    }
    return $sheet
}

function Resolve-Range {
    param($Sheet, [string]$Address)
    # A Range is enumerable, so returning it bare would hand the caller one
    # object per cell; the unary comma keeps it whole.
    if ([string]::IsNullOrEmpty($Address) -or $Address -eq 'used') {
        return ,$Sheet.UsedRange
    }
    $range = $null
    try { $range = $Sheet.Range($Address) } catch { $range = $null }
    if ($null -eq $range) {
        throw "not a valid A1 range on sheet '$($Sheet.Name)': '$Address'"
    }
    return ,$range
}

function Get-RangeFacts {
    param($Range)
    return [ordered]@{
        address = [string]$Range.Address()
        rows    = [int]$Range.Rows.Count
        columns = [int]$Range.Columns.Count
        cells   = [int]$Range.Count
    }
}

function Get-RawCell {
    param($Raw, [int]$Rows, [int]$Columns, [int]$Row, [int]$Column)
    if ($Rows -eq 1 -and $Columns -eq 1) { return $Raw }
    return $Raw[$Row, $Column]
}

function Read-Grid {
    param($Range, [int]$Rows, [int]$Columns, [bool]$AsFormula)
    $raw = $null
    if ($AsFormula) { $raw = $Range.Formula } else { $raw = $Range.Value2 }
    $grid = New-Object System.Collections.ArrayList
    $errors = New-Object System.Collections.ArrayList
    for ($r = 1; $r -le $Rows; $r++) {
        $line = New-Object System.Collections.ArrayList
        for ($c = 1; $c -le $Columns; $c++) {
            $value = Get-RawCell $raw $Rows $Columns $r $c
            if (-not $AsFormula -and $value -is [int]) {
                # A live value only ever arrives as Double, String, Boolean or null;
                # an integer is the marshalled CVErr variant behind #DIV/0! and friends.
                $text = ''
                $formula = ''
                $address = ''
                try {
                    $cell = $Range.Cells.Item($r, $c)
                    $text = [string]$cell.Text
                    $formula = [string]$cell.Formula
                    $address = [string]$cell.Address(0, 0)
                } catch { $text = '#ERROR' }
                [void]$errors.Add([ordered]@{ cell = $address; value = $text; formula = $formula })
                $value = $text
            }
            [void]$line.Add($value)
        }
        [void]$grid.Add(@($line))
    }
    return @{ grid = @($grid); errors = @($errors) }
}

function Read-TextGrid {
    param($Range, [int]$Rows, [int]$Columns)
    $grid = New-Object System.Collections.ArrayList
    for ($r = 1; $r -le $Rows; $r++) {
        $line = New-Object System.Collections.ArrayList
        for ($c = 1; $c -le $Columns; $c++) {
            $text = ''
            try { $text = [string]$Range.Cells.Item($r, $c).Text } catch { $text = '' }
            [void]$line.Add($text)
        }
        [void]$grid.Add(@($line))
    }
    return @($grid)
}

$script:Result = $null

function Invoke-Request {
    try {
        $requestJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__REQUEST_B64__'))
        $request = $requestJson | ConvertFrom-Json
        $script:Request = $request
        $operation = [string]$request.op
        $params = $request.params

        # ---- attach ----------------------------------------------------
        $attempts = New-Object System.Collections.ArrayList
        $app = $null
        $progid = $null
        $mechanism = ''
        $launched = $false
        foreach ($candidate in @('Excel.Application', 'Ket.Application')) {
            try {
                $app = [Runtime.InteropServices.Marshal]::GetActiveObject($candidate)
                $progid = $candidate
                $mechanism = 'GetActiveObject'
                break
            } catch {
                [void]$attempts.Add([ordered]@{ progid = $candidate; error = $_.Exception.Message })
                $app = $null
            }
        }
        if ($null -eq $app -and [bool]$request.launch_hidden) {
            foreach ($candidate in @('Ket.Application', 'Excel.Application')) {
                try {
                    $app = New-Object -ComObject $candidate
                    $progid = $candidate
                    $mechanism = 'New-Object -ComObject'
                    $launched = $true
                    break
                } catch {
                    [void]$attempts.Add([ordered]@{ progid = $candidate; error = "launch failed: $($_.Exception.Message)" })
                    $app = $null
                }
            }
            if ($null -ne $app) {
                try { $app.Visible = $false } catch { }
                try {
                    if ([int]$app.Workbooks.Count -eq 0) { [void]$app.Workbooks.Add() }
                } catch { }
            }
        }
        if ($null -eq $app) {
            $script:Result = [ordered]@{
                ok               = $false
                stage            = 'attach'
                error            = 'no running Excel or WPS Spreadsheets instance was found'
                attach_attempts  = @($attempts)
                remediation      = 'Open the workbook in Excel or WPS Spreadsheets and keep it open, then run the command again. Nothing was started: this tool never creates a hidden instance for normal work (--launch-hidden exists only for self-tests).'
            }
            return
        }

        $applicationPath = ''
        try { $applicationPath = [string]$app.Path } catch { $applicationPath = '' }
        $vendor = 'Microsoft Excel'
        if ($applicationPath -match '(?i)kingsoft|wps') { $vendor = 'WPS Spreadsheets' }
        $engine = [ordered]@{
            mechanism   = 'com'
            attach      = $mechanism
            progid      = $progid
            launched    = $launched
            powershell  = $PSVersionTable.PSVersion.ToString()
            app_name    = ''
            version     = ''
            vendor      = $vendor
            path        = $applicationPath
        }
        try { $engine['app_name'] = [string]$app.Name } catch { }
        try { $engine['version'] = [string]$app.Version } catch { }

        $alertsBefore = 1
        $screenBefore = $true
        try { $alertsBefore = [int]$app.DisplayAlerts } catch { }
        try { $screenBefore = [bool]$app.ScreenUpdating } catch { }

        if ($operation -eq 'diagnose') {
            $rotPresent = $false
            try { $rotPresent = [bool]([Runtime.InteropServices.Marshal].GetMethod('GetActiveObject')) } catch { }
            $books = New-Object System.Collections.ArrayList
            $sheets = New-Object System.Collections.ArrayList
            foreach ($book in @(Get-WorkbookList $app)) {
                [void]$books.Add((Get-BookInfo $book))
                for ($i = 1; $i -le $book.Sheets.Count; $i++) {
                    $sheet = $book.Sheets.Item($i)
                    $used = ''
                    try { $used = [string]$sheet.UsedRange.Address() } catch { }
                    [void]$sheets.Add([ordered]@{
                        workbook = [string]$book.Name
                        sheet    = [string]$sheet.Name
                        used_range = $used
                    })
                }
            }
            $script:Result = [ordered]@{
                ok              = $true
                op              = 'diagnose'
                engine          = $engine
                attach_attempts = @($attempts)
                get_active_object = $rotPresent
                workbooks       = @($books)
                sheets          = @($sheets)
                commands        = @('info', 'read_range', 'write_range', 'set_formula', 'style_range', 'add_chart', 'add_table', 'recalc', 'save', 'close')
                notes           = @(
                    'attach uses [Runtime.InteropServices.Marshal]::GetActiveObject in Windows PowerShell 5.1; PowerShell 7 removed that method',
                    'WPS Spreadsheets registers Excel.Application as an alias, so the application name is not proof of which product is running; vendor is inferred from Application.Path'
                )
            }
            return
        }

        $book = Resolve-Workbook $app ([string]$request.workbook)

        # ---- info ------------------------------------------------------
        if ($operation -eq 'info') {
            $warnings = New-Object System.Collections.ArrayList
            $activeName = ''
            try { $activeName = [string]$app.ActiveWorkbook.Name } catch { }
            $books = New-Object System.Collections.ArrayList
            foreach ($openBook in @(Get-WorkbookList $app)) {
                $entry = Get-BookInfo $openBook
                $entry['active'] = ($entry['name'] -eq $activeName)
                [void]$books.Add($entry)
            }
            $target = Get-BookInfo $book
            $details = New-Object System.Collections.ArrayList
            for ($i = 1; $i -le $book.Sheets.Count; $i++) {
                [void]$details.Add((Get-SheetInfo $book.Sheets.Item($i)))
            }
            $target['sheet_details'] = @($details)
            try {
                if ([bool]$book.ReadOnly) {
                    [void]$warnings.Add('the workbook is open read-only; a save will fail or ask for another path')
                }
            } catch { }
            $script:Result = [ordered]@{
                ok        = $true
                op        = 'info'
                engine    = $engine
                workbook  = $target
                workbooks = @($books)
                warnings  = @($warnings)
            }
            return
        }

        # ---- read_range ------------------------------------------------
        if ($operation -eq 'read_range') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $range = Resolve-Range $sheet ([string]$params.range)
            $facts = Get-RangeFacts $range
            if ($facts['cells'] -gt [int]$params.max_cells) {
                throw "range $($facts['address']) has $($facts['cells']) cells, over the limit of $($params.max_cells); narrow --range or raise --max-cells"
            }
            $read = Read-Grid $range $facts['rows'] $facts['columns'] $false
            $result = [ordered]@{
                ok        = $true
                op        = 'read_range'
                engine    = $engine
                workbook  = (Get-BookInfo $book)
                sheet     = [string]$sheet.Name
                range     = [string]$params.range
                address   = $facts['address']
                rows      = $facts['rows']
                columns   = $facts['columns']
                cells     = $facts['cells']
                values    = $read.grid
                errors    = $read.errors
                merged    = @()
            }
            try {
                if ([bool]$range.MergeCells) { $result['merged'] = @([string]$range.MergeArea.Address()) }
            } catch { }
            if ([bool]$params.formulas) {
                $formulas = Read-Grid $range $facts['rows'] $facts['columns'] $true
                $result['formulas'] = $formulas.grid
            }
            if ([bool]$params.display) {
                if ([int]$facts['cells'] -gt 500) {
                    throw '--display is limited to 500 cells per read; read a smaller range'
                }
                $result['display'] = Read-TextGrid $range $facts['rows'] $facts['columns']
            }
            $formulaCount = 0
            try {
                for ($r = 1; $r -le $facts['rows']; $r++) {
                    for ($c = 1; $c -le $facts['columns']; $c++) {
                        $text = [string]$range.Cells.Item($r, $c).Formula
                        if ($text.StartsWith('=')) { $formulaCount = $formulaCount + 1 }
                    }
                }
            } catch { $formulaCount = -1 }
            $result['formula_cells'] = $formulaCount
            $script:Result = $result
            return
        }

        # ---- write_range -----------------------------------------------
        if ($operation -eq 'write_range') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $range = Resolve-Range $sheet ([string]$params.range)
            $facts = Get-RangeFacts $range
            $warnings = New-Object System.Collections.ArrayList
            $cleared = [bool]$params.clear
            $written = 0
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                if ($cleared) {
                    $range.ClearContents()
                    $written = 0
                } else {
                    if ([int]$params.rows -ne $facts['rows'] -or [int]$params.cols -ne $facts['columns']) {
                        throw "the data block is $($params.rows)x$($params.cols) but $($facts['address']) is $($facts['rows']) rows by $($facts['columns']) columns"
                    }
                    $values = @($params.cells)
                    $grid = New-Object 'object[,]' $facts['rows'], $facts['columns']
                    $index = 0
                    for ($r = 0; $r -lt $facts['rows']; $r++) {
                        for ($c = 0; $c -lt $facts['columns']; $c++) {
                            $value = $values[$index]
                            $index = $index + 1
                            if ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) {
                                $grid[$r, $c] = [double]$value
                            } else {
                                $grid[$r, $c] = $value
                            }
                        }
                    }
                    $range.Value2 = $grid
                    $written = $facts['cells']
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            if (-not $cleared) {
                $stored = $range.Value2
                $index = 0
                $warned = 0
                foreach ($value in @($params.cells)) {
                    $row = [int][math]::Floor($index / $facts['columns'])
                    $column = $index % $facts['columns']
                    $index = $index + 1
                    if (-not ($value -is [string]) -or $warned -ge 10) { continue }
                    $after = Get-RawCell $stored $facts['rows'] $facts['columns'] ($row + 1) ($column + 1)
                    $address = ''
                    try { $address = [string]$range.Cells.Item($row + 1, $column + 1).Address(0, 0) } catch { $address = '' }
                    if ($value.StartsWith('=')) {
                        [void]$warnings.Add("$address starts with '=' so it was stored as a formula, not as text: $value")
                        $warned = $warned + 1
                        continue
                    }
                    if ($null -ne $after -and -not ($after -is [string])) {
                        [void]$warnings.Add("$address was sent as text '$value' but the application stored $after; set a number format or send a serial for dates")
                        $warned = $warned + 1
                    }
                }
            }
            $script:Result = [ordered]@{
                ok        = $true
                op        = 'write_range'
                engine    = $engine
                workbook  = (Get-BookInfo $book)
                sheet     = [string]$sheet.Name
                range     = [string]$params.range
                address   = $facts['address']
                rows      = $facts['rows']
                columns   = $facts['columns']
                cells     = $facts['cells']
                action    = 'cleared'
                written   = $written
                warnings  = @($warnings)
            }
            if (-not $cleared) { $script:Result['action'] = 'wrote' }
            return
        }

        # ---- set_formula -----------------------------------------------
        if ($operation -eq 'set_formula') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $writtenFormulas = New-Object System.Collections.ArrayList
            $rangeText = ''
            $cellCount = 0
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                if ($null -ne $params.cells) {
                    $properties = $params.cells.PSObject.Properties
                    foreach ($property in $properties) {
                        $address = [string]$property.Name
                        $formulaText = [string]$property.Value
                        if (-not $formulaText.StartsWith('=')) {
                            throw "formula for $address must start with '=': $formulaText"
                        }
                        $target = Resolve-Range $sheet $address
                        if ([bool]$params.r1c1) { $target.FormulaR1C1 = $formulaText }
                        else { $target.Formula = $formulaText }
                        $back = ''
                        try { $back = [string]$target.Formula } catch { $back = '' }
                        [void]$writtenFormulas.Add([ordered]@{
                            cell     = [string]$target.Address(0, 0)
                            formula  = $formulaText
                            stored   = $back
                        })
                    }
                    $cellCount = $writtenFormulas.Count
                    $rangeText = "single cells"
                } else {
                    $range = Resolve-Range $sheet ([string]$params.range)
                    if (-not ([string]$params.formula).StartsWith('=')) {
                        throw "formula must start with '=': $($params.formula)"
                    }
                    if ([bool]$params.r1c1) { $range.FormulaR1C1 = [string]$params.formula }
                    else { $range.Formula = [string]$params.formula }
                    $cellCount = [int]$range.Count
                    $rangeText = [string]$range.Address()
                    $sample = $range.Cells.Item(1, 1)
                    [void]$writtenFormulas.Add([ordered]@{
                        cell     = [string]$sample.Address(0, 0)
                        formula  = [string]$params.formula
                        stored   = [string]$sample.Formula
                    })
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $warnings = New-Object System.Collections.ArrayList
            $calculation = $null
            try { $calculation = [int]$app.Calculation } catch { $calculation = $null }
            if ($calculation -eq -4135) {
                [void]$warnings.Add('the workbook is in manual calculation mode; run recalc before reading these numbers')
            }
            $script:Result = [ordered]@{
                ok          = $true
                op          = 'set_formula'
                engine      = $engine
                workbook    = (Get-BookInfo $book)
                sheet       = [string]$sheet.Name
                range       = $rangeText
                cells       = $cellCount
                formulas    = @($writtenFormulas)
                calculation = $calculation
                warnings    = @($warnings)
            }
            return
        }

        # ---- style_range -----------------------------------------------
        if ($operation -eq 'style_range') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $range = Resolve-Range $sheet ([string]$params.range)
            $facts = Get-RangeFacts $range
            $style = $params.style
            $applied = New-Object System.Collections.ArrayList
            $colors = [ordered]@{}
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                if ($null -ne $style.font_name) { $range.Font.Name = [string]$style.font_name; [void]$applied.Add('font_name') }
                if ($null -ne $style.font_size) { $range.Font.Size = [double]$style.font_size; [void]$applied.Add('font_size') }
                if ($null -ne $style.bold) { $range.Font.Bold = [bool]$style.bold; [void]$applied.Add('bold') }
                if ($null -ne $style.italic) { $range.Font.Italic = [bool]$style.italic; [void]$applied.Add('italic') }
                if ($null -ne $style.color) {
                    $ole = Get-OleColor ([string]$style.color)
                    $range.Font.Color = $ole
                    $colors['font_bgr'] = $ole
                    $colors['font_hex'] = [string]$style.color
                    [void]$applied.Add('color')
                }
                if ($null -ne $style.fill) {
                    $ole = Get-OleColor ([string]$style.fill)
                    $range.Interior.Color = $ole
                    $range.Interior.Pattern = 1
                    $colors['fill_bgr'] = $ole
                    $colors['fill_hex'] = [string]$style.fill
                    [void]$applied.Add('fill')
                }
                if ($null -ne $style.number_format) {
                    $range.NumberFormat = [string]$style.number_format
                    [void]$applied.Add('number_format')
                }
                if ($null -ne $style.h_align) {
                    $map = @{ left = -4131; center = -4108; right = -4152; general = 1; justify = -4130 }
                    $range.HorizontalAlignment = $map[[string]$style.h_align]
                    [void]$applied.Add('h_align')
                }
                if ($null -ne $style.v_align) {
                    $map = @{ top = -4160; center = -4108; bottom = -4104 }
                    $range.VerticalAlignment = $map[[string]$style.v_align]
                    [void]$applied.Add('v_align')
                }
                if ($null -ne $style.wrap) { $range.WrapText = [bool]$style.wrap; [void]$applied.Add('wrap') }
                if ($null -ne $style.indent) { $range.IndentLevel = [int]$style.indent; [void]$applied.Add('indent') }
                if ($null -ne $style.border) {
                    $border = [string]$style.border
                    if ($border -eq 'outline') {
                        $range.BorderAround(1, 2)
                    } elseif ($border -eq 'all') {
                        $range.Borders.LineStyle = 1
                    } else {
                        $range.Borders.LineStyle = -4142
                    }
                    [void]$applied.Add('border')
                }
                if ($null -ne $style.column_width) {
                    $width = [double]$style.column_width
                    if ($width -lt 0.5) { $width = 0.5 }
                    if ($width -gt 60) { $width = 60 }
                    $range.EntireColumn.ColumnWidth = $width
                    [void]$applied.Add('column_width')
                }
                if ([bool]$params.merge) {
                    $range.Merge()
                    [void]$applied.Add('merge')
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $numberFormat = ''
            try { $numberFormat = [string]$range.NumberFormat } catch { }
            $mergeArea = ''
            try { if ([bool]$range.MergeCells) { $mergeArea = [string]$range.MergeArea.Address() } } catch { }
            $script:Result = [ordered]@{
                ok            = $true
                op            = 'style_range'
                engine        = $engine
                workbook      = (Get-BookInfo $book)
                sheet         = [string]$sheet.Name
                range         = [string]$params.range
                address       = $facts['address']
                cells         = $facts['cells']
                applied       = @($applied)
                colors        = $colors
                number_format = $numberFormat
                merged        = $mergeArea
            }
            return
        }

        # ---- add_chart -------------------------------------------------
        if ($operation -eq 'add_chart') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $dataSheet = $sheet
            $dataAddress = [string]$params.data
            if ($dataAddress.Contains('!')) {
                $split = $dataAddress.Split('!')
                $dataSheet = Resolve-Sheet $book $split[0].Trim("'")
                $dataAddress = $split[1]
            }
            $source = Resolve-Range $dataSheet $dataAddress
            $anchor = Resolve-Range $sheet ([string]$params.anchor)
            $warnings = New-Object System.Collections.ArrayList
            $blank = $true
            $sourceCells = [int]$source.Count
            if ($sourceCells -le 5000) {
                try {
                    $raw = $source.Value2
                    for ($r = 1; $r -le [int]$source.Rows.Count; $r++) {
                        for ($c = 1; $c -le [int]$source.Columns.Count; $c++) {
                            $value = Get-RawCell $raw ([int]$source.Rows.Count) ([int]$source.Columns.Count) $r $c
                            if ($null -ne $value) { $blank = $false; break }
                        }
                        if (-not $blank) { break }
                    }
                } catch { $blank = $false }
            } else {
                $blank = $false
            }
            if ($blank) {
                [void]$warnings.Add('every source cell is empty; the chart will render blank until the range holds data')
            }
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                $chartObject = $sheet.ChartObjects().Add(
                    [double]$anchor.Left,
                    [double]$anchor.Top,
                    [double]$params.width,
                    [double]$params.height
                )
                $chart = $chartObject.Chart
                $chart.SetSourceData($source)
                $chart.ChartType = [int]$params.chart_type
                if ([string]::IsNullOrEmpty([string]$params.title)) {
                    $chart.HasTitle = $false
                } else {
                    $chart.HasTitle = $true
                    $chart.ChartTitle.Text = [string]$params.title
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $series = 0
            try { $series = [int]$chart.SeriesCollection().Count } catch { $series = 0 }
            $script:Result = [ordered]@{
                ok            = $true
                op            = 'add_chart'
                engine        = $engine
                workbook      = (Get-BookInfo $book)
                sheet         = [string]$sheet.Name
                chart         = [string]$chartObject.Name
                type          = [string]$params.type
                chart_type    = [int]$params.chart_type
                anchor        = [string]$anchor.Address()
                source        = "$([string]$dataSheet.Name)!$([string]$source.Address())"
                source_cells  = $sourceCells
                series        = $series
                title         = [string]$params.title
                warnings      = @($warnings)
            }
            return
        }

        # ---- add_table -------------------------------------------------
        if ($operation -eq 'add_table') {
            $sheet = Resolve-Sheet $book ([string]$params.sheet)
            $range = Resolve-Range $sheet ([string]$params.range)
            $conflict = ''
            try {
                for ($i = 1; $i -le $sheet.ListObjects.Count; $i++) {
                    $existing = $sheet.ListObjects.Item($i)
                    $overlap = $app.Intersect($range, $existing.Range)
                    if ($null -ne $overlap) { $conflict = [string]$existing.Name; break }
                }
            } catch { $conflict = '' }
            if ($conflict -ne '') {
                throw "range $([string]$range.Address()) overlaps the existing table '$conflict'; extend that table instead of adding a second one"
            }
            $hasHeaders = 1
            if ([bool]$params.no_headers) { $hasHeaders = 0 }
            $styleWarning = ''
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                $table = $sheet.ListObjects.Add(1, $range, [Type]::Missing, $hasHeaders)
                if (-not [string]::IsNullOrEmpty([string]$params.name)) { $table.Name = [string]$params.name }
                if (-not [string]::IsNullOrEmpty([string]$params.style)) {
                    try { $table.TableStyle = [string]$params.style }
                    catch { $styleWarning = "the table was created but the style '$($params.style)' was refused" }
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $bodyRows = 0
            try { $bodyRows = [int]$table.DataBodyRange.Rows.Count } catch { $bodyRows = 0 }
            $tableRange = $range
            try { $tableRange = $table.Range } catch { $tableRange = $range }
            $warnings = New-Object System.Collections.ArrayList
            if (-not [string]::IsNullOrEmpty($styleWarning)) { [void]$warnings.Add($styleWarning) }
            if ($hasHeaders -eq 0) {
                [void]$warnings.Add('with no headers the application generated a header row above the data, so the values moved down one row and the table starts at the header')
            }
            $script:Result = [ordered]@{
                ok              = $true
                op              = 'add_table'
                engine          = $engine
                workbook        = (Get-BookInfo $book)
                sheet           = [string]$sheet.Name
                table           = [string]$table.Name
                requested_range = [string]$params.range
                range           = [string]$tableRange.Address()
                cells           = [int]$tableRange.Count
                rows            = [int]$tableRange.Rows.Count
                columns         = [int]$tableRange.Columns.Count
                body_rows       = $bodyRows
                has_headers     = ($hasHeaders -eq 1)
                style           = [string]$params.style
                warnings        = @($warnings)
            }
            return
        }

        # ---- recalc ----------------------------------------------------
        if ($operation -eq 'recalc') {
            $calculating = $null
            try { $calculating = [int]$app.Calculation } catch { $calculating = $null }
            $iteration = $false
            try { $iteration = [bool]$app.Iteration } catch { $iteration = $false }
            try {
                $app.ScreenUpdating = $false
                $app.CalculateFull()
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
            }
            $schema = New-Object System.Collections.ArrayList
            for ($i = 1; $i -le $book.Sheets.Count; $i++) { [void]$schema.Add([string]$book.Sheets.Item($i).Name) }
            $script:Result = [ordered]@{
                ok          = $true
                op          = 'recalc'
                engine      = $engine
                workbook    = (Get-BookInfo $book)
                calculated  = $true
                sheets      = @($schema)
                calculation = $calculating
                iteration   = $iteration
            }
            return
        }

        # ---- save ------------------------------------------------------
        if ($operation -eq 'save') {
            $target = [string]$params.path
            $info = Get-BookInfo $book
            $action = 'saved'
            if ($target -eq '' -and $null -eq $info['path']) {
                throw 'the workbook has never been saved; pass --path to choose where the file goes'
            }
            try {
                $app.DisplayAlerts = 0
                $app.ScreenUpdating = $false
                if ($target -eq '') {
                    $book.Save()
                } else {
                    $format = Get-SaveFormat $target
                    $book.SaveAs($target, $format)
                    $action = 'save_as'
                }
            } finally {
                try { $app.ScreenUpdating = $screenBefore } catch { }
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $after = Get-BookInfo $book
            $savedPath = [string]$after['path']
            $exists = $false
            $size = 0
            if ($savedPath -ne '') {
                $exists = Test-Path -LiteralPath $savedPath
                if ($exists) { $size = (Get-Item -LiteralPath $savedPath).Length }
            }
            $overwrote = $false
            if ($action -eq 'saved' -and $null -ne $info['path']) { $overwrote = $true }
            if ($action -eq 'save_as' -and [bool]$params.path_existed) { $overwrote = $true }
            $script:Result = [ordered]@{
                ok             = $true
                op             = 'save'
                engine         = $engine
                workbook       = $after
                action         = $action
                path           = $savedPath
                file_exists    = $exists
                size_bytes     = $size
                overwrote      = $overwrote
                original_path  = $info['path']
            }
            return
        }

        # ---- close -----------------------------------------------------
        if ($operation -eq 'close') {
            $info = Get-BookInfo $book
            $others = @()
            foreach ($openBook in @(Get-WorkbookList $app)) {
                if ([string]$openBook.Name -ne [string]$info['name']) { $others += [string]$openBook.Name }
            }
            $saveChanges = 0
            if ([bool]$params.save) {
                if ($null -eq $info['path']) {
                    throw 'the workbook has never been saved, so close cannot save it; save it with --path first, or close with --discard'
                }
                try {
                    $app.DisplayAlerts = 0
                    $book.Save()
                } finally {
                    try { $app.DisplayAlerts = $alertsBefore } catch { }
                }
            } elseif (-not [bool]$params.discard) {
                if ($info['saved'] -ne $true -or $null -eq $info['path']) {
                    throw 'the workbook has unsaved changes; pass --save to keep them or --discard to throw them away'
                }
            }
            if ([bool]$params.quit_app -and $others.Count -gt 0) {
                throw "--quit-app would close these other workbooks too: $($others -join ', '); close them yourself and close without --quit-app"
            }
            try {
                $app.DisplayAlerts = 0
                $book.Close($saveChanges)
                if ([bool]$params.quit_app) { $app.Quit() }
            } finally {
                try { $app.DisplayAlerts = $alertsBefore } catch { }
            }
            $script:Result = [ordered]@{
                ok            = $true
                op            = 'close'
                engine        = $engine
                workbook      = $info
                saved         = [bool]$params.save
                discarded     = (-not [bool]$params.save)
                quit_app      = [bool]$params.quit_app
                other_workbooks = @($others)
            }
            return
        }

        throw "unknown operation '$operation'"
    } catch {
        $script:Result = [ordered]@{
            ok    = $false
            stage = 'com'
            error = $_.Exception.Message
        }
    }
}

# The body relays to Out-Null: property assignments emit their value, and the
# only thing allowed on stdout is the JSON written below.
Invoke-Request | Out-Null

if ($null -eq $script:Result) {
    $script:Result = [ordered]@{ ok = $false; stage = 'powershell'; error = 'the script produced no result' }
}
[Console]::Out.Write(($script:Result | ConvertTo-Json -Depth 12 -Compress))
exit 0
"""


if __name__ == "__main__":
    sys.exit(main())
