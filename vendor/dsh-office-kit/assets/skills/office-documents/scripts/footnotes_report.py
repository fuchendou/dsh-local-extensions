#!/usr/bin/env python
"""Report footnotes and endnotes stored in a .docx.

Real notes are not footer text: they live in word/footnotes.xml or
word/endnotes.xml, and the body only carries a reference run.  This script
prints every note with its id, kind and text, plus how many references the body
makes, which is how you catch notes that were orphaned by an edit.

Exit codes: 0 success, 2 bad input.
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

PARTS = {"footnote": "word/footnotes.xml", "endnote": "word/endnotes.xml"}
SEPARATOR_TYPES = {"separator", "continuationSeparator", "continuationNotice"}


def collect(doc: kit.Docx, kind: str) -> list[dict]:
    part = PARTS[kind]
    if not doc.exists(part):
        return []
    notes = []
    for node in doc.xml(part).iter(kit.q(kind)):
        note_type = node.get(kit.q("type")) or "normal"
        if note_type in SEPARATOR_TYPES:
            continue
        paragraphs = [kit.text_of(paragraph).strip() for paragraph in node.iter(kit.q("p"))]
        notes.append(
            {
                "kind": kind,
                "id": node.get(kit.q("id")),
                "text": " ".join(text for text in paragraphs if text),
                "empty": not any(text for text in paragraphs),
            }
        )
    return notes


def references(doc: kit.Docx, kind: str) -> list[str]:
    return [node.get(kit.q("id")) for node in doc.xml("word/document.xml").iter(kit.q(kind + "Reference"))]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report footnote/endnote content and reference counts in a .docx.")
    parser.add_argument("docx", help="Input .docx")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    payload = {"ok": True, "input": str(Path(args.docx)), "notes": {}, "references": {}, "orphans": {}}
    for kind in ("footnote", "endnote"):
        notes = collect(doc, kind)
        refs = references(doc, kind)
        ids = {note["id"] for note in notes}
        payload["notes"][kind] = notes
        payload["references"][kind] = {"count": len(refs), "ids": refs}
        payload["orphans"][kind] = {
            "unreferenced_notes": sorted(ids - set(refs), key=lambda value: int(value) if (value or "").lstrip("-").isdigit() else 0),
            "dangling_references": [value for value in refs if value not in ids],
        }
    kit.emit(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
