#!/usr/bin/env python
"""Read or edit Word content controls (structured document tags / SDT).

python-docx has no API for content controls, so this works directly on the
``w:sdt`` elements: list them, wrap a paragraph into a typed control, or replace
the text of controls matched by tag.  Tags are the stable key — they survive
copying between documents better than the numeric ids.

Exit codes: 0 success, 1 a tag was not found, 2 bad input or bad subcommand.
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

TYPE_TAGS = ("text", "richText", "date", "dropDownList", "comboBox", "picture", "checkbox")
CONTAINER_TAGS = ("docPartObj", "group", "citation", "bibliography")


def part_list(doc: kit.Docx, include_headers: bool) -> list[str]:
    parts = ["word/document.xml"]
    if include_headers:
        parts += [name for name in doc.names("word/header") + doc.names("word/footer") if name.endswith(".xml") and "_rels" not in name]
    return [part for part in parts if doc.exists(part)]


def controls(doc: kit.Docx, part: str):
    return [node for node in doc.xml(part).iter(kit.q("sdt")) if node.find(kit.q("sdtPr")) is not None]


def describe(doc: kit.Docx, part: str, sdt) -> dict:
    props = sdt.find(kit.q("sdtPr"))
    tag = props.find(kit.q("tag")) if props is not None else None
    alias = props.find(kit.q("alias")) if props is not None else None
    ident = props.find(kit.q("id")) if props is not None else None
    kind = "unknown"
    if props is not None:
        for name in TYPE_TAGS:
            if props.find(kit.q(name)) is not None:
                kind = name
                break
        if kind == "unknown" and any(props.find(kit.q(name)) is not None for name in CONTAINER_TAGS):
            kind = "container"
    content = sdt.find(kit.q("sdtContent"))
    text = kit.text_of(content) if content is not None else ""
    return {
        "part": part,
        "tag": tag.get(kit.q("val")) if tag is not None else "",
        "alias": alias.get(kit.q("val")) if alias is not None else "",
        "id": ident.get(kit.q("val")) if ident is not None else "",
        "type": kind,
        "text": text,
    }


def build_control(tag: str, alias: str, text: str, ident: int, content) -> etree._Element:
    sdt = etree.Element(kit.q("sdt"))
    props = etree.SubElement(sdt, kit.q("sdtPr"))
    if tag:
        etree.SubElement(props, kit.q("tag")).set(kit.q("val"), tag)
    if alias:
        etree.SubElement(props, kit.q("alias")).set(kit.q("val"), alias)
    etree.SubElement(props, kit.q("id")).set(kit.q("val"), str(ident))
    etree.SubElement(props, kit.q("text"))
    body = etree.SubElement(sdt, kit.q("sdtContent"))
    if content is not None:
        body.append(content)
    else:
        paragraph = etree.SubElement(body, kit.q("p"))
        run = etree.SubElement(paragraph, kit.q("r"))
        node = etree.SubElement(run, kit.q("t"))
        node.text = text
    return sdt


def replace_text(sdt, value: str) -> bool:
    content = sdt.find(kit.q("sdtContent"))
    if content is None:
        return False
    paragraphs = list(content.iter(kit.q("p")))
    if not paragraphs:
        return False
    paragraph = paragraphs[0]
    for extra in paragraphs[1:]:
        parent = extra.getparent()
        if parent is not None:
            parent.remove(extra)
    ppr = paragraph.find(kit.q("pPr"))
    for child in list(paragraph):
        if child is not ppr:
            paragraph.remove(child)
    run = etree.SubElement(paragraph, kit.q("r"))
    node = etree.SubElement(run, kit.q("t"))
    node.text = value
    node.set(kit.q("space"), kit.XML)
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List, create, or fill Word content controls (SDTs).")
    sub = parser.add_subparsers(dest="command", required=True)

    listing = sub.add_parser("list", help="list content controls")
    listing.add_argument("docx")
    listing.add_argument("--json", action="store_true", help="emit JSON (always on; kept for scripts)")
    listing.add_argument("--no_headers_footers", action="store_true")

    create = sub.add_parser("create", help="wrap a paragraph or add a new control")
    create.add_argument("docx")
    create.add_argument("--tag", default="", help="Stable tag used by later edits")
    create.add_argument("--alias", default="", help="Display name shown in Word")
    create.add_argument("--text", default="", help="Initial value for a new control")
    create.add_argument("--placeholder", default="", help="Wrap the paragraph containing this text instead of adding a new control")
    create.add_argument("--output", required=True)
    create.add_argument("--no_headers_footers", action="store_true")

    update = sub.add_parser("set", help="fill controls by tag")
    update.add_argument("docx")
    update.add_argument("--set", action="append", default=[], help="TAG=VALUE (repeatable)")
    update.add_argument("--output", required=True)
    update.add_argument("--no_headers_footers", action="store_true")

    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    if args.command == "list":
        rows = []
        for part in part_list(doc, not args.no_headers_footers):
            for sdt in controls(doc, part):
                rows.append(describe(doc, part, sdt))
        kit.emit({"ok": True, "input": str(Path(args.docx)), "count": len(rows), "controls": rows})
        return 0

    if args.command == "set":
        if not args.set:
            parser.error("at least one --set TAG=VALUE is required")
        wanted = {}
        for raw in args.set:
            if "=" not in raw:
                parser.error("--set expects TAG=VALUE, got %r" % raw)
            tag, value = raw.split("=", 1)
            wanted[tag] = value
        filled, missing = [], []
        for part in part_list(doc, not args.no_headers_footers):
            for sdt in controls(doc, part):
                info = describe(doc, part, sdt)
                if info["tag"] in wanted and replace_text(sdt, wanted[info["tag"]]):
                    filled.append({"tag": info["tag"], "value": wanted[info["tag"]], "part": part})
                    wanted.pop(info["tag"], None)
        missing = sorted(wanted)
        doc.save(args.output)
        kit.emit({"ok": not missing, "output": str(Path(args.output)), "filled": filled, "missing_tags": missing})
        return 1 if missing else 0

    ident = doc.next_id()
    if args.placeholder:
        target = None
        for paragraph in doc.paragraphs():
            if args.placeholder in kit.paragraph_text(paragraph):
                target = paragraph
                break
        if target is None:
            print("error: placeholder %r not found" % args.placeholder, file=sys.stderr)
            return 1
        parent = target.getparent()
        index = list(parent).index(target)
        sdt = build_control(args.tag, args.alias, args.text, ident, target)
        parent.insert(index, sdt)
        where = "wrapped"
    else:
        sdt = build_control(args.tag, args.alias, args.text, ident, None)
        doc.body().append(sdt)
        where = "appended"
    doc.save(args.output)
    kit.emit({"ok": True, "output": str(Path(args.output)), "mode": where, "tag": args.tag, "id": ident})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
