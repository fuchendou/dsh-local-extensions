#!/usr/bin/env python
"""Remove metadata that identifies the author or the machine that edited a file.

Word leaves a trail: core properties, the company and manager fields, custom
properties, revision-save identifiers (``w:rsid*``) and spell-check markers.  None
of it is visible in the document, all of it travels with the file.

Exit codes: 0 success, 2 bad input.
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

DC = "http://purl.org/dc/elements/1.1/"
CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DCTERMS = "http://purl.org/dc/terms/"
EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
REL_CUSTOM = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties"

CORE_CLEAR = ["{%s}creator" % DC, "{%s}lastModifiedBy" % CP, "{%s}keywords" % CP, "{%s}description" % DC, "{%s}subject" % DC, "{%s}title" % DC, "{%s}category" % CP]
APP_CLEAR = ["{%s}Company" % EP, "{%s}Manager" % EP, "{%s}Application" % EP]


def clear_core(doc: kit.Docx) -> list[str]:
    cleared = []
    if not doc.exists("docProps/core.xml"):
        return cleared
    root = doc.xml("docProps/core.xml")
    for tag in CORE_CLEAR:
        for node in root.findall(tag):
            node.text = ""
            cleared.append(tag.rsplit("}", 1)[-1])
    for node in root.findall("{%s}revision" % CP):
        node.text = "1"
    return cleared


def clear_app(doc: kit.Docx) -> list[str]:
    cleared = []
    if not doc.exists("docProps/app.xml"):
        return cleared
    root = doc.xml("docProps/app.xml")
    for tag in APP_CLEAR:
        for node in root.findall(tag):
            node.text = ""
            cleared.append(tag.rsplit("}", 1)[-1])
    return cleared


def drop_custom(doc: kit.Docx) -> bool:
    dropped = False
    if doc.exists("docProps/custom.xml"):
        doc.drop("docProps/custom.xml")
        doc.drop_override("docProps/custom.xml")
        dropped = True
    ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    for name in [part for part in doc.parts if part.endswith(".rels")]:
        root = doc.xml(name)
        changed = False
        for node in list(root.findall(ns + "Relationship")):
            if node.get("Type") == REL_CUSTOM:
                root.remove(node)
                changed = True
                dropped = True
        if changed:
            doc.set_xml(name, root)
    return dropped


def scrub_document(doc: kit.Docx) -> dict:
    stats = {"rsid_attributes": 0, "proof_error_markers": 0, "render_breaks": 0}
    for name in [part for part in doc.parts if part.endswith(".xml") and (part.startswith("word/") or part == "word/document.xml")]:
        root = doc.xml(name)
        changed = False
        for node in root.iter():
            for key in list(node.attrib):
                if key.startswith(kit.q("rsid")) or key.startswith("{%s}rsid" % kit.W):
                    del node.attrib[key]
                    stats["rsid_attributes"] += 1
                    changed = True
        for tag, key in ((kit.q("proofErr"), "proof_error_markers"), (kit.q("lastRenderedPageBreak"), "render_breaks")):
            for node in list(root.iter(tag)):
                node.getparent().remove(node)
                stats[key] += 1
                changed = True
        if changed:
            doc.set_xml(name, root)
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Strip author, company, custom properties and revision identifiers.")
    parser.add_argument("input_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--keep_title", action="store_true", help="Keep dc:title and dc:subject")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.input_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    cleared = clear_core(doc) + clear_app(doc)
    if args.keep_title:
        cleared = [name for name in cleared if name not in ("title", "subject")]
        root = doc.xml("docProps/core.xml")
        original = kit.Docx(args.input_docx).xml("docProps/core.xml")
        for tag in ("{%s}title" % DC, "{%s}subject" % DC):
            source = original.find(tag)
            target = root.find(tag)
            if source is not None and target is not None:
                target.text = source.text

    custom_dropped = drop_custom(doc)
    stats = scrub_document(doc)
    doc.save(args.out)
    kit.emit({"ok": True, "output": str(Path(args.out)), "cleared": cleared, "custom_properties_dropped": custom_dropped, **stats})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
