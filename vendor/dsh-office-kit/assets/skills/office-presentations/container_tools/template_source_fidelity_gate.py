"""Compare a finished deck against the template it claims to follow.

Purpose: "it looks similar" is not fidelity. This gate takes explicit
requirements — which source slides must be represented, how close the slide
size and placeholder geometry must be, whether a photographic background must
survive — and answers yes or no. No requirements supplied means nothing to
enforce, so the gate passes neutrally instead of inventing a standard.

Requirements file:
  {
    "reference_slide_indices": [1, 3, 4],
    "mapping": {"1": 1, "2": 3, "3": 4},
    "minimum_coverage_ratio": 1.0,
    "require_exact_dimensions": true,
    "require_placeholder_geometry": true,
    "require_photographic_background": false,
    "geometry_tolerance_emu": 9144
  }

Exit codes: 0 pass, 1 fail, 2 unreadable input.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ooxml_helpers import box, is_picture, slide_size_in  # noqa: E402

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

EMU_PER_INCH = 914400
DEFAULT_TOLERANCE_EMU = 9144  # 0.01 in


def _placeholder_map(slide) -> dict[tuple[int, str], tuple[float, float, float, float]]:
    entries: dict[tuple[int, str], tuple[float, float, float, float]] = {}
    for shape in slide.shapes:
        if not shape.is_placeholder:
            continue
        geometry = box(shape)
        if geometry is None:
            continue
        entries[(shape.placeholder_format.idx, shape.name)] = geometry
    return entries


def _background_picture(slide, slide_w: float, slide_h: float) -> bool:
    for shape in slide.shapes:
        if not is_picture(shape):
            continue
        geometry = box(shape)
        if geometry is None:
            continue
        left, top, width, height = geometry
        if left <= 0.02 and top <= 0.02 and width >= slide_w * 0.98 and height >= slide_h * 0.98:
            return True
    return False


def check_fidelity(template_path: str | Path, final_path: str | Path, requirements: dict | None) -> dict:
    from pptx import Presentation

    requirements = requirements or {}
    template_file = Path(template_path)
    final_file = Path(final_path)
    for candidate in (template_file, final_file):
        if not candidate.is_file():
            return {"gate": "template-source-fidelity", "passed": False, "findings": [{"kind": "missing_file", "detail": str(candidate)}]}

    if not requirements:
        return {
            "gate": "template-source-fidelity",
            "passed": True,
            "neutral": True,
            "note": "no fidelity requirements were supplied, so nothing was enforced",
            "findings": [],
        }

    template = Presentation(str(template_file))
    final = Presentation(str(final_file))
    template_w, template_h = slide_size_in(template)
    final_w, final_h = slide_size_in(final)
    tolerance_in = float(requirements.get("geometry_tolerance_emu", DEFAULT_TOLERANCE_EMU)) / EMU_PER_INCH
    findings: list[dict] = []
    checks: list[dict] = []

    if requirements.get("require_exact_dimensions", True):
        same = abs(template_w - final_w) <= tolerance_in and abs(template_h - final_h) <= tolerance_in
        checks.append({"check": "dimensions", "passed": same, "template": [template_w, template_h], "final": [final_w, final_h]})
        if not same:
            findings.append(
                {
                    "kind": "dimension_mismatch",
                    "severity": "fail",
                    "message": f"final deck is {final_w:.2f}x{final_h:.2f} in, template is {template_w:.2f}x{template_h:.2f} in",
                }
            )

    template_slides = list(template.slides)
    final_slides = list(final.slides)
    mapping = requirements.get("mapping") or {}
    pairs: list[tuple[int, int]] = []
    for output_index, source_index in mapping.items():
        pairs.append((int(output_index), int(source_index)))
    if not pairs:
        pairs = [(index, index) for index in range(1, min(len(template_slides), len(final_slides)) + 1)]

    matched = 0
    for output_index, source_index in pairs:
        if not (1 <= output_index <= len(final_slides) and 1 <= source_index <= len(template_slides)):
            findings.append(
                {
                    "kind": "mapping_out_of_range",
                    "severity": "fail",
                    "message": f"mapping {output_index}->{source_index} is outside the deck",
                }
            )
            continue
        source_slide = template_slides[source_index - 1]
        output_slide = final_slides[output_index - 1]
        slide_pass = True

        if source_slide.slide_layout.name != output_slide.slide_layout.name:
            slide_pass = False
            findings.append(
                {
                    "kind": "layout_changed",
                    "severity": "fail",
                    "slide": output_index,
                    "sourceSlide": source_index,
                    "message": f"layout went from '{source_slide.slide_layout.name}' to '{output_slide.slide_layout.name}'",
                }
            )

        if requirements.get("require_placeholder_geometry", True):
            source_placeholders = _placeholder_map(source_slide)
            output_placeholders = _placeholder_map(output_slide)
            for key, source_box in source_placeholders.items():
                output_box = output_placeholders.get(key)
                if output_box is None:
                    continue
                drift = max(abs(a - b) for a, b in zip(source_box, output_box))
                if drift > tolerance_in:
                    slide_pass = False
                    findings.append(
                        {
                            "kind": "placeholder_geometry_drift",
                            "severity": "fail",
                            "slide": output_index,
                            "placeholder": key[1],
                            "driftIn": round(drift, 3),
                            "message": f"placeholder '{key[1]}' moved {drift:.2f} in from the template position",
                        }
                    )

        if requirements.get("require_photographic_background"):
            if _background_picture(source_slide, template_w, template_h) and not _background_picture(output_slide, final_w, final_h):
                slide_pass = False
                findings.append(
                    {
                        "kind": "background_lost",
                        "severity": "fail",
                        "slide": output_index,
                        "sourceSlide": source_index,
                        "message": "the template slide carries a full-bleed background image; the output does not",
                    }
                )

        checks.append({"check": "slide", "outputSlide": output_index, "sourceSlide": source_index, "passed": slide_pass})
        matched += 1 if slide_pass else 0

    coverage = matched / len(pairs) if pairs else 0.0
    minimum = float(requirements.get("minimum_coverage_ratio", 1.0))
    checks.append({"check": "coverage", "ratio": round(coverage, 4), "minimum": minimum, "passed": coverage + 1e-9 >= minimum})
    if coverage + 1e-9 < minimum:
        findings.append(
            {
                "kind": "coverage_below_minimum",
                "severity": "fail",
                "message": f"{coverage:.0%} of mapped slides preserved the template, minimum is {minimum:.0%}",
            }
        )

    reference = requirements.get("reference_slide_indices") or []
    if reference and not pairs:
        findings.append({"kind": "no_usable_mapping", "severity": "fail", "message": f"reference slides {reference} could not be mapped to output slides"})

    return {
        "gate": "template-source-fidelity",
        "template": str(template_file.resolve()),
        "final": str(final_file.resolve()),
        "requirements": requirements,
        "checks": checks,
        "findings": findings,
        "coverage": round(coverage, 4),
        "passed": not [item for item in findings if item["severity"] == "fail"],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Verify that a deck preserved the template it was built from.")
    parser.add_argument("--template", required=True, help="the source template .pptx")
    parser.add_argument("--final", required=True, help="the finished .pptx")
    parser.add_argument("--requirements", help="JSON file with the fidelity requirements; omit for a neutral pass")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)

    requirements = None
    if args.requirements:
        try:
            requirements = json.loads(Path(args.requirements).read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            json.dump({"gate": "template-source-fidelity", "passed": False, "error": {"code": "bad_requirements", "message": str(exc)}}, sys.stdout)
            sys.stdout.write("\n")
            return 2
    report = check_fidelity(args.template, args.final, requirements)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
