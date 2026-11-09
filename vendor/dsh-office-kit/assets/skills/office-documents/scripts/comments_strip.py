#!/usr/bin/env python
"""Remove every comment from a .docx: markers, bodies, relationships, part.

Word needs all four removed together.  Leaving a stray ``commentReference``
behind makes Word report a corrupt package, and leaving comments.xml in the zip
re-adds metadata you thought you deleted, so each is handled here.

Exit codes: 0 success (also when there was nothing to strip), 2 bad input.
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

MARKERS = ("commentRangeStart", "commentRangeEnd", "commentReference")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Strip all comments and comment markers from a .docx.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    hf = [name for name in doc.names("word/header") + doc.names("word/footer") if name.endswith(".xml") and "_rels" not in name]
    removed_markers = 0
    for part in ["word/document.xml"] + hf + doc.text_parts():
        if not doc.exists(part):
            continue
        root = doc.xml(part)
        for local in MARKERS:
            for node in list(root.iter(kit.q(local))):
                parent = node.getparent()
                if parent is None:
                    continue
                if local == "commentReference" and parent.tag == kit.q("r") and len(parent) <= 1:
                    grand = parent.getparent()
                    if grand is not None:
                        grand.remove(parent)
                else:
                    parent.remove(node)
                removed_markers += 1

    had_part = doc.exists("word/comments.xml")
    if had_part:
        doc.drop("word/comments.xml")
        doc.drop_rel_target("word/document.xml", "word/comments.xml")
        doc.drop_override("word/comments.xml")

    doc.save(args.out)
    kit.emit(
        {
            "ok": True,
            "input": str(Path(args.in_docx)),
            "output": str(Path(args.out)),
            "comments_part_removed": had_part,
            "markers_removed": removed_markers,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
