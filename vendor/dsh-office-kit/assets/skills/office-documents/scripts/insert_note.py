#!/usr/bin/env python
"""Insert a real footnote or endnote at a text marker.

Word stores notes outside the body: the paragraph keeps a small reference run
and the note text goes in footnotes.xml/endnotes.xml.  This script creates that
part when absent (including the required separator notes), allocates the next
id, and replaces the marker run with the reference at the exact position.

Exit codes: 0 success, 1 marker not found, 2 bad input.
"""

from __future__ import annotations

import argparse
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

PARTS = {"footnote": ("word/footnotes.xml", "footnotes", "footnote", kit.REL_FOOTNOTES), "endnote": ("word/endnotes.xml", "endnotes", "endnote", kit.REL_ENDNOTES)}


def note_part(doc: kit.Docx, kind: str):
    part, collection, item, rel_type = PARTS[kind]
    if not doc.exists(part):
        root = etree.Element(kit.q(collection), nsmap={"w": kit.W, "r": kit.R})
        for ident, note_kind in ((-1, "separator"), (0, "continuationSeparator")):
            note = etree.SubElement(root, kit.q(item))
            note.set(kit.q("type"), note_kind)
            note.set(kit.q("id"), str(ident))
            paragraph = etree.SubElement(note, kit.q("p"))
            run = etree.SubElement(paragraph, kit.q("r"))
            etree.SubElement(run, kit.q(note_kind))
        doc.set_xml(part, root)
        doc.ensure_override(part, kit.CT_BY_REL[rel_type])
        doc.ensure_rel("word/document.xml", rel_type, part.split("/")[-1])
    return doc.xml(part), item


def append_note(root, item: str, ident: int, text: str) -> None:
    note = etree.SubElement(root, kit.q(item))
    note.set(kit.q("id"), str(ident))
    paragraph = etree.SubElement(note, kit.q("p"))
    ppr = etree.SubElement(paragraph, kit.q("pPr"))
    etree.SubElement(ppr, kit.q("pStyle")).set(kit.q("val"), "FootnoteText")
    run = etree.SubElement(paragraph, kit.q("r"))
    rpr = etree.SubElement(run, kit.q("rPr"))
    etree.SubElement(rpr, kit.q("rStyle")).set(kit.q("val"), "FootnoteReference")
    node = etree.SubElement(run, kit.q("t"))
    node.text = text
    node.set(kit.q("space"), "preserve")


def reference_run(kind: str, ident: int):
    run = etree.Element(kit.q("r"))
    rpr = etree.SubElement(run, kit.q("rPr"))
    etree.SubElement(rpr, kit.q("rStyle")).set(kit.q("val"), "FootnoteReference")
    reference = etree.SubElement(run, kit.q(kind + "Reference"))
    reference.set(kit.q("id"), str(ident))
    return run


def place_reference(paragraph, marker: str, kind: str, ident: int) -> bool:
    for run in paragraph.iter(kit.q("r")):
        text = "".join(node.text or "" for node in run.findall(kit.q("t")))
        if marker not in text:
            continue
        before, after = text.split(marker, 1)
        rpr = run.find(kit.q("rPr"))
        parent = run.getparent()
        position = parent.index(run)
        parent.remove(run)
        pieces = []
        if before:
            pieces.append(kit.make_run(before, etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
        pieces.append(reference_run(kind, ident))
        if after:
            pieces.append(kit.make_run(after, etree.fromstring(etree.tostring(rpr)) if rpr is not None else None))
        for offset, piece in enumerate(pieces):
            parent.insert(position + offset, piece)
        return True
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Insert a true footnote or endnote at a [[NOTE]]-style marker.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--kind", required=True, choices=["footnote", "endnote"])
    parser.add_argument("--text", required=True, help="Note body")
    parser.add_argument("--marker", default="[[NOTE]]", help="Text token that marks the anchor")
    parser.add_argument("--out", required=True, help="Output .docx")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    target = None
    for paragraph in doc.paragraphs():
        if args.marker in "".join(node.text or "" for node in paragraph.iter(kit.q("t"))):
            target = paragraph
            break
    if target is None:
        print("error: marker %r not found" % args.marker, file=sys.stderr)
        return 1

    root, item = note_part(doc, args.kind)
    existing = [int(node.get(kit.q("id")) or 0) for node in root.findall(kit.q(item))]
    ident = max(existing + [0]) + 1
    if not place_reference(target, args.marker, args.kind, ident):
        print("error: could not split the marker run", file=sys.stderr)
        return 1
    append_note(root, item, ident, args.text)

    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "kind": args.kind, "id": ident, "text": args.text})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
