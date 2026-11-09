"""Catch the traces an authoring pass leaves in a template-based deck.

Purpose: a deck can keep the template's layouts and still be wrong — a
"Click to add title" prompt left in place, the template's instruction text
still sitting in a body, or an opaque panel dropped exactly over the artwork
the design relies on. None of those are visible in a plan; all of them are
cheap to detect afterwards.

Exit codes: 0 clean, 1 findings, 2 unreadable input.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "container_tools"))

from ooxml_helpers import box, has_visible_text, is_picture, overlap_ratio, text_of  # noqa: E402

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

PLACEHOLDER_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^slide number$",
        r"^date$",
        r"^footer$",
        r"^click to add (title|subtitle|text|body)",
        r"^(title|subtitle|name|text|body) goes here$",
        r"^lorem ipsum\b",
        r"\btemplate instruction\b",
        r"^\[.*\]$",
    )
]
ART_COVER_MIN_RATIO = 0.9


def _has_solid_fill(shape) -> bool:
    try:
        from pptx.enum.dml import MSO_FILL

        return shape.fill.type == MSO_FILL.SOLID
    except Exception:  # noqa: BLE001 - shapes without a fill API are never opaque panels
        return False


def _slide_size_in(slide) -> tuple[float, float]:
    presentation = slide.part.package.presentation_part.presentation
    return presentation.slide_width / 914400, presentation.slide_height / 914400


def check(template_path: str | Path, final_path: str | Path, plan_path: str | Path | None = None) -> dict:
    from pptx import Presentation

    template_file = Path(template_path)
    final_file = Path(final_path)
    for candidate in (template_file, final_file):
        if not candidate.is_file():
            return {"gate": "template-authoring-fidelity", "passed": False, "findings": [{"kind": "missing_file", "detail": str(candidate)}]}

    template = Presentation(str(template_file))
    final = Presentation(str(final_file))
    template_slides = list(template.slides)
    final_slides = list(final.slides)
    plan = {}
    if plan_path and Path(plan_path).is_file():
        plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))

    findings: list[dict] = []
    mapping: list[tuple[int, int]] = []
    for entry in plan.get("outputSlides") or []:
        mapping.append((int(entry.get("slide", len(mapping) + 1)), int(entry.get("sourceSlide", 0))))
    if not mapping:
        mapping = [(index, index) for index in range(1, min(len(template_slides), len(final_slides)) + 1)]

    for output_index, source_index in mapping:
        if not (1 <= output_index <= len(final_slides) and 1 <= source_index <= len(template_slides)):
            findings.append({"kind": "mapping_out_of_range", "severity": "fail", "message": f"mapping {output_index}->{source_index} is outside the deck"})
            continue
        output_slide = final_slides[output_index - 1]
        source_slide = template_slides[source_index - 1]

        if output_slide.slide_layout.name != source_slide.slide_layout.name:
            findings.append(
                {
                    "kind": "layout_drift",
                    "severity": "review",
                    "slide": output_index,
                    "message": f"layout is '{output_slide.slide_layout.name}', template slide used '{source_slide.slide_layout.name}'",
                }
            )

        for shape in output_slide.shapes:
            if not has_visible_text(shape):
                continue
            text = text_of(shape).strip()
            for pattern in PLACEHOLDER_PATTERNS:
                if pattern.search(text):
                    findings.append(
                        {
                            "kind": "leftover_placeholder_text",
                            "severity": "fail",
                            "slide": output_index,
                            "shape": shape.name,
                            "text": text[:80],
                            "message": "template prompt text is still on the slide",
                        }
                    )
                    break
            if not text and shape.is_placeholder:
                findings.append({"kind": "empty_placeholder", "severity": "review", "slide": output_index, "shape": shape.name, "message": "placeholder was left empty"})

        inherited_art = [box(shape) for shape in source_slide.shapes if is_picture(shape) and box(shape)]
        slide_w, slide_h = _slide_size_in(source_slide)
        full_bleed = {
            index
            for index, art in enumerate(inherited_art)
            if art[0] <= 0.02 and art[1] <= 0.02 and art[2] >= slide_w * 0.98 and art[3] >= slide_h * 0.98
        }
        for shape in output_slide.shapes:
            # only an opaque panel is a problem: text over a background image is the template working
            if is_picture(shape) or not _has_solid_fill(shape):
                continue
            geometry = box(shape)
            if geometry is None:
                continue
            for art_index, art in enumerate(inherited_art):
                if art_index in full_bleed:
                    continue
                ratio = overlap_ratio(geometry, art)
                if ratio >= ART_COVER_MIN_RATIO:
                    findings.append(
                        {
                            "kind": "template_art_covered",
                            "severity": "fail",
                            "slide": output_index,
                            "shape": shape.name,
                            "overlap": round(ratio, 2),
                            "message": "a text or table block sits on top of the template artwork",
                        }
                    )
                    break

    blocking = [item for item in findings if item["severity"] == "fail"]
    return {
        "gate": "template-authoring-fidelity",
        "template": str(template_file.resolve()),
        "final": str(final_file.resolve()),
        "plan": str(plan_path) if plan_path else None,
        "mappedSlides": len(mapping),
        "findings": findings,
        "passed": not blocking,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Find leftover template prompts, layout drift and covered artwork.")
    parser.add_argument("--template", required=True, help="the template .pptx")
    parser.add_argument("--final", required=True, help="the finished .pptx")
    parser.add_argument("--plan", help="optional template-frame-map.json for the slide mapping")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)

    report = check(args.template, args.final, args.plan)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
