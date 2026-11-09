"""Decide whether every native chart carries a title the author meant to ship.

Purpose: a chart with the literal "Chart Title" placeholder is an unfinished
chart. PowerPoint will happily render it, so no render check catches it. This
reads the chart parts and classifies each title, then fails only on the two
states that mean "nobody decided here": a default placeholder and an empty
title element.

Statuses: absent, present, default_placeholder, linked_title_unresolved,
explicitly_suppressed, empty_title.

Exit codes: 0 pass, 1 fail, 2 unreadable input.
"""

from __future__ import annotations

import json
import sys
import zipfile
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
A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

DEFAULT_TITLE_STRINGS = ("chart title", "chart 1 title")
BLOCKING = {"default_placeholder", "empty_title"}


def _chart_title_status(chart_xml: bytes) -> tuple[str, str]:
    root = ElementTree.fromstring(chart_xml)
    chart = root.find(f"{C_NS}chart")
    if chart is None:
        return "absent", ""
    deleted = chart.find(f"{C_NS}autoTitleDeleted")
    suppressed = deleted is not None and deleted.get("val", "1") in {"1", "true"}
    title = chart.find(f"{C_NS}title")
    if title is None:
        return ("explicitly_suppressed", "") if suppressed else ("absent", "")

    if title.find(f"{C_NS}tx/{C_NS}strRef") is not None:
        return "linked_title_unresolved", ""
    rich = title.find(f"{C_NS}tx/{C_NS}rich")
    if rich is None:
        return "empty_title", ""
    pieces = [node.text or "" for node in rich.iter(f"{A_NS}t")]
    text = "".join(pieces).strip()
    if not text:
        return "empty_title", ""
    if " ".join(text.split()).lower() in DEFAULT_TITLE_STRINGS:
        return "default_placeholder", text
    return "present", text


def inspect_chart_titles(pptx_path: str | Path) -> dict:
    path = Path(pptx_path)
    if not path.is_file():
        return {"gate": "native-chart-title", "passed": False, "findings": [{"kind": "missing_file", "detail": str(path)}]}

    from pptx import Presentation

    presentation = Presentation(str(path))
    slides: list[dict] = []
    checks: list[dict] = []
    chart_parts: dict[str, bytes] = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.startswith("ppt/charts/") and name.endswith(".xml"):
                chart_parts[name] = archive.read(name)

    for slide_no, slide in enumerate(presentation.slides, start=1):
        chart_count = 0
        for shape in slide.shapes:
            if not getattr(shape, "has_chart", False):
                continue
            chart_count += 1
            part = shape.chart.part
            part_name = str(part.partname).lstrip("/")
            payload = chart_parts.get(part_name)
            if payload is None:
                checks.append({"slide": slide_no, "chart": shape.name, "part": part_name, "status": "part_missing", "title": ""})
                continue
            status, text = _chart_title_status(payload)
            checks.append({"slide": slide_no, "chart": shape.name, "part": part_name, "status": status, "title": text})
        slides.append({"slide": slide_no, "charts": chart_count})

    unused = sorted(set(chart_parts) - {check["part"] for check in checks})
    findings = [
        {
            "kind": "chart_title",
            "severity": "fail",
            "slide": check["slide"],
            "chart": check["chart"],
            "status": check["status"],
            "message": (
                "chart still shows the placeholder title"
                if check["status"] == "default_placeholder"
                else "chart has an empty title element"
            ),
        }
        for check in checks
        if check["status"] in BLOCKING
    ]
    for part in unused:
        findings.append({"kind": "orphan_chart_part", "severity": "review", "part": part, "message": "chart part is not placed on any slide"})

    return {
        "gate": "native-chart-title",
        "presentation": str(path.resolve()),
        "slide_count": len(slides),
        "native_chart_count": sum(item["charts"] for item in slides),
        "checks": checks,
        "findings": findings,
        "native_powerpoint_verified": False,
        "source_text_emitted": False,
        "passed": not [item for item in findings if item["severity"] == "fail"],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Fail when a native chart keeps a placeholder or empty title.")
    parser.add_argument("presentation", nargs="?", help="path to the .pptx")
    parser.add_argument("--input", dest="input_path", help="path to the .pptx (same as the positional)")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    path = args.input_path or args.presentation
    if not path:
        parser.error("a .pptx path is required (positional or --input)")

    report = inspect_chart_titles(path)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
