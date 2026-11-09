"""Check that a .pptx is a self-consistent package, not just a readable file.

Purpose: python-pptx opens many broken decks happily. A half-written edit can
leave a relationship pointing at a part that is not in the archive, a chart
whose embedded workbook vanished, or a slide whose layout was never shipped.
This walks the archive and reports what is actually there.

Exit codes: 0 healthy, 1 problems found, 2 unreadable input.
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

REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CT_NS = "{http://schemas.openxmlformats.org/package/2006/content-types}"
P_NS = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _rels_targets(archive: zipfile.ZipFile, part: str) -> list[str]:
    folder, _, name = part.rpartition("/")
    rels_name = f"{folder}/_rels/{name}.rels" if folder else f"_rels/{name}.rels"
    if rels_name not in archive.namelist():
        return []
    try:
        root = ElementTree.fromstring(archive.read(rels_name))
    except ElementTree.ParseError:
        return []
    targets: list[str] = []
    for relationship in root.findall(f"{REL_NS}Relationship"):
        if relationship.get("TargetMode") == "External":
            continue
        target = relationship.get("Target", "")
        if target.startswith("/"):
            resolved = target.lstrip("/")
        else:
            resolved = f"{folder}/{target}" if folder else target
        parts: list[str] = []
        for segment in resolved.split("/"):
            if segment in {"", "."}:
                continue
            if segment == "..":
                if parts:
                    parts.pop()
                continue
            parts.append(segment)
        targets.append("/".join(parts))
    return targets


def inspect_package(pptx_path: str | Path) -> dict:
    path = Path(pptx_path)
    problems: list[dict] = []
    if not path.is_file():
        return {"gate": "package-integrity", "passed": False, "problems": [{"kind": "missing_file", "detail": str(path)}]}
    if not zipfile.is_zipfile(path):
        return {"gate": "package-integrity", "passed": False, "problems": [{"kind": "not_a_zip", "detail": "not a readable OOXML archive"}]}

    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for required in ("[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"):
            if required not in names:
                problems.append({"kind": "missing_part", "part": required})

        slides = sorted(name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        layouts = sorted(name for name in names if name.startswith("ppt/slideLayouts/slideLayout") and name.endswith(".xml"))
        masters = sorted(name for name in names if name.startswith("ppt/slideMasters/slideMaster") and name.endswith(".xml"))
        charts = sorted(name for name in names if name.startswith("ppt/charts/chart") and name.endswith(".xml"))
        media = sorted(name for name in names if name.startswith("ppt/media/"))
        embeddings = sorted(name for name in names if name.startswith("ppt/embeddings/"))

        if not slides:
            problems.append({"kind": "no_slides", "detail": "the package has no ppt/slides parts"})
        if not masters:
            problems.append({"kind": "no_master", "detail": "the package has no slide master"})

        for part in slides + charts + layouts + masters:
            for target in _rels_targets(archive, part):
                if target and target not in names:
                    problems.append({"kind": "dangling_relationship", "part": part, "target": target})

        for part in slides:
            try:
                root = ElementTree.fromstring(archive.read(part))
            except ElementTree.ParseError as exc:
                problems.append({"kind": "unparsable_xml", "part": part, "detail": str(exc)})
                continue
            if root.tag != f"{P_NS}sld":
                problems.append({"kind": "wrong_root_element", "part": part, "detail": root.tag})

        presentation_xml = archive.read("ppt/presentation.xml") if "ppt/presentation.xml" in names else b""
        declared_slides = 0
        if presentation_xml:
            try:
                root = ElementTree.fromstring(presentation_xml)
                slide_ids = root.find(f"{P_NS}sldIdLst")
                declared_slides = len(list(slide_ids)) if slide_ids is not None else 0
            except ElementTree.ParseError:
                problems.append({"kind": "unparsable_xml", "part": "ppt/presentation.xml"})
        if declared_slides and declared_slides != len(slides):
            problems.append(
                {
                    "kind": "slide_count_mismatch",
                    "detail": f"presentation.xml lists {declared_slides} slides but the package carries {len(slides)} parts",
                }
            )

        duplicates = len(slides) - len({name.lower() for name in slides})
        if duplicates:
            problems.append({"kind": "duplicate_parts", "count": duplicates})

        notes = [name for name in names if name.startswith("ppt/notesSlides/notesSlide") and name.endswith(".xml")]

    return {
        "gate": "package-integrity",
        "presentation": str(path.resolve()),
        "parts": {
            "slides": len(slides),
            "layouts": len(layouts),
            "masters": len(masters),
            "charts": len(charts),
            "notesSlides": len(notes),
            "media": len(media),
            "embeddings": len(embeddings),
        },
        "problems": problems,
        "passed": not problems,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Verify OOXML part/relationship integrity of a .pptx.")
    parser.add_argument("presentation", nargs="?", help="path to the .pptx")
    parser.add_argument("--input", dest="input_path", help="path to the .pptx (same as the positional)")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    path = args.input_path or args.presentation
    if not path:
        parser.error("a .pptx path is required (positional or --input)")

    report = inspect_package(path)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
