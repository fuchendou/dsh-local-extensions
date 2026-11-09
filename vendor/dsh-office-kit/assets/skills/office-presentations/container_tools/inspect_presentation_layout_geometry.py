"""Inspect slide geometry for the mistakes a render catches late.

Purpose: before spending a round trip on a render, read the shapes and answer
the questions that actually break a deck — does anything leave the slide, is
text dropped out of its own box, do two blocks of text sit on top of each
other, is a chart buried under a table, is the smallest type too small, is an
opens-in-place placeholder still empty, does a heading end in a full stop.

Severity split (ported behaviour): `fail` findings are structural and block
delivery; `review` findings are judgement calls the author should look at.

Exit codes: 0 no blocking finding, 1 blocking finding, 2 unreadable input.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ooxml_helpers import (  # noqa: E402
    box,
    emit,
    default_size_pt,
    estimated_text_height_in,
    finding,
    has_visible_text,
    is_chart,
    is_connector,
    is_picture,
    is_table,
    iter_shapes,
    label,
    open_presentation,
    overlap_ratio,
    placeholder_kind,
    rects_intersect,
    run_size_pt,
    slide_size_in,
    text_of,
)

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

TITLE_OUTSIDE_MARGIN_IN = 0.0
DEFAULT_TITLE_FLOOR_PT = 28.0
DEFAULT_BODY_FLOOR_PT = 14.0
OVERLAP_HINT_RATIO = 0.35
TEXT_OVERFLOW_SLACK_IN = 0.08


def inspect(pptx_path: str | Path, title_floor: float = DEFAULT_TITLE_FLOOR_PT, body_floor: float = DEFAULT_BODY_FLOOR_PT) -> dict:
    presentation = open_presentation(pptx_path)
    slide_w, slide_h = slide_size_in(presentation)
    findings: list[dict] = []
    slides_report: list[dict] = []
    title_sizes: list[tuple[int, int]] = []

    for slide_no, slide in enumerate(presentation.slides, start=1):
        shapes = [shape for shape in iter_shapes(slide.shapes)]
        slide_findings: list[dict] = []
        text_boxes: list[tuple[str, tuple[float, float, float, float], str]] = []

        for shape in shapes:
            geometry = box(shape)
            name = label(shape)
            if geometry is None:
                slide_findings.append(finding("shape_without_frame", "review", f"'{name}' has no position or size", shape=name))
                continue
            left, top, width, height = geometry

            if left < -TITLE_OUTSIDE_MARGIN_IN or top < -TITLE_OUTSIDE_MARGIN_IN or left + width > slide_w + 0.01 or top + height > slide_h + 0.01:
                slide_findings.append(
                    finding(
                        "outside_slide",
                        "fail",
                        f"'{name}' extends past the slide edge",
                        shape=name,
                        bbox=[round(left, 2), round(top, 2), round(width, 2), round(height, 2)],
                        bleed={
                            "right": round(max(0.0, left + width - slide_w), 2),
                            "bottom": round(max(0.0, top + height - slide_h), 2),
                            "left": round(max(0.0, -left), 2),
                            "top": round(max(0.0, -top), 2),
                        },
                    )
                )

            if width <= 0 or height <= 0:
                slide_findings.append(finding("degenerate_size", "fail", f"'{name}' has zero width or height", shape=name))

            needed = estimated_text_height_in(shape)
            if needed is not None and needed > height + TEXT_OVERFLOW_SLACK_IN:
                slide_findings.append(
                    finding(
                        "text_overflow",
                        "fail",
                        f"'{name}' needs about {needed:.2f} in of text height but its frame is {height:.2f} in",
                        shape=name,
                        neededIn=round(needed, 2),
                        frameIn=round(height, 2),
                    )
                )

            kind = (placeholder_kind(shape) or "").upper()
            if kind and not has_visible_text(shape) and not is_picture(shape):
                slide_findings.append(finding("empty_placeholder", "review", f"empty {kind} placeholder is still on the slide", shape=name))

            if has_visible_text(shape):
                text_boxes.append((name, geometry, text_of(shape)))
                size = run_size_pt(shape) or 0.0
                if "TITLE" in kind or name.lower().startswith("title"):
                    if 0 < size < title_floor:
                        slide_findings.append(finding("small_title", "review", f"title '{name}' is {size:.0f} pt", shape=name, fontPt=size))
                    if text_of(shape).rstrip().endswith("."):
                        slide_findings.append(finding("heading_full_stop", "review", f"heading '{name}' ends with a full stop", shape=name))
                elif 0 < size < body_floor:
                    slide_findings.append(finding("small_body_text", "review", f"'{name}' is {size:.0f} pt", shape=name, fontPt=size))

            if is_table(shape):
                table_bottom = top + height
                if table_bottom > slide_h:
                    slide_findings.append(finding("table_outside_slide", "fail", f"table '{name}' runs {table_bottom - slide_h:.2f} in past the bottom edge", shape=name))

        # text block collisions
        for first in range(len(text_boxes)):
            for second in range(first + 1, len(text_boxes)):
                name_a, box_a, text_a = text_boxes[first]
                name_b, box_b, text_b = text_boxes[second]
                if not rects_intersect(box_a, box_b):
                    continue
                ratio = overlap_ratio(box_a, box_b)
                if ratio >= OVERLAP_HINT_RATIO:
                    slide_findings.append(
                        finding(
                            "text_overlap",
                            "review",
                            f"'{name_a}' and '{name_b}' overlap by {ratio * 100:.0f}% of the smaller box",
                            shapes=[name_a, name_b],
                            overlap=round(ratio, 2),
                            excerpt=[text_a[:60], text_b[:60]],
                        )
                    )

        # a chart or table hidden under a picture/other block
        heavy = [(label(shape), box(shape)) for shape in shapes if (is_chart(shape) or is_table(shape)) and box(shape)]
        for name, geometry in heavy:
            for other in shapes:
                if label(other) == name:
                    continue
                other_box = box(other)
                if other_box is None or is_connector(other) or (is_chart(other) or is_table(other)):
                    continue
                if not has_visible_text(other) and not is_picture(other):
                    continue
                ratio = overlap_ratio(geometry, other_box)
                if ratio >= 0.5:
                    slide_findings.append(
                        finding(
                            "evidence_covered",
                            "fail",
                            f"'{label(other)}' covers {ratio * 100:.0f}% of '{name}'",
                            shapes=[name, label(other)],
                            overlap=round(ratio, 2),
                        )
                    )

        # connectors crossing text
        for shape in shapes:
            if not is_connector(shape) or box(shape) is None:
                continue
            for name, text_box, _ in text_boxes:
                if rects_intersect(box(shape), text_box) and overlap_ratio(box(shape), text_box) > 0.15:
                    slide_findings.append(finding("connector_over_text", "review", f"connector '{label(shape)}' crosses '{name}'", shapes=[label(shape), name]))

        # chart and table repeating the same numbers on one slide
        if any(is_chart(shape) for shape in shapes) and any(is_table(shape) for shape in shapes):
            chart_labels = {
                str(category).strip()
                for shape in shapes
                if is_chart(shape)
                for category in _chart_categories(shape)
            }
            table_labels = {
                str(cell.text).strip()
                for shape in shapes
                if is_table(shape)
                for row in shape.table.rows
                for cell in row.cells
            }
            shared = {value for value in chart_labels & table_labels if value and not value.replace(".", "").isdigit()}
            if len(shared) >= 2:
                slide_findings.append(
                    finding(
                        "duplicate_evidence",
                        "review",
                        "the chart and the table restate the same categories",
                        shared=sorted(shared)[:6],
                    )
                )

        findings.extend({**item, "slide": slide_no} for item in slide_findings)
        slides_report.append(
            {
                "slide": slide_no,
                "shapes": len(shapes),
                "charts": sum(1 for shape in shapes if is_chart(shape)),
                "tables": sum(1 for shape in shapes if is_table(shape)),
                "pictures": sum(1 for shape in shapes if is_picture(shape)),
                "findings": len(slide_findings),
            }
        )

        for shape in shapes:
            kind = (placeholder_kind(shape) or "").upper()
            # A cover is meant to run larger than the body slides, so it is excluded.
            if "CENTER_TITLE" in kind or not has_visible_text(shape):
                continue
            if "TITLE" in kind or label(shape).lower().startswith("title"):
                # Inherited sizes only resolve at render time; approximate them with the
                # pack's placeholder defaults so drift between slides is still visible.
                size = run_size_pt(shape) or default_size_pt(shape)
                if size:
                    title_sizes.append((slide_no, round(size)))

    if len({size for _, size in title_sizes}) > 1:
        findings.append(
            finding(
                "inconsistent_title_size",
                "review",
                "slide titles are set at different sizes; pick one size for the deck",
                sizes=sorted({size for _, size in title_sizes}),
                slides=[slide_no for slide_no, _ in title_sizes],
            )
        )
    blocking = [item for item in findings if item["severity"] == "fail"]
    return {
        "gate": "layout-geometry",
        "presentation": str(Path(pptx_path).resolve()),
        "slideSizeIn": [round(slide_w, 3), round(slide_h, 3)],
        "slides": slides_report,
        "findings": findings,
        "summary": {
            "slides": len(slides_report),
            "fail": len(blocking),
            "review": len(findings) - len(blocking),
        },
        "passed": not blocking,
    }


def _chart_categories(shape) -> list[str]:
    try:
        return [str(category) for category in shape.chart.plots[0].categories]
    except Exception:  # noqa: BLE001 - charts without a cache simply contribute nothing
        return []


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Report slide-geometry problems (out-of-bounds shapes, text overflow, overlaps).")
    parser.add_argument("presentation", nargs="?", help="path to the .pptx")
    parser.add_argument("--input", dest="input_path", help="path to the .pptx (same as the positional)")
    parser.add_argument("--title-floor", type=float, default=DEFAULT_TITLE_FLOOR_PT, help="minimum title size in pt (default 28)")
    parser.add_argument("--body-floor", type=float, default=DEFAULT_BODY_FLOOR_PT, help="minimum body size in pt (default 14)")
    parser.add_argument("--strict", action="store_true", help="treat review findings as blocking too")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    path = args.input_path or args.presentation
    if not path:
        parser.error("a .pptx path is required (positional or --input)")

    report = inspect(path, args.title_floor, args.body_floor)
    if args.strict:
        report["strict"] = True
        report["passed"] = not report["findings"]
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    emit(report)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
