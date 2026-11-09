#!/usr/bin/env python
"""Merge a style pack (another .docx/.dotx) into a target .docx.

Only the formatting layer is transplanted: styles, and the numbering
definitions the styles point at.  Body content, media, headers and section
geometry stay exactly as they are in the target.  Styles that share an id are
replaced, target-only styles survive, and template-only styles are appended so
named styles referenced by the pack resolve.

Exit codes: 0 success, 1 template has no styles part, 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
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


def load_xml(path: Path, part: str):
    with zipfile.ZipFile(path) as zf:
        if part not in zf.namelist():
            return None
        return etree.fromstring(zf.read(part))


def merge_styles(doc: kit.Docx, template_styles) -> dict:
    target = doc.xml("word/styles.xml")
    incoming = {node.get(kit.q("styleId")): node for node in template_styles.findall(kit.q("style")) if node.get(kit.q("styleId"))}
    existing = {node.get(kit.q("styleId")): node for node in target.findall(kit.q("style")) if node.get(kit.q("styleId"))}
    replaced = added = 0
    for style_id, node in incoming.items():
        clone = etree.fromstring(etree.tostring(node))
        if style_id in existing:
            target.replace(existing[style_id], clone)
            existing[style_id] = clone
            replaced += 1
        else:
            target.append(clone)
            existing[style_id] = clone
            added += 1
    template_defaults = template_styles.find(kit.q("docDefaults"))
    if template_defaults is not None:
        clone = etree.fromstring(etree.tostring(template_defaults))
        current = target.find(kit.q("docDefaults"))
        if current is not None:
            target.replace(current, clone)
        else:
            target.insert(0, clone)
    return {"replaced": replaced, "added": added, "total": len(existing)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply the styles and numbering of a template .docx/.dotx to a target .docx.")
    parser.add_argument("--template", required=True, help="Template or style-pack .docx/.dotx")
    parser.add_argument("--target", required=True, help="Document whose styles should be updated")
    parser.add_argument("--out", required=True, help="Output .docx (never overwrite the target)")
    args = parser.parse_args(argv)

    template_path = Path(args.template)
    if template_path.suffix.lower() == ".dotx":
        # A .dotx is a .docx package with a different content type; reading the
        # zip directly works the same, so no conversion is needed.
        pass
    try:
        template_styles = load_xml(template_path, "word/styles.xml")
    except OSError as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    if template_styles is None:
        print("error: template has no word/styles.xml", file=sys.stderr)
        return 1

    try:
        doc = kit.Docx(args.target)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    stats = merge_styles(doc, template_styles)
    template_numbering = None
    try:
        template_numbering = load_xml(template_path, "word/numbering.xml")
    except OSError:
        template_numbering = None
    if template_numbering is not None:
        doc.set_xml("word/numbering.xml", etree.fromstring(etree.tostring(template_numbering)))
        doc.ensure_override("word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")
        doc.ensure_rel("word/document.xml", kit.REL_NUMBERING, "numbering.xml")
        stats["numbering"] = "copied"

    doc.save(args.out)
    kit.emit({"ok": True, "template": str(template_path), "target": str(Path(args.target)), "output": str(Path(args.out)), "styles": stats})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
