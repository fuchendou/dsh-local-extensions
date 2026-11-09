#!/usr/bin/env python
"""Attach Word comments to the paragraphs that contain given text.

Each ``--add "needle=comment body"`` anchors a comment over the first paragraph
whose text contains ``needle``: range start, range end and the reference run are
inserted inline, and the comment body is appended to comments.xml.  Nothing is
reworded; the body is exactly the text you pass.

Exit codes: 0 all comments placed, 1 a pattern matched nothing (with
--require_all nothing is written), 2 bad input.
"""

from __future__ import annotations

import argparse
import datetime
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


def comments_root(doc: kit.Docx):
    if not doc.exists("word/comments.xml"):
        root = etree.Element(kit.q("comments"), nsmap={"w": kit.W, "r": kit.R})
        doc.set_xml("word/comments.xml", root)
        doc.ensure_override("word/comments.xml", kit.CT_BY_REL[kit.REL_COMMENTS])
        doc.ensure_rel("word/document.xml", kit.REL_COMMENTS, "comments.xml")
    return doc.xml("word/comments.xml")


def initials(name: str) -> str:
    parts = [piece for piece in name.replace(".", " ").split() if piece]
    return "".join(piece[0] for piece in parts)[:3].upper() or "OR"


def append_comment(root, text: str, author: str, stamp: str, ident: int) -> None:
    comment = etree.SubElement(root, kit.q("comment"))
    comment.set(kit.q("id"), str(ident))
    comment.set(kit.q("author"), author)
    comment.set(kit.q("initials"), initials(author))
    comment.set(kit.q("date"), stamp)
    paragraph = etree.SubElement(comment, kit.q("p"))
    run = etree.SubElement(paragraph, kit.q("r"))
    node = etree.SubElement(run, kit.q("t"))
    node.text = text
    node.set(kit.q("space", kit.XML), "preserve")


def anchor(paragraph, ident: int) -> None:
    start = etree.Element(kit.q("commentRangeStart"))
    start.set(kit.q("id"), str(ident))
    position = 1 if paragraph.find(kit.q("pPr")) is not None else 0
    paragraph.insert(position, start)
    end = etree.SubElement(paragraph, kit.q("commentRangeEnd"))
    end.set(kit.q("id"), str(ident))
    run = etree.SubElement(paragraph, kit.q("r"))
    ref = etree.SubElement(run, kit.q("commentReference"))
    ref.set(kit.q("id"), str(ident))


def parse_add(raw: str) -> tuple[str, str]:
    if "=" not in raw:
        raise ValueError("--add expects NEEDLE=COMMENT, got %r" % raw)
    needle, body = raw.split("=", 1)
    if not needle or not body:
        raise ValueError("--add needs a non-empty needle and comment")
    return needle, body


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Add Word comments over paragraphs matched by substring.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--author", default="dsh-office", help="Comment author")
    parser.add_argument("--add", action="append", default=[], help="NEEDLE=COMMENT (repeatable)")
    parser.add_argument("--ignore_case", action="store_true", help="Match needle case-insensitively")
    parser.add_argument("--require_all", action="store_true", help="Fail without writing if any needle is absent")
    parser.add_argument("--date", default=None, help="ISO timestamp for the comments (default: now, UTC)")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    if not args.add:
        parser.error("at least one --add NEEDLE=COMMENT is required")

    paragraphs = doc.paragraphs()
    requests = []
    for raw in args.add:
        try:
            needle, body = parse_add(raw)
        except ValueError as exc:
            print("error: %s" % exc, file=sys.stderr)
            return 2
        target = None
        for paragraph in paragraphs:
            haystack = kit.paragraph_text(paragraph)
            if (needle.lower() in haystack.lower()) if args.ignore_case else (needle in haystack):
                target = paragraph
                break
        requests.append({"needle": needle, "body": body, "paragraph": target})

    missing = [item["needle"] for item in requests if item["paragraph"] is None]
    if missing and args.require_all:
        kit.emit({"ok": False, "output": None, "matched": 0, "missing": missing})
        return 1

    stamp = args.date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    root = comments_root(doc)
    ident = doc.next_id()
    placed = []
    for item in requests:
        if item["paragraph"] is None:
            continue
        append_comment(root, item["body"], args.author, stamp, ident)
        anchor(item["paragraph"], ident)
        placed.append({"id": ident, "needle": item["needle"], "body": item["body"]})
        ident += 1

    if not placed:
        kit.emit({"ok": False, "output": None, "matched": 0, "missing": missing})
        return 1

    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "author": args.author, "placed": placed, "missing": missing})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
