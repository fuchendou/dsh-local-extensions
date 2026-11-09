"""Read a template deck into records an author can plan against.

Purpose: matching a supplied deck starts with knowing what it actually is —
slide size, which layouts exist, what each slide inherits, where the title and
body sit, which elements repeat on every slide, what type and colours the theme
carries. Guessing from memory of "a normal 16:9 deck" is how a template gets
flattened.

Writes:
  <out-dir>/template-inspect.ndjson    one JSON record per slide
  <out-dir>/template-manifest.json     deck level summary

Exit codes: 0 written, 2 unreadable input.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "container_tools"))

from ooxml_helpers import box, has_visible_text, is_chart, is_picture, is_table, placeholder_kind, slide_size_in, text_of  # noqa: E402

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def _theme(presentation) -> dict:
    fonts: set[str] = set()
    fills: set[str] = set()
    for master in presentation.slide_masters:
        for layout in master.slide_layouts:
            for shape in layout.shapes:
                if has_visible_text(shape):
                    for paragraph in shape.text_frame.paragraphs:
                        for run in paragraph.runs:
                            if run.font.name:
                                fonts.add(run.font.name)
    for slide in presentation.slides:
        for shape in slide.shapes:
            if has_visible_text(shape):
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        if run.font.name:
                            fonts.add(run.font.name)
    return {"fontsSeen": sorted(fonts), "colourSourcesNote": "check layouts and masters in PowerPoint for exact theme colours"}


def inspect_template(template_path: str | Path, out_dir: str | Path) -> dict:
    from pptx import Presentation

    source = Path(template_path)
    if not source.is_file():
        return {"ok": False, "error": {"code": "input_missing", "message": f"no such file: {source}"}}
    presentation = Presentation(str(source))
    slide_w, slide_h = slide_size_in(presentation)
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)

    records: list[dict] = []
    for index, slide in enumerate(presentation.slides, start=1):
        layout = slide.slide_layout
        placeholders = []
        for shape in slide.shapes:
            if not shape.is_placeholder:
                continue
            placeholders.append(
                {
                    "idx": shape.placeholder_format.idx,
                    "kind": placeholder_kind(shape) or "",
                    "type": int(shape.placeholder_format.type) if shape.placeholder_format.type is not None else None,
                    "bboxIn": [round(value, 3) for value in (box(shape) or (0, 0, 0, 0))],
                    "text": text_of(shape)[:120],
                }
            )
        layout_placeholders = [
            {
                "idx": shape.placeholder_format.idx,
                "kind": placeholder_kind(shape) or "",
                "bboxIn": [round(value, 3) for value in (box(shape) or (0, 0, 0, 0))],
            }
            for shape in layout.shapes
            if shape.is_placeholder
        ]
        records.append(
            {
                "slide": index,
                "layout": layout.name,
                "layoutIndex": list(presentation.slide_layouts).index(layout) if layout in list(presentation.slide_layouts) else None,
                "layoutPlaceholders": layout_placeholders,
                "placeholders": placeholders,
                "shapes": len(slide.shapes),
                "pictures": sum(1 for shape in slide.shapes if is_picture(shape)),
                "charts": sum(1 for shape in slide.shapes if is_chart(shape)),
                "tables": sum(1 for shape in slide.shapes if is_table(shape)),
                "textExcerpt": " | ".join(text_of(shape)[:80] for shape in slide.shapes if has_visible_text(shape))[:240],
                "backgroundPicture": any(
                    is_picture(shape) and box(shape) and box(shape)[2] >= slide_w * 0.95 and box(shape)[3] >= slide_h * 0.95
                    for shape in slide.shapes
                ),
            }
        )

    manifest = {
        "template": str(source.resolve()),
        "slideSizeIn": [round(slide_w, 3), round(slide_h, 3)],
        "aspect": "16:9" if abs(slide_w / slide_h - 16 / 9) < 0.02 else "4:3" if abs(slide_w / slide_h - 4 / 3) < 0.02 else "custom",
        "slideCount": len(presentation.slides),
        "layouts": [layout.name for layout in presentation.slide_layouts],
        "masters": len(presentation.slide_masters),
        "slides": [{key: record[key] for key in ("slide", "layout", "shapes", "backgroundPicture")} for record in records],
        "theme": _theme(presentation),
    }

    ndjson = destination / "template-inspect.ndjson"
    ndjson.write_text("\n".join(json.dumps(record, ensure_ascii=False) for record in records) + "\n", encoding="utf-8")
    manifest_path = destination / "template-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "template": str(source.resolve()),
        "records": len(records),
        "ndjson": str(ndjson.resolve()),
        "manifest": str(manifest_path.resolve()),
        "summary": {
            "slideCount": manifest["slideCount"],
            "slideSizeIn": manifest["slideSizeIn"],
            "aspect": manifest["aspect"],
            "layouts": manifest["layouts"],
            "backgroundArtSlides": [record["slide"] for record in records if record["backgroundPicture"]],
        },
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Summarise a template deck: layouts, placeholders, geometry, theme.")
    parser.add_argument("template", nargs="?", help="path to the template .pptx")
    parser.add_argument("--template", dest="template_opt", help="path to the template .pptx (same as the positional)")
    parser.add_argument("--out-dir", required=True, help="directory for template-inspect.ndjson and template-manifest.json")
    args = parser.parse_args(argv)
    template = args.template_opt or args.template
    if not template:
        parser.error("a template .pptx path is required (positional or --template)")

    report = inspect_template(template, args.out_dir)
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
