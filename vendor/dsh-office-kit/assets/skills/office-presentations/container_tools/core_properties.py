"""Read or set the document properties of a deck.

Title, author, subject, keywords and comments live in `docProps/core.xml`. They
show up in file listings, in the presenter's title bar and in search, which is
why a deck titled "PowerPoint Presentation" is a small embarrassment.

Passing no property flag prints the current values and changes nothing.

Usage
-----
    <python> core_properties.py --input deck.pptx
    <python> core_properties.py --input deck.pptx --title "Automation Review" --author "Ops"
    <python> core_properties.py --input deck.pptx --keywords "warehouse, automation" --out tagged.pptx

Exit codes
----------
0  properties read or written
2  bad arguments or unreadable input
3  the output file could not be written

The JSON report on stdout is `{ok, input, output, before{}, after{}, changed[]}`.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

FIELDS = ("title", "author", "subject", "keywords", "comments", "category", "last_modified_by")


def _emit(payload: dict, code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return code


def _snapshot(properties) -> dict:
    return {field: getattr(properties, field, None) for field in FIELDS}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read or set .pptx core properties (title, author, subject, keywords, comments).",
        epilog="Exit codes: 0 ok, 2 bad input, 3 write failure.",
    )
    parser.add_argument("--input", required=True, help="source deck")
    parser.add_argument("--title")
    parser.add_argument("--author")
    parser.add_argument("--subject")
    parser.add_argument("--keywords")
    parser.add_argument("--comments")
    parser.add_argument("--category")
    parser.add_argument("--last-modified-by")
    parser.add_argument("--out", help="output deck (default: <input>-edited.pptx when writing)")
    args = parser.parse_args()

    source = Path(args.input)
    if not source.is_file():
        return _emit({"ok": False, "error": f"no such file: {source}"}, 2)

    from pptx import Presentation  # noqa: PLC0415

    try:
        prs = Presentation(str(source))
    except Exception as error:  # noqa: BLE001
        return _emit({"ok": False, "error": f"cannot open {source}: {error}"}, 2)

    before = _snapshot(prs.core_properties)
    updates = {
        field: (getattr(args, field) if getattr(args, field) is not None else None)
        for field in FIELDS
        if field != "last_modified_by"
    }
    if args.last_modified_by is not None:
        updates["last_modified_by"] = args.last_modified_by
    requested = {key: value for key, value in updates.items() if value is not None}

    if not requested:
        return _emit(
            {
                "schema": "core_properties/1",
                "ok": True,
                "input": str(source),
                "output": None,
                "before": before,
                "after": before,
                "changed": [],
                "note": "read-only: no property flag was passed",
            }
        )

    for field, value in requested.items():
        setattr(prs.core_properties, field, value)
    prs.core_properties.modified = datetime.now(timezone.utc).replace(tzinfo=None)
    after = _snapshot(prs.core_properties)

    output = Path(args.out) if args.out else source.with_name(f"{source.stem}-edited{source.suffix}")
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        prs.save(str(output))
    except Exception as error:  # noqa: BLE001
        return _emit({"ok": False, "error": f"cannot write {output}: {error}"}, 3)

    return _emit(
        {
            "schema": "core_properties/1",
            "ok": True,
            "input": str(source),
            "output": str(output),
            "before": before,
            "after": after,
            "changed": [key for key, value in requested.items() if before.get(key) != value],
        }
    )


if __name__ == "__main__":
    sys.exit(main())
