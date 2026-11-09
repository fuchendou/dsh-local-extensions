#!/usr/bin/env python
"""Accessibility audit for a .docx, with two safe repair switches.

Checks images for missing alternative text, tables for a repeating header row,
heading runs for skipped levels, links for vague link text, and the package for
a document title.  Repairs are opt-in and never guess at meaning: alt text is
derived from the image file name and table headers come from the first row.

Exit codes: 0 clean (or all findings repaired), 1 findings remain, 2 bad input.
"""

from __future__ import annotations

import argparse
import posixpath
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

GENERIC_LINK_TEXT = {"click here", "here", "link", "this link", "read more"}
DETAIL_PARTS = ("word/document.xml", "word/header1.xml", "word/footer1.xml")


def header_footer_parts(doc: kit.Docx) -> list[str]:
    names = doc.names("word/header") + doc.names("word/footer")
    return [name for name in names if name.endswith(".xml") and "_rels" not in name]


def scan_images(doc: kit.Docx) -> list[dict]:
    findings = []
    for part in ["word/document.xml"] + header_footer_parts(doc):
        if not doc.exists(part):
            continue
        rels = {rel["id"]: rel for rel in doc.relationships(part)}
        for docpr in doc.xml(part).iter(kit.q("docPr", kit.WP)):
            blip = docpr.getparent().find(".//" + kit.q("blip", kit.A))
            rid = blip.get(kit.q("embed", kit.R)) if blip is not None else None
            target = rels.get(rid, {}).get("resolved", "")
            alt = (docpr.get("descr") or docpr.get("title") or "").strip()
            findings.append(
                {
                    "code": "image_missing_alt",
                    "part": part,
                    "name": docpr.get("name"),
                    "target": target,
                    "ok": bool(alt),
                }
            )
    return findings


def scan_tables(doc: kit.Docx) -> list[dict]:
    findings = []
    for index, table in enumerate(doc.xml("word/document.xml").iter(kit.q("tbl"))):
        rows = table.findall(kit.q("tr"))
        if not rows:
            continue
        props = rows[0].find(kit.q("trPr"))
        repeat = props is not None and props.find(kit.q("tblHeader")) is not None
        findings.append(
            {
                "code": "table_missing_header_row",
                "table_index": index,
                "rows": len(rows),
                "ok": repeat,
                "style": (table.find(kit.q("tblPr")).find(kit.q("tblStyle")).get(kit.q("val")) if table.find(kit.q("tblPr")) is not None and table.find(kit.q("tblPr")).find(kit.q("tblStyle")) is not None else ""),
            }
        )
    return findings


def scan_headings(doc: kit.Docx) -> list[dict]:
    findings = []
    previous = 0
    for index, paragraph in enumerate(doc.paragraphs()):
        level = kit.heading_level(paragraph)
        if not level:
            continue
        text = kit.paragraph_text(paragraph).strip()
        if previous and level > previous + 1:
            findings.append({"code": "heading_level_jump", "paragraph": index, "from": previous, "to": level, "text": text, "ok": False})
        if not text:
            findings.append({"code": "empty_heading", "paragraph": index, "level": level, "ok": False})
        previous = level
    return findings


def scan_links(doc: kit.Docx) -> list[dict]:
    findings = []
    for part in ["word/document.xml"] + header_footer_parts(doc):
        if not doc.exists(part):
            continue
        for link in doc.xml(part).iter(kit.q("hyperlink")):
            text = kit.text_of(link).strip().lower()
            if not text:
                findings.append({"code": "empty_link", "part": part, "ok": False})
            elif text in GENERIC_LINK_TEXT:
                findings.append({"code": "vague_link_text", "part": part, "text": text, "ok": False})
    return findings


def scan_title(doc: kit.Docx) -> list[dict]:
    if not doc.exists("docProps/core.xml"):
        return [{"code": "missing_document_title", "ok": False}]
    core = doc.xml("docProps/core.xml")
    title = core.find("{http://purl.org/dc/elements/1.1/}title")
    text = (title.text or "").strip() if title is not None else ""
    return [{"code": "missing_document_title", "ok": bool(text)}] if not text else []


def fix_alt_text(doc: kit.Docx) -> int:
    changed = 0
    for part in ["word/document.xml"] + header_footer_parts(doc):
        if not doc.exists(part):
            continue
        rels = {rel["id"]: rel for rel in doc.relationships(part)}
        for docpr in doc.xml(part).iter(kit.q("docPr", kit.WP)):
            if (docpr.get("descr") or "").strip():
                continue
            blip = docpr.getparent().find(".//" + kit.q("blip", kit.A))
            rid = blip.get(kit.q("embed", kit.R)) if blip is not None else None
            target = rels.get(rid, {}).get("resolved", "")
            stem = posixpath.splitext(posixpath.basename(target))[0]
            label = (stem or docpr.get("name") or "image").replace("_", " ").replace("-", " ").strip()
            docpr.set("descr", label.title() or "Image")
            changed += 1
    return changed


def fix_table_headers(doc: kit.Docx) -> int:
    changed = 0
    for table in doc.xml("word/document.xml").iter(kit.q("tbl")):
        rows = table.findall(kit.q("tr"))
        if not rows:
            continue
        props = rows[0].find(kit.q("trPr"))
        if props is None:
            props = rows[0].makeelement(kit.q("trPr"), {})
            rows[0].insert(0, props)
        if props.find(kit.q("tblHeader")) is None:
            props.append(props.makeelement(kit.q("tblHeader"), {}))
            changed += 1
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit a .docx for accessibility blockers, optionally repairing the two safe cases.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--fix_image_alt", choices=["from_filename"], help="Derive missing alt text from the image file name")
    parser.add_argument("--fix_table_headers", choices=["first_row"], help="Mark the first row as a repeating header")
    parser.add_argument("--out", help="Write the repaired .docx here (required with any --fix)")
    parser.add_argument("--out_json", help="Write the full report JSON here instead of stdout")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    findings = scan_images(doc) + scan_tables(doc) + scan_headings(doc) + scan_links(doc) + scan_title(doc)
    issues = [item for item in findings if not item["ok"]]

    repairs = {}
    if args.fix_image_alt or args.fix_table_headers:
        if not args.out:
            parser.error("--out is required when applying fixes")
    if args.fix_image_alt:
        repairs["image_alt"] = fix_alt_text(doc)
    if args.fix_table_headers:
        repairs["table_headers"] = fix_table_headers(doc)
    if repairs and args.out:
        doc.save(args.out)
        issues = [item for item in (scan_images(doc) + scan_tables(doc) + scan_headings(doc) + scan_links(doc) + scan_title(doc)) if not item["ok"]]

    counts: dict[str, int] = {}
    for item in issues:
        counts[item["code"]] = counts.get(item["code"], 0) + 1
    report = {
        "ok": not issues,
        "input": str(Path(args.in_docx)),
        "output": str(Path(args.out)) if args.out and repairs else None,
        "repairs": repairs,
        "counts": counts,
        "findings": issues,
    }
    kit.emit(report, args.out_json)
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
