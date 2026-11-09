#!/usr/bin/env python
"""Undo the heading damage left by importing a document from a web editor.

Imports commonly arrive with a run of empty paragraphs before the body starts and
with the document title duplicated as a level-1 heading, which makes the outline
read "My Doc" twice and pushes the real first section down.  The cleanup only
touches the leading region, so a deliberate title page further in is untouched.

Exit codes: 0 changed or nothing to change, 1 --check found problems, 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def leading_region(body, limit: int) -> list:
    seen = 0
    region = []
    for child in body:
        if child.tag == kit.q("p") and kit.paragraph_text(child).strip():
            seen += 1
            if seen >= limit:
                region.append(child)
                break
        region.append(child)
    return region


def sanitize(body, limit: int) -> dict:
    removed_empty = 0
    removed_duplicate = 0
    region = leading_region(body, limit)
    for paragraph in list(region):
        if paragraph.tag != kit.q("p") or kit.paragraph_text(paragraph).strip():
            continue
        parent = paragraph.getparent()
        if parent is not None:
            parent.remove(paragraph)
            removed_empty += 1

    region = leading_region(body, limit)
    for index, paragraph in enumerate(region):
        if paragraph.tag != kit.q("p") or kit.paragraph_style(paragraph) != "Title":
            continue
        title = kit.paragraph_text(paragraph).strip()
        for follower in region[index + 1 :]:
            if follower.tag != kit.q("p"):
                continue
            text = kit.paragraph_text(follower).strip()
            if not text:
                continue
            if text == title and kit.heading_level(follower) == 1:
                body.remove(follower)
                removed_duplicate += 1
            break
    return {"removed_empty": removed_empty, "removed_duplicate_heading": removed_duplicate}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Remove leading empty paragraphs and a duplicated title heading after import.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("--out", default=None, help="Output .docx")
    parser.add_argument("--in-place", action="store_true", help="Rewrite the input file")
    parser.add_argument("--check", action="store_true", help="Report only; exit 1 when cleanup is needed")
    parser.add_argument("--leading-nonempty-paragraphs", type=int, default=3, help="How far into the document to look")
    args = parser.parse_args(argv)

    if not (args.out or args.in_place or args.check):
        parser.error("choose --out, --in-place or --check")

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    result = sanitize(doc.body(), max(1, args.leading_nonempty_paragraphs))
    changed = bool(result["removed_empty"] or result["removed_duplicate_heading"])

    output = None
    if args.in_place or args.out:
        output = args.out or args.input_docx
        doc.save(output)

    kit.emit({"ok": not (args.check and changed), "changed": changed, "check": args.check, "output": str(Path(output)) if output else None, **result})
    return 1 if (args.check and changed) else 0


if __name__ == "__main__":
    raise SystemExit(main())
