"""Check that a quantitative chart is backed by real data, not just shapes.

Purpose: a chart can look right and carry nothing editable — an empty cache, a
series with no categories, points that exist as a count but not as values. This
gate only governs slides the caller declares as quantitative (`--slide`), so a
decorative series is not nagged.

Two modes, ported from the original behaviour:
  portable   (default) a durable embedded workbook must ship with the chart
  powerpoint also accept a complete native literal cache (`c:numCache` with a
             point count that matches the category count)

Exit codes: 0 pass, 1 fail, 2 unreadable input.
"""

from __future__ import annotations

import json
import sys
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))

C_NS = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
R_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _embedded_workbooks(archive: zipfile.ZipFile, chart_part: str) -> list[str]:
    folder, _, name = chart_part.rpartition("/")
    rels = f"{folder}/_rels/{name}.rels"
    if rels not in archive.namelist():
        return []
    try:
        root = ElementTree.fromstring(archive.read(rels))
    except ElementTree.ParseError:
        return []
    found: list[str] = []
    for relationship in root.findall(f"{R_NS}Relationship"):
        target = relationship.get("Target", "")
        if target.endswith(".xlsx") or target.endswith(".xlsb"):
            resolved = target.lstrip("/") if target.startswith("/") else f"{folder}/{target}"
            parts: list[str] = []
            for segment in resolved.split("/"):
                if segment in {"", "."}:
                    continue
                if segment == "..":
                    if parts:
                        parts.pop()
                    continue
                parts.append(segment)
            found.append("/".join(parts))
    return found


def _series_report(chart_xml: bytes) -> list[dict]:
    root = ElementTree.fromstring(chart_xml)
    report: list[dict] = []
    for series in root.iter(f"{C_NS}ser"):
        name_node = series.find(f"{C_NS}tx/{C_NS}strRef/{C_NS}strCache/{C_NS}pt/{C_NS}v")
        if name_node is None:
            name_node = series.find(f"{C_NS}tx/{C_NS}v")
        categories = [node.text for node in series.findall(f"{C_NS}cat//{C_NS}pt/{C_NS}v")]
        points = [node.text for node in series.findall(f"{C_NS}val//{C_NS}pt/{C_NS}v")]
        if not points:
            # some producers store values as c:v children of c:numCache without pt wrappers
            points = [node.text for node in series.findall(f"{C_NS}val//{C_NS}v")]
        numeric = 0
        for value in points:
            if value is None:
                continue
            try:
                Decimal(str(value))
                numeric += 1
            except InvalidOperation:
                continue
        report.append(
            {
                "name": (name_node.text if name_node is not None else "") or "",
                "categories": len(categories),
                "points": len(points),
                "numeric_points": numeric,
            }
        )
    return report


def inspect_charts(pptx_path: str | Path, declared_slides: list[int], mode: str = "portable") -> dict:
    path = Path(pptx_path)
    if not path.is_file():
        return {"gate": "native-quantitative-chart", "passed": False, "findings": [{"kind": "missing_file", "detail": str(path)}]}

    from pptx import Presentation

    presentation = Presentation(str(path))
    checks: list[dict] = []
    findings: list[dict] = []
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for slide_no, slide in enumerate(presentation.slides, start=1):
            if slide_no not in declared_slides:
                continue
            for shape in slide.shapes:
                if not getattr(shape, "has_chart", False):
                    continue
                chart_part = str(shape.chart.part.partname).lstrip("/")
                if chart_part not in names:
                    findings.append({"kind": "chart_part_missing", "severity": "fail", "slide": slide_no, "part": chart_part})
                    continue
                payload = archive.read(chart_part)
                workbooks = [item for item in _embedded_workbooks(archive, chart_part) if item in names]
                series = _series_report(payload)
                problems: list[str] = []
                if not series:
                    problems.append("the chart declares no series")
                for entry in series:
                    if entry["categories"] == 0:
                        problems.append(f"series '{entry['name'] or '(unnamed)'}' has no categories")
                    if entry["points"] == 0:
                        problems.append(f"series '{entry['name'] or '(unnamed)'}' has no values")
                    elif entry["numeric_points"] != entry["points"]:
                        problems.append(
                            f"series '{entry['name'] or '(unnamed)'}' has {entry['points'] - entry['numeric_points']} non-numeric value(s)"
                        )
                    elif entry["categories"] and entry["points"] and entry["categories"] != entry["points"]:
                        problems.append(
                            f"series '{entry['name'] or '(unnamed)'}' has {entry['categories']} categories but {entry['points']} values"
                        )
                has_cache = bool(series) and all(entry["points"] > 0 for entry in series)
                if mode == "portable" and not workbooks:
                    problems.append("no embedded workbook: the chart would not be editable after export")
                if mode == "powerpoint" and not has_cache and not workbooks:
                    problems.append("neither an embedded workbook nor a complete literal cache")
                checks.append(
                    {
                        "slide": slide_no,
                        "chart": shape.name,
                        "part": chart_part,
                        "mode": mode,
                        "embedded_workbooks": workbooks,
                        "series": series,
                        "problems": problems,
                    }
                )
                for problem in problems:
                    findings.append(
                        {
                            "kind": "quantitative_chart",
                            "severity": "fail",
                            "slide": slide_no,
                            "chart": shape.name,
                            "message": problem,
                        }
                    )

    return {
        "gate": "native-quantitative-chart",
        "presentation": str(path.resolve()),
        "mode": mode,
        "declared_slides": declared_slides,
        "checks": checks,
        "findings": findings,
        "passed": not [item for item in findings if item["severity"] == "fail"],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Require real, editable data behind charts on declared slides.")
    parser.add_argument("presentation", nargs="?", help="path to the .pptx")
    parser.add_argument("--input", dest="input_path", help="path to the .pptx (same as the positional)")
    parser.add_argument("--slide", type=int, action="append", default=[], help="1-based slide to govern (repeatable)")
    parser.add_argument("--all-slides", action="store_true", help="govern every slide that holds a chart")
    parser.add_argument("--mode", choices=("portable", "powerpoint"), default="portable", help="acceptance mode (default portable)")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    path = args.input_path or args.presentation
    if not path:
        parser.error("a .pptx path is required (positional or --input)")

    declared = list(args.slide)
    if args.all_slides or not declared:
        from pptx import Presentation

        presentation = Presentation(path)
        declared = [index for index, slide in enumerate(presentation.slides, start=1) if any(getattr(shape, "has_chart", False) for shape in slide.shapes)]
    report = inspect_charts(path, declared, args.mode)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
