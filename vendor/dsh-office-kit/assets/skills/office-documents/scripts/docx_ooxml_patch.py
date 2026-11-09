#!/usr/bin/env python
"""Escape hatch for WordprocessingML features python-docx does not expose.

One invocation may combine several patches, which is what makes it useful for
finishing a document in one pass:

  --enable-track                 switch on revisions
  --tracked-replace-ins-id ID    turn an insertion into delete + insert
  --add-comment --comment-text   attach a comment to the first matching paragraph
  --header-date TEXT             set a right-aligned first-header line
  --add-page-numbers             centered PAGE field in the footer
  --hyperlink-first URL          wrap the first text paragraph in a hyperlink

Exit codes: 0 success, 1 requested target not found, 2 bad input.
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

PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"


def stamp(args) -> str:
    return args.date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def enable_track(doc: kit.Docx) -> str:
    settings = doc.xml("word/settings.xml")
    if settings.find(kit.q("trackRevisions")) is None:
        settings.append(settings.makeelement(kit.q("trackRevisions"), {}))
    return "trackRevisions enabled"


def tracked_replace(doc: kit.Docx, ins_id: str, new_text: str, author: str, date: str) -> str:
    for part in doc.text_parts():
        for node in doc.xml(part).iter(kit.q("ins")):
            if (node.get(kit.q("id")) or "") != str(ins_id):
                continue
            parent = node.getparent()
            ident = doc.next_id()
            deletion = etree.Element(kit.q("del"))
            deletion.set(kit.q("id"), str(ident))
            deletion.set(kit.q("author"), author)
            deletion.set(kit.q("date"), date)
            for child in list(node):
                clone = etree.fromstring(etree.tostring(child))
                for text in clone.iter(kit.q("t")):
                    text.tag = kit.q("delText")
                deletion.append(clone)
            insertion = etree.Element(kit.q("ins"))
            insertion.set(kit.q("id"), str(ident + 1))
            insertion.set(kit.q("author"), author)
            insertion.set(kit.q("date"), date)
            insertion.append(kit.make_run(new_text))
            position = parent.index(node)
            parent.remove(node)
            parent.insert(position, deletion)
            parent.insert(position + 1, insertion)
            return "converted ins %s to del+ins in %s" % (ins_id, part)
    return ""


def find_paragraph(doc: kit.Docx, contains: str | None, indent: int | None):
    for paragraph in doc.paragraphs():
        props = paragraph.find(kit.q("pPr"))
        if contains is not None and contains not in kit.paragraph_text(paragraph):
            continue
        if indent is not None:
            ind = props.find(kit.q("ind")) if props is not None else None
            if ind is None or (ind.get(kit.q("left")) or "") != str(indent):
                continue
        return paragraph
    return None


def add_comment(doc: kit.Docx, paragraph, text: str, author: str, date: str, explicit_id: str | None) -> str:
    if not doc.exists("word/comments.xml"):
        root = etree.Element(kit.q("comments"), nsmap={"w": kit.W, "r": kit.R})
        doc.set_xml("word/comments.xml", root)
        doc.ensure_override("word/comments.xml", kit.CT_BY_REL[kit.REL_COMMENTS])
        doc.ensure_rel("word/document.xml", kit.REL_COMMENTS, "comments.xml")
    root = doc.xml("word/comments.xml")
    ident = int(explicit_id) if explicit_id and explicit_id.isdigit() else doc.next_id()
    comment = etree.SubElement(root, kit.q("comment"))
    comment.set(kit.q("id"), str(ident))
    comment.set(kit.q("author"), author)
    comment.set(kit.q("initials"), author[:2].upper())
    comment.set(kit.q("date"), date)
    body = etree.SubElement(comment, kit.q("p"))
    run = etree.SubElement(body, kit.q("r"))
    node = etree.SubElement(run, kit.q("t"))
    node.text = text
    node.set(kit.q("space"), kit.XML)

    start = etree.Element(kit.q("commentRangeStart"))
    start.set(kit.q("id"), str(ident))
    position = 1 if paragraph.find(kit.q("pPr")) is not None else 0
    paragraph.insert(position, start)
    end = etree.SubElement(paragraph, kit.q("commentRangeEnd"))
    end.set(kit.q("id"), str(ident))
    ref_run = etree.SubElement(paragraph, kit.q("r"))
    etree.SubElement(ref_run, kit.q("commentReference")).set(kit.q("id"), str(ident))
    return "comment %d anchored" % ident


def header_date(doc: kit.Docx, text: str) -> str:
    part = doc.ensure_header_footer("header")
    paragraph = doc.xml(part).find(".//" + kit.q("p"))
    if paragraph is None:
        paragraph = etree.SubElement(doc.xml(part), kit.q("p"))
    props = paragraph.find(kit.q("pPr"))
    if props is None:
        props = etree.Element(kit.q("pPr"))
        paragraph.insert(0, props)
    for existing in props.findall(kit.q("jc")):
        props.remove(existing)
    etree.SubElement(props, kit.q("jc")).set(kit.q("val"), "right")
    kit.set_paragraph_text(paragraph, text)
    return "header set in %s" % part


def page_numbers(doc: kit.Docx) -> str:
    part = doc.ensure_header_footer("footer")
    paragraph = doc.xml(part).find(".//" + kit.q("p"))
    if paragraph is None:
        paragraph = etree.SubElement(doc.xml(part), kit.q("p"))
    props = paragraph.find(kit.q("pPr"))
    if props is None:
        props = etree.Element(kit.q("pPr"))
        paragraph.insert(0, props)
    etree.SubElement(props, kit.q("jc")).set(kit.q("val"), "center")
    for run in kit.field_runs("PAGE", "1"):
        paragraph.append(run)
    return "PAGE field added to %s" % part


def hyperlink_first(doc: kit.Docx, url: str) -> str:
    for paragraph in doc.paragraphs():
        runs = [child for child in paragraph if child.tag == kit.q("r") and kit.text_of(child).strip()]
        if not runs:
            continue
        rid = doc.ensure_rel("word/document.xml", REL_HYPERLINK, url, external=True)
        link = etree.Element(kit.q("hyperlink"))
        link.set(kit.q("id", kit.R), rid)
        position = paragraph.index(runs[0])
        for run in runs:
            paragraph.remove(run)
            link.append(run)
        paragraph.insert(position, link)
        return "wrapped %d run(s) in hyperlink %s" % (len(runs), url)
    return ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply targeted OOXML patches that python-docx cannot express.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--out", default=None, help="Output .docx (default: overwrite the input)")
    parser.add_argument("--enable-track", action="store_true")
    parser.add_argument("--author", default="dsh-office")
    parser.add_argument("--date", default=None, help="ISO timestamp for revisions and comments")
    parser.add_argument("--tracked-replace-ins-id", default=None)
    parser.add_argument("--new-text", default="")
    parser.add_argument("--add-comment", action="store_true")
    parser.add_argument("--comment-text", default="")
    parser.add_argument("--contains", default=None, help="Target paragraph containing this text")
    parser.add_argument("--indent-left-twips", type=int, default=None, help="Target paragraph with this left indent")
    parser.add_argument("--comment-id", default=None)
    parser.add_argument("--header-date", nargs="?", const="auto", default=None, help="Right-aligned header line; omit the value to use today's date")
    parser.add_argument("--add-page-numbers", action="store_true")
    parser.add_argument("--hyperlink-first", default=None)
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    actions = []
    missing = []
    when = stamp(args)

    if args.enable_track:
        actions.append(enable_track(doc))
    if args.tracked_replace_ins_id is not None:
        result = tracked_replace(doc, args.tracked_replace_ins_id, args.new_text, args.author, when)
        actions.append(result) if result else missing.append("ins id %s" % args.tracked_replace_ins_id)
    if args.add_comment:
        paragraph = find_paragraph(doc, args.contains, args.indent_left_twips)
        if paragraph is None:
            missing.append("paragraph for --add-comment")
        else:
            actions.append(add_comment(doc, paragraph, args.comment_text, args.author, when, args.comment_id))
    if args.header_date is not None:
        from datetime import date

        stamp_text = date.today().isoformat() if args.header_date == "auto" else args.header_date
        actions.append(header_date(doc, stamp_text))
    if args.add_page_numbers:
        actions.append(page_numbers(doc))
    if args.hyperlink_first:
        result = hyperlink_first(doc, args.hyperlink_first)
        actions.append(result) if result else missing.append("paragraph for --hyperlink-first")

    if not actions and not missing:
        parser.error("no patch requested")

    out = args.out or args.docx
    doc.save(out)
    kit.emit({"ok": not missing, "output": str(Path(out)), "actions": actions, "missing": missing})
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
