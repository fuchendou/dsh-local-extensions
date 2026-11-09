"""Check that a table's declared totals actually add up.

Purpose: a total row that does not match its column is the fastest way to lose
a room. The rule that keeps this gate honest: it only enforces totals the
author explicitly declares. Auto-discovered rows are reported as diagnostics,
never failed, because "Total" can legitimately mean something else.

Arithmetic is done with Decimal so 0.1 + 0.2 style inputs compare as written,
and the tolerance comes from how many decimals the table displays.

Contract file (`--contracts`):
  {"contracts": [{"slide": 4, "table": 1, "total_row": 5, "columns": [1, 2], "tolerance": "0.01"}]}
`table` is 1-based among tables on that slide; `total_row` is 0-based by default,
switch to 1-based with `"row_base": 1` on the contract or `--row-base`.

Exit codes: 0 pass, 1 fail, 2 unreadable input or bad contract.
"""

from __future__ import annotations

import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

TOTAL_PATTERN = re.compile(r"\btotal\b", re.IGNORECASE)
SUBTOTAL_PATTERN = re.compile(r"\bsub[\s-]?total\b", re.IGNORECASE)
NON_ADDITIVE = re.compile(r"(unit\s*price|per\s*share|ratio|rate|%|percent|margin|average|avg|median)", re.IGNORECASE)
NUMBER = re.compile(r"^[+-]?[0-9][0-9,]*(\.[0-9]+)?$")


def _to_decimal(text: str) -> Decimal | None:
    cleaned = text.strip().replace(",", "").replace("\u2212", "-")
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    cleaned = cleaned.replace("$", "").replace("\u20ac", "").replace("\u00a3", "").replace("%", "").strip()
    if not NUMBER.match(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _decimals(text: str) -> int:
    cleaned = text.strip().replace(",", "")
    return len(cleaned.split(".")[1]) if "." in cleaned else 0


def _tables(slide) -> list:
    return [shape for shape in slide.shapes if getattr(shape, "has_table", False)]


def check(presentation_path: str | Path, contracts: list[dict], row_base: int = 0) -> dict:
    path = Path(presentation_path)
    if not path.is_file():
        return {"gate": "table-arithmetic", "passed": False, "findings": [{"kind": "missing_file", "detail": str(path)}]}

    from pptx import Presentation

    presentation = Presentation(str(path))
    slides = list(presentation.slides)
    findings: list[dict] = []
    checks: list[dict] = []
    declared: set[tuple[int, int]] = set()

    for contract in contracts:
        slide_no = int(contract["slide"])
        table_index = int(contract.get("table", 1)) - 1
        base = int(contract.get("row_base", row_base))
        if not 1 <= slide_no <= len(slides):
            findings.append({"kind": "bad_contract", "severity": "fail", "message": f"slide {slide_no} is out of range"})
            continue
        tables = _tables(slides[slide_no - 1])
        if not 1 <= table_index + 1 <= len(tables):
            findings.append({"kind": "bad_contract", "severity": "fail", "slide": slide_no, "message": f"table {table_index + 1} not found"})
            continue
        table = tables[table_index].table
        declared.add((slide_no, table_index))
        total_row = int(contract["total_row"]) - 1 if base == 1 else int(contract["total_row"])
        rows = list(table.rows)
        if not 0 <= total_row < len(rows):
            findings.append({"kind": "bad_contract", "severity": "fail", "slide": slide_no, "message": f"total row {total_row} is out of range"})
            continue
        tolerance = Decimal(str(contract.get("tolerance", "0.01")))
        columns = [int(item) for item in contract.get("columns", range(1, len(table.columns)))]
        header = [cell.text for cell in rows[0].cells] if rows else []

        for column in columns:
            if not 0 <= column < len(table.columns):
                findings.append({"kind": "bad_contract", "severity": "fail", "slide": slide_no, "message": f"column {column} is out of range"})
                continue
            header_text = header[column] if column < len(header) else ""
            if NON_ADDITIVE.search(header_text):
                checks.append({"slide": slide_no, "column": column, "header": header_text, "status": "skipped_non_additive"})
                continue
            displayed_text = rows[total_row].cells[column].text
            displayed = _to_decimal(displayed_text)
            if displayed is None:
                findings.append(
                    {
                        "kind": "unparseable_total",
                        "severity": "fail",
                        "slide": slide_no,
                        "column": column,
                        "header": header_text,
                        "displayed": displayed_text,
                        "message": "the declared total cell is not a number this gate can read",
                    }
                )
                continue
            addends: list[Decimal] = []
            for row in rows[1:total_row]:
                value = _to_decimal(row.cells[column].text)
                if value is not None:
                    addends.append(value)
            computed = sum(addends, Decimal(0))
            unit = Decimal(1).scaleb(-max([_decimals(displayed_text)] + [_decimals(rows[index].cells[column].text) for index in range(1, total_row)] or [0]))
            delta = abs(computed - displayed)
            rounding_slack = max(tolerance, unit / 2)
            passed = delta <= rounding_slack
            checks.append(
                {
                    "slide": slide_no,
                    "column": column,
                    "header": header_text,
                    "status": "pass" if passed else "mismatch",
                    "displayed": str(displayed),
                    "computed": str(computed),
                    "delta": str(delta),
                    "rounding_slack": str(rounding_slack),
                    "addends": [str(item) for item in addends],
                }
            )
            if not passed:
                findings.append(
                    {
                        "kind": "total_mismatch",
                        "severity": "fail",
                        "slide": slide_no,
                        "column": column,
                        "header": header_text,
                        "displayed": str(displayed),
                        "computed": str(computed),
                        "message": f"column '{header_text or column}' totals {computed} but displays {displayed}",
                    }
                )

    # diagnostics only: never fail on a row we were not told to enforce
    for slide_no, slide in enumerate(slides, start=1):
        for table_index, shape in enumerate(_tables(slide)):
            if (slide_no, table_index) in declared:
                continue
            rows = list(shape.table.rows)
            for row_index, row in enumerate(rows):
                first = row.cells[0].text.strip()
                if TOTAL_PATTERN.search(first) or SUBTOTAL_PATTERN.search(first):
                    findings.append(
                        {
                            "kind": "auto_detected_total",
                            "severity": "diagnostic",
                            "slide": slide_no,
                            "row": row_index,
                            "label": first,
                            "message": "total-looking row is not declared in a contract, so it was not enforced",
                        }
                    )

    return {
        "gate": "table-arithmetic",
        "presentation": str(path.resolve()),
        "contracts": len(contracts),
        "checks": checks,
        "findings": findings,
        "passed": not [item for item in findings if item["severity"] == "fail"],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Verify declared table totals against their columns.")
    parser.add_argument("presentation", nargs="?", help="path to the .pptx")
    parser.add_argument("--input", dest="input_path", help="path to the .pptx (same as the positional)")
    parser.add_argument("--contracts", required=True, help="JSON file listing the totals to enforce")
    parser.add_argument("--row-base", type=int, choices=(0, 1), default=0, help="0-based row indices (default) or 1-based")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    path = args.input_path or args.presentation
    if not path:
        parser.error("a .pptx path is required (positional or --input)")

    try:
        payload = json.loads(Path(args.contracts).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - any parse problem is the caller's contract
        json.dump({"gate": "table-arithmetic", "passed": False, "error": {"code": "bad_contracts", "message": str(exc)}}, sys.stdout)
        sys.stdout.write("\n")
        return 2
    contracts = payload.get("contracts", payload if isinstance(payload, list) else [])
    report = check(path, contracts, args.row_base)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
