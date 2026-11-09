"""Check a template plan before any slide is touched.

Purpose: a template plan is a contract between "what the design gives you" and
"what you intend to write". Validating it first turns a silent redesign into a
list of violations, because the expensive mistakes (deleting a logo, inventing
new blocks the brand never had, covering inherited art) are all visible on
paper before anything is built.

Plan shape (template-frame-map.json):
  {
    "template": "path/to/template.pptx",
    "newPrimitives": {"allowed": false, "justification": ""},
    "outputSlides": [
      {"slide": 1, "mode": "duplicate-slide", "sourceSlide": 3,
       "elements": [{"elementId": "shape-7", "action": "fill-placeholder",
                     "target": {"placeholder": "title", "text": "Q3 results"}}]}
    ]
  }

Exit codes: 0 valid, 1 violations, 2 unreadable plan.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "container_tools"))

ALLOWED_ACTIONS = {"rewrite", "rewrite-and-reposition", "replace", "delete", "keep", "fill-placeholder"}
PRESERVE_ONLY_ROLES = {"brand", "logo", "bumper", "divider", "section", "chrome", "footer"}
MODES = {"duplicate-slide"}


def _violation(code: str, message: str, severity: str = "fail", **extra) -> dict:
    return {"code": code, "severity": severity, "message": message, **extra}


def validate_plan(plan: dict) -> dict:
    violations: list[dict] = []
    warnings: list[dict] = []

    output_slides = plan.get("outputSlides")
    if not isinstance(output_slides, list) or not output_slides:
        return {"gate": "template-plan", "passed": False, "violations": [_violation("missing_output_slides", "the plan declares no output slides")], "checks": 0}

    indices = []
    sources: dict[int, int] = {}
    element_actions = 0
    for position, entry in enumerate(output_slides, start=1):
        if not isinstance(entry, dict):
            violations.append(_violation("malformed_slide", f"output slide #{position} is not an object"))
            continue
        slide_no = entry.get("slide", position)
        indices.append(slide_no)
        mode = entry.get("mode", "duplicate-slide")
        if mode not in MODES:
            violations.append(_violation("unsupported_mode", f"slide {slide_no}: mode '{mode}' is not supported", slide=slide_no))
        source = entry.get("sourceSlide")
        if not isinstance(source, int) or source < 1:
            violations.append(_violation("missing_source_slide", f"slide {slide_no}: sourceSlide must be a positive integer", slide=slide_no))
        else:
            if source in sources:
                warnings.append(
                    _violation(
                        "duplicated_source_slide",
                        f"slides {sources[source]} and {slide_no} both duplicate source slide {source}",
                        severity="review",
                        slide=slide_no,
                    )
                )
            sources[source] = slide_no
        elements = entry.get("elements", [])
        if not isinstance(elements, list):
            violations.append(_violation("malformed_elements", f"slide {slide_no}: elements must be a list", slide=slide_no))
            continue
        for element in elements:
            if not isinstance(element, dict) or not element.get("elementId"):
                violations.append(_violation("missing_element_id", f"slide {slide_no}: an element has no elementId", slide=slide_no))
                continue
            element_actions += 1
            element_id = element["elementId"]
            action = element.get("action")
            target = element.get("target") or {}
            if action not in ALLOWED_ACTIONS:
                violations.append(
                    _violation(
                        "unknown_action",
                        f"slide {slide_no} element {element_id}: '{action}' is not one of {sorted(ALLOWED_ACTIONS)}",
                        slide=slide_no,
                        elementId=element_id,
                    )
                )
                continue
            role = str(target.get("role") or element.get("role") or "").lower()
            if role in PRESERVE_ONLY_ROLES and action != "keep":
                violations.append(
                    _violation(
                        "preserve_only_element",
                        f"slide {slide_no} element {element_id}: role '{role}' must stay untouched, found '{action}'",
                        slide=slide_no,
                        elementId=element_id,
                    )
                )
            if action == "fill-placeholder" and not (target.get("placeholder") or target.get("text")):
                violations.append(
                    _violation("placeholder_target_missing", f"slide {slide_no} element {element_id}: fill-placeholder needs a placeholder or text target", slide=slide_no, elementId=element_id)
                )
            if action in {"rewrite", "rewrite-and-reposition"} and not target.get("text"):
                violations.append(
                    _violation("rewrite_text_missing", f"slide {slide_no} element {element_id}: {action} needs target.text", slide=slide_no, elementId=element_id)
                )
            if action == "rewrite-and-reposition":
                zone = target.get("zone")
                if not (isinstance(zone, list) and len(zone) == 4 and all(isinstance(value, (int, float)) for value in zone)):
                    violations.append(
                        _violation("zone_missing", f"slide {slide_no} element {element_id}: rewrite-and-reposition needs a zone [x, y, w, h]", slide=slide_no, elementId=element_id)
                    )
                else:
                    x, y, width, height = zone
                    if not all(0.0 <= value <= 1.0 for value in zone) or x + width > 1.0001 or y + height > 1.0001:
                        violations.append(
                            _violation("zone_out_of_bounds", f"slide {slide_no} element {element_id}: zone {zone} does not fit inside 0-1", slide=slide_no, elementId=element_id)
                        )
            if action == "replace":
                warnings.append(
                    _violation(
                        "replace_needs_authoring",
                        f"slide {slide_no} element {element_id}: 'replace' is applied by the author with a recipe, not by the starter-deck builder",
                        severity="review",
                        slide=slide_no,
                        elementId=element_id,
                    )
                )

    if indices != list(range(1, len(output_slides) + 1)):
        violations.append(_violation("non_sequential_slides", f"output slide numbers must start at 1 and be sequential, found {indices}"))

    primitives = plan.get("newPrimitives") or {}
    if primitives.get("allowed") is True and not str(primitives.get("justification") or "").strip():
        violations.append(_violation("new_primitives_unjustified", "newPrimitives.allowed is true but no justification was given"))

    blocking = [item for item in violations if item["severity"] == "fail"]
    return {
        "gate": "template-plan",
        "passed": not blocking,
        "checks": {"outputSlides": len(output_slides), "elementActions": element_actions},
        "violations": violations,
        "warnings": warnings,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Validate a template-frame-map before building the deck.")
    parser.add_argument("--plan", required=True, help="path to template-frame-map.json")
    parser.add_argument("--template", help="optionally confirm the plan names an existing template file")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)

    try:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - a bad plan is the finding
        json.dump({"gate": "template-plan", "passed": False, "error": {"code": "unparsable_plan", "message": str(exc)}}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    report = validate_plan(plan)
    if args.template:
        declared = plan.get("template") or args.template
        report["template"] = str(declared)
        if not Path(declared).is_file():
            report["violations"].append({"code": "template_missing", "severity": "fail", "message": f"template not found: {declared}"})
            report["passed"] = False
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
