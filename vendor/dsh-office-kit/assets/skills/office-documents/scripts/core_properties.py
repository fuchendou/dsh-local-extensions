#!/usr/bin/env python3
"""Read or set the core properties of a Word document.

Core properties are the metadata a reader sees in File > Info: title, author,
subject, keywords, comments, category and the last modifier. They live outside
the body in docProps/core.xml, so changing them never touches the content.

Usage:
  core_properties.py --input IN.docx [--out OUT.docx] --title "..." --author "..."
  core_properties.py --input IN.docx [--out OUT.docx] --spec core.json
  core_properties.py --input IN.docx --show

The spec file is {"core": {"title": "...", "author": "..."}} or a bare object of
the same names. With no property arguments the command only reports.

Exit codes: 0 success, 1 the document or spec could not be read, 2 argparse
usage error.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import docx_kit as kit  # noqa: E402

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

TEXT_FIELDS = (
    "title",
    "author",
    "subject",
    "keywords",
    "comments",
    "category",
    "last_modified_by",
    "content_status",
    "identifier",
    "language",
    "version",
)
INT_FIELDS = ("revision",)


def fail(payload: dict, code: int = 1) -> int:
    kit.emit({"ok": False, **payload})
    return code


def snapshot(document) -> dict:
    props = document.core_properties
    data: dict = {}
    for name in TEXT_FIELDS:
        value = getattr(props, name, None)
        data[name] = "" if value is None else str(value)
    for name in INT_FIELDS:
        data[name] = getattr(props, name, None)
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Read or set .docx core properties.")
    parser.add_argument("--input", required=True, help="source .docx (never modified)")
    parser.add_argument("--out", help="output path; default <name>-edited.docx")
    parser.add_argument("--spec", help="JSON file with a core properties object")
    parser.add_argument("--show", action="store_true", help="report properties and change nothing")
    for name in TEXT_FIELDS:
        parser.add_argument("--" + name.replace("_", "-"), dest=name, help=f"set {name}")
    parser.add_argument("--revision", type=int, help="set the revision counter")
    args = parser.parse_args()

    source = Path(args.input).expanduser()
    if not source.is_file():
        return fail({"error": f"input not found: {args.input}"})

    updates: dict = {}
    if args.spec:
        try:
            payload = json.loads(Path(args.spec).expanduser().read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            return fail({"error": f"cannot read spec: {exc}"}, 2)
        updates.update(payload.get("core", payload) if isinstance(payload, dict) else {})
    for name in TEXT_FIELDS:
        value = getattr(args, name)
        if value is not None:
            updates[name] = value
    if args.revision is not None:
        updates["revision"] = args.revision

    unknown = [key for key in updates if key not in TEXT_FIELDS and key not in INT_FIELDS]
    if unknown:
        return fail({"error": "unknown properties: " + ", ".join(sorted(unknown)), "known": list(TEXT_FIELDS)}, 2)

    from docx import Document

    document = Document(str(source))
    before = snapshot(document)
    if args.show or not updates:
        kit.emit({"ok": True, "input": str(source), "properties": before})
        return 0

    for key, value in updates.items():
        setattr(document.core_properties, key, value)
    after = snapshot(document)

    out = Path(args.out).expanduser() if args.out else source.with_name(f"{source.stem}-edited.docx")
    if out.resolve() == source.resolve():
        return fail({"error": "refusing to overwrite the input; pass a different --out"})
    out.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(out))
    kit.emit({
        "ok": True,
        "input": str(source),
        "output": str(out),
        "changed": sorted(updates),
        "before": {key: before[key] for key in updates},
        "after": {key: after[key] for key in updates},
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
