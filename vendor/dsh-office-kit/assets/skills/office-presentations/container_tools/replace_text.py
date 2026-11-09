"""Replace text inside runs of an existing deck.

Run-level by design: a match only counts when the whole `find` string lives in a
single run. Text split across runs by earlier formatting is *not* merged, which
keeps formatting intact and makes the outcome predictable — the tool reports
what it matched, and reports what it could not match.

Usage
-----
    <python> replace_text.py --input deck.pptx --find "Q4 2025" --replace "Q4 2026"
    <python> replace_text.py --input deck.pptx --spec replacements.json --out fixed.pptx

Exit codes
----------
0  every requested pattern was applied at least once
1  a pattern matched nothing (the file is still written; check the report)
2  bad arguments, unreadable input or invalid spec
3  the output file could not be written

The JSON report on stdout is `{ok, input, output, total, slides[], unmatched[]}`.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def _emit(payload: dict, code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return code


def _load_spec(path: str | None) -> list[dict]:
    if not path:
        return []
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        entries = data.get("replacements") or []
    elif isinstance(data, list):
        entries = data
    else:
        raise ValueError("spec must be an object with 'replacements' or a list")
    resolved = []
    for entry in entries:
        if not isinstance(entry, dict) or "find" not in entry:
            raise ValueError(f"replacement needs a 'find' key: {entry!r}")
        resolved.append(
            {
                "find": str(entry["find"]),
                "replace": str(entry.get("replace", "")),
                "slide": entry.get("slide"),
                "match_case": bool(entry.get("match_case", True)),
            }
        )
    return resolved


def _frames(slide):
    for shape in slide.shapes:
        if shape.has_text_frame:
            yield shape.text_frame
        if getattr(shape, "has_table", False) and shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    yield cell.text_frame


def replace_in_slide(slide, rules: list[dict]) -> list[dict]:
    hits = []
    for frame in _frames(slide):
        for paragraph in frame.paragraphs:
            for run in paragraph.runs:
                original = run.text
                updated = original
                for rule in rules:
                    needle = rule["find"] if rule["match_case"] else rule["find"].lower()
                    haystack = updated if rule["match_case"] else updated.lower()
                    if needle and needle in haystack:
                        updated = updated.replace(rule["find"], rule["replace"])
                        hits.append({"find": rule["find"], "before": original, "after": updated})
                if updated != original:
                    run.text = updated
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replace text inside runs of a .pptx (never across runs).",
        epilog="Exit codes: 0 all patterns applied, 1 a pattern matched nothing, 2 bad input, 3 write failure.",
    )
    parser.add_argument("--input", required=True, help="source deck")
    parser.add_argument("--find", action="append", default=[], help="text to find (repeatable)")
    parser.add_argument("--replace", action="append", default=[], help="replacement (repeatable, pairs with --find)")
    parser.add_argument("--spec", help="JSON file: {replacements:[{find, replace, slide?, match_case?}]}")
    parser.add_argument("--out", help="output deck (default: <input>-edited.pptx)")
    args = parser.parse_args()

    rules: list[dict] = []
    try:
        for index, needle in enumerate(args.find):
            rules.append(
                {
                    "find": needle,
                    "replace": args.replace[index] if index < len(args.replace) else "",
                    "slide": None,
                    "match_case": True,
                }
            )
        rules.extend(_load_spec(args.spec))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _emit({"ok": False, "error": f"bad spec: {error}"}, 2)

    if not rules:
        return _emit({"ok": False, "error": "nothing to replace: pass --find/--replace or --spec"}, 2)

    source = Path(args.input)
    if not source.is_file():
        return _emit({"ok": False, "error": f"no such file: {source}"}, 2)
    output = Path(args.out) if args.out else source.with_name(f"{source.stem}-edited{source.suffix}")

    try:
        from pptx import Presentation
    except ImportError as error:
        return _emit({"ok": False, "error": f"python-pptx is required: {error}"}, 2)

    try:
        prs = Presentation(str(source))
    except Exception as error:  # noqa: BLE001 - report, never traceback at the user
        return _emit({"ok": False, "error": f"cannot open {source}: {error}"}, 2)

    slides_report = []
    total = 0
    matched_patterns: set[str] = set()
    for index, slide in enumerate(prs.slides, start=1):
        applicable = [rule for rule in rules if rule["slide"] in (None, index)]
        hits = replace_in_slide(slide, applicable)
        for hit in hits:
            matched_patterns.add(hit["find"])
        total += len(hits)
        if hits:
            slides_report.append({"slide": index, "replacements": len(hits), "details": hits[:10]})

    unmatched = sorted({rule["find"] for rule in rules} - matched_patterns)

    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        prs.save(str(output))
    except Exception as error:  # noqa: BLE001
        return _emit({"ok": False, "error": f"cannot write {output}: {error}"}, 3)

    report = {
        "schema": "replace_text/1",
        "ok": not unmatched,
        "input": str(source),
        "output": str(output),
        "rules": len(rules),
        "total": total,
        "slides": slides_report,
        "unmatched": unmatched,
        "note": "matches only inside a single run; text split by formatting is left alone",
    }
    return _emit(report, 0 if not unmatched else 1)


if __name__ == "__main__":
    sys.exit(main())
