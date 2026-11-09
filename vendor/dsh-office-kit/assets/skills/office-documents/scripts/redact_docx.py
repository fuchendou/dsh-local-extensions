#!/usr/bin/env python
"""Mask emails, phone numbers and custom patterns in a document's text.

The replacement happens inside individual text runs, so a match split across
formatted runs is not found; that trade keeps the surrounding formatting (bold,
italics, links) untouched.  Length-preserving masking keeps a redacted table
aligned, which is usually why the number of characters matters.

Exit codes: 0 success, 2 bad input.
"""

from __future__ import annotations

import argparse
import re
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

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)(?:\+\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)[\s.\-]?)?\d{2,4}[\s.\-]\d{3,4}(?:[\s.\-]\d{3,4})?(?!\d)")


def redact_text(text: str, patterns: list[re.Pattern], mask: str, preserve: bool) -> tuple[str, int]:
    total = 0
    for pattern in patterns:
        def replace(match: re.Match) -> str:
            nonlocal total
            total += 1
            return (mask * len(match.group(0))) if preserve else mask

        text = pattern.sub(replace, text)
    return text, total


def collect_parts(doc: kit.Docx, include_comments: bool) -> list[str]:
    parts = ["word/document.xml"] + doc.names("word/header") + doc.names("word/footer")
    for note in ("word/footnotes.xml", "word/endnotes.xml"):
        if doc.exists(note):
            parts.append(note)
    if include_comments and doc.exists("word/comments.xml"):
        parts.append("word/comments.xml")
    return parts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mask emails, phone numbers or custom regex matches in text runs.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("output_docx", help="Output .docx")
    parser.add_argument("--emails", action="store_true", help="Redact email addresses (default when no pattern is given)")
    parser.add_argument("--phones", action="store_true", help="Redact phone numbers (default when no pattern is given)")
    parser.add_argument("--pattern", action="append", default=[], help="Extra regex to redact (repeatable)")
    parser.add_argument("--mask_char", default="*", help="Masking character")
    parser.add_argument("--replacement", default="[redacted]", help="Replacement text when length is not preserved")
    parser.add_argument("--no_preserve_length", action="store_true", help="Use --replacement instead of a per-character mask")
    parser.add_argument("--include_comments", action="store_true", help="Also redact comment text")
    args = parser.parse_args(argv)

    patterns: list[re.Pattern] = []
    if args.emails or not (args.emails or args.phones or args.pattern):
        patterns.append(EMAIL)
    if args.phones or not (args.emails or args.phones or args.pattern):
        patterns.append(PHONE)
    for raw in args.pattern:
        try:
            patterns.append(re.compile(raw))
        except re.error as exc:
            print("error: bad --pattern %r: %s" % (raw, exc), file=sys.stderr)
            return 2

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    mask = args.replacement if args.no_preserve_length else (args.mask_char or "*")[:1]
    preserve = not args.no_preserve_length
    matches = 0
    touched_parts = []
    for part in collect_parts(doc, args.include_comments):
        if not doc.exists(part):
            continue
        root = doc.xml(part)
        part_matches = 0
        for node in root.iter(kit.q("t")):
            if not node.text:
                continue
            updated, count = redact_text(node.text, patterns, mask, preserve)
            if count:
                node.text = updated
                part_matches += count
        for node in root.iter(kit.q("delText")):
            if not node.text:
                continue
            updated, count = redact_text(node.text, patterns, mask, preserve)
            if count:
                node.text = updated
                part_matches += count
        if part_matches:
            doc.set_xml(part, root)
            matches += part_matches
            touched_parts.append({"part": part, "matches": part_matches})

    doc.save(args.output_docx)
    kit.emit({"ok": True, "output": str(Path(args.output_docx)), "matches": matches, "patterns": len(patterns), "parts": touched_parts})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
