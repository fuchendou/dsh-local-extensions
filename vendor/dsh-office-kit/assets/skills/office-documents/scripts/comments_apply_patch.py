#!/usr/bin/env python
"""Edit existing comments in place from a JSON patch file.

The patch is a JSON list (or an object with an ``ops`` list) of operations keyed
by comment id:

    [{"id": 1, "append": "Also check 2024."},
     {"id": 2, "replace": "Rewritten note."},
     {"id": 3, "resolved": true}]

``append`` adds a paragraph, ``replace`` rewrites the body, and ``resolved``
marks the comment done (the threading metadata Word uses for "Resolve").

Exit codes: 0 all operations applied, 1 some ids were missing, 2 bad input.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def set_body(comment, text: str) -> None:
    paragraphs = comment.findall(kit.q("p"))
    if not paragraphs:
        paragraph = etree.SubElement(comment, kit.q("p"))
    else:
        paragraph = paragraphs[0]
        for extra in paragraphs[1:]:
            comment.remove(extra)
    ppr = paragraph.find(kit.q("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = etree.SubElement(paragraph, kit.q("r"))
    node = etree.SubElement(run, kit.q("t"))
    node.text = text
    node.set(kit.q("space", kit.XML), "preserve")


def append_body(comment, text: str) -> None:
    paragraph = etree.SubElement(comment, kit.q("p"))
    run = etree.SubElement(paragraph, kit.q("r"))
    node = etree.SubElement(run, kit.q("t"))
    node.text = text
    node.set(kit.q("space", kit.XML), "preserve")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply append/replace/resolve operations to existing Word comments.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("patch_json", help="JSON patch file")
    parser.add_argument("--out", required=True, help="Output .docx")
    args = parser.parse_args(argv)

    try:
        patch = json.loads(Path(args.patch_json).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print("error: cannot read patch: %s" % exc, file=sys.stderr)
        return 2
    ops = patch.get("ops") if isinstance(patch, dict) else patch
    if not isinstance(ops, list):
        print("error: patch must be a list or an object with an 'ops' list", file=sys.stderr)
        return 2

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    if not doc.exists("word/comments.xml"):
        print("error: document has no comments", file=sys.stderr)
        return 1

    by_id = {node.get(kit.q("id")): node for node in doc.xml("word/comments.xml").findall(kit.q("comment"))}
    applied, missing = [], []
    for op in ops:
        if not isinstance(op, dict):
            print("error: each operation must be an object", file=sys.stderr)
            return 2
        ident = str(op.get("id"))
        comment = by_id.get(ident)
        if comment is None:
            missing.append(ident)
            continue
        changed = []
        if "replace" in op:
            set_body(comment, str(op["replace"]))
            changed.append("replace")
        if "append" in op:
            append_body(comment, str(op["append"]))
            changed.append("append")
        if "resolved" in op:
            if op["resolved"]:
                comment.set(kit.q("done", kit.W15), "1")
            else:
                comment.attrib.pop(kit.q("done", kit.W15), None)
            changed.append("resolved")
        applied.append({"id": ident, "changes": changed})

    doc.save(args.out)
    kit.emit({"ok": not missing, "output": str(Path(args.out)), "applied": applied, "missing_ids": missing})
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
