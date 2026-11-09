#!/usr/bin/env python
"""Turn find/replace edits into tracked revisions (delete + insert).

Each ``--replace OLD=NEW`` finds the literal text inside a paragraph and
rewrites just the runs it covers: the old characters become a ``w:del`` and the
new characters a ``w:ins``, both attributed to ``--author``.  Word then shows
the edit as a suggestion instead of an opaque rewrite.  Tracking is switched on
in settings.xml so follow-up edits are recorded too.

Exit codes: 0 success (replacements may still be zero), 1 no replacement matched,
2 bad input or malformed --replace.
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


def split_pair(raw: str) -> tuple[str, str]:
    if "=" not in raw:
        raise argparse.ArgumentTypeError("--replace expects OLD=NEW, got %r" % raw)
    old, new = raw.split("=", 1)
    if not old:
        raise argparse.ArgumentTypeError("--replace needs a non-empty OLD value")
    return old, new


def run_text(run) -> str:
    return kit.text_of(run)


def tracked_replace(paragraph, old: str, new: str, author: str, stamp: str, counter: list[int]) -> bool:
    full = kit.paragraph_text(paragraph)
    start = full.find(old)
    if start < 0:
        return False
    end = start + len(old)
    runs = [child for child in paragraph if child.tag == kit.q("r")]
    if not runs:
        return False

    out: list = []
    deleted: list = []
    insert_at: int | None = None
    cursor = 0
    for run in runs:
        text = run_text(run)
        rpr = run.find(kit.q("rPr"))
        left_end = start
        right_start = end
        run_start, run_end = cursor, cursor + len(text)
        cursor = run_end
        if run_end <= left_end or run_start >= right_start:
            out.append(run)
            continue
        left = text[: max(0, left_end - run_start)]
        middle = text[max(0, left_end - run_start) : min(len(text), right_start - run_start)]
        right = text[min(len(text), right_start - run_start) :]
        if left:
            out.append(kit.make_run(left, rpr))
        if middle:
            if insert_at is None:
                insert_at = len(out)
            deleted.append(kit.make_run(middle, rpr, tag="delText"))
        if right:
            out.append(kit.make_run(right, rpr))

    if not deleted:
        return False

    ident = counter[0]
    counter[0] += 2
    deletion = etree.Element(kit.q("del"))
    deletion.set(kit.q("id"), str(ident))
    deletion.set(kit.q("author"), author)
    deletion.set(kit.q("date"), stamp)
    for node in deleted:
        deletion.append(node)
    insertion = etree.Element(kit.q("ins"))
    insertion.set(kit.q("id"), str(ident + 1))
    insertion.set(kit.q("author"), author)
    insertion.set(kit.q("date"), stamp)
    insertion.append(kit.make_run(new))

    position = insert_at if insert_at is not None else len(out)
    out.insert(position, deletion)
    out.insert(position + 1, insertion)

    ppr = paragraph.find(kit.q("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    for child in out:
        paragraph.append(child)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Record find/replace edits as tracked deletions and insertions.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--author", default="dsh-office", help="Revision author shown in Word")
    parser.add_argument("--replace", action="append", default=[], help="Replacement formatted as OLD=NEW (repeatable)")
    parser.add_argument("--date", default=None, help="ISO timestamp for the revisions (default: now, UTC)")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    if not args.replace:
        parser.error("at least one --replace OLD=NEW is required")

    stamp = args.date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    counter = [doc.next_id()]
    applied = []
    for raw in args.replace:
        try:
            old, new = split_pair(raw)
        except argparse.ArgumentTypeError as exc:
            print("error: %s" % exc, file=sys.stderr)
            return 2
        hits = 0
        for part in doc.text_parts():
            for paragraph in doc.paragraphs(part):
                if tracked_replace(paragraph, old, new, args.author, stamp, counter):
                    hits += 1
        applied.append({"old": old, "new": new, "paragraphs": hits})

    settings = doc.xml("word/settings.xml")
    if settings.find(kit.q("trackRevisions")) is None:
        settings.append(settings.makeelement(kit.q("trackRevisions"), {}))

    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "author": args.author, "replacements": applied})
    return 0 if any(item["paragraphs"] for item in applied) else 1


if __name__ == "__main__":
    raise SystemExit(main())
