#!/usr/bin/env python
"""Report, accept, or reject tracked revisions in a .docx.

Revision marks live inline in the WordprocessingML: ``w:ins`` wraps content that
was added, ``w:del`` wraps content that was removed, and paragraph-mark changes
sit in ``w:rPrChange``/``w:pPrChange``.  Accepting keeps inserted content and
drops deleted content; rejecting does the reverse.  Format-only revisions are
reported but always dropped because they carry no text.

Exit codes: 0 success, 1 nothing to report while --mode report, 2 bad input.
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

REVISION_TAGS = {
    "ins": "insertion",
    "del": "deletion",
    "moveFrom": "move_from",
    "moveTo": "move_to",
    "rPrChange": "format_change",
    "pPrChange": "format_change",
    "sectPrChange": "format_change",
    "tblPrChange": "format_change",
    "trPrChange": "format_change",
    "tcPrChange": "format_change",
}
REMOVABLE_TEXT_TAGS = ("ins", "del", "moveFrom", "moveTo")


def scan(doc: kit.Docx) -> list[dict]:
    rows = []
    for part in doc.text_parts():
        for node in doc.xml(part).iter():
            if not isinstance(node.tag, str) or not node.tag.startswith("{%s}" % kit.W):
                continue
            local = node.tag.split("}", 1)[1]
            if local not in REVISION_TAGS:
                continue
            rows.append(
                {
                    "part": part,
                    "type": REVISION_TAGS[local],
                    "author": node.get(kit.q("author")) or "",
                    "date": node.get(kit.q("date")) or "",
                    "id": node.get(kit.q("id")) or "",
                    "text": kit.text_of(node)[:120],
                }
            )
    return rows


def unwrap(node) -> None:
    parent = node.getparent()
    if parent is None:
        return
    index = parent.index(node)
    for child in list(node):
        parent.insert(index, child)
        index += 1
    parent.remove(node)


def convert_deleted_text(node) -> None:
    for del_text in list(node.iter(kit.q("delText"))):
        del_text.tag = kit.q("t")


def apply(doc: kit.Docx, mode: str) -> int:
    """Apply accept or reject across every text-bearing part."""
    touched = 0
    for part in doc.text_parts():
        root = doc.xml(part)
        nodes = [node for node in root.iter() if isinstance(node.tag, str) and node.tag.startswith("{%s}" % kit.W) and node.tag.split("}", 1)[1] in REMOVABLE_TEXT_TAGS]
        for node in reversed(nodes):
            local = node.tag.split("}", 1)[1]
            keep = (local in ("ins", "moveTo")) == (mode == "accept")
            if keep:
                if local == "del" or local == "moveFrom":
                    convert_deleted_text(node)
                unwrap(node)
            else:
                parent = node.getparent()
                if parent is not None:
                    parent.remove(node)
            touched += 1
        # Paragraph-mark revisions have no text: drop them either way so a
        # reopened document no longer claims to be dirty.
        for local in ("rPrChange", "pPrChange", "sectPrChange", "tblPrChange", "trPrChange", "tcPrChange"):
            for node in list(root.iter(kit.q(local))):
                parent = node.getparent()
                if parent is not None:
                    parent.remove(node)
                    touched += 1
    return touched


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report, accept, or reject tracked changes in a .docx.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--mode", required=True, choices=["report", "accept", "reject"])
    parser.add_argument("--out", help="Output .docx (required for accept/reject)")
    parser.add_argument("--keep_tracking_on", action="store_true", help="Leave the track-revisions flag enabled in settings.xml")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    revisions = scan(doc)
    counts: dict[str, int] = {}
    for row in revisions:
        counts[row["type"]] = counts.get(row["type"], 0) + 1

    if args.mode == "report":
        kit.emit({"ok": True, "input": str(Path(args.in_docx)), "total": len(revisions), "counts": counts, "revisions": revisions})
        return 0 if revisions else 1

    if not args.out:
        parser.error("--out is required for accept/reject")
    touched = apply(doc, args.mode)

    settings = doc.xml("word/settings.xml")
    if not args.keep_tracking_on:
        for node in list(settings.iter(kit.q("trackRevisions"))):
            settings.remove(node)

    doc.save(args.out)
    kit.emit(
        {
            "ok": True,
            "mode": args.mode,
            "output": str(Path(args.out)),
            "revisions_seen": len(revisions),
            "nodes_rewritten": touched,
            "counts": counts,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
