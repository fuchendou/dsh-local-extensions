#!/usr/bin/env python
"""Append one document's body to another, carrying its parts across.

Merging by pasting XML is the easy half; the hard half is that the second file's
relationships point at its own media, numbering and styles.  This script copies
those parts into the base under free names, remaps relationship ids and
numbering ids, and brings over any style the appended content needs.

Drawings are refused by default: a nested drawing can carry its own rel chain and
silently break a merge, so it has to be asked for explicitly.

Exit codes: 0 success, 1 refused (drawings present, incompatible input), 2 bad input.
"""

from __future__ import annotations

import argparse
import posixpath
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

CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
W_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
REL_NUMBERING = kit.REL_NUMBERING


def free_part_name(base: kit.Docx, source: str) -> str:
    folder = posixpath.dirname(source) or "word/media"
    stem, extension = posixpath.splitext(posixpath.basename(source))
    candidate = posixpath.join(folder, stem + extension)
    counter = 1
    while base.exists(candidate):
        candidate = posixpath.join(folder, "%s_copy%d%s" % (stem, counter, extension))
        counter += 1
    return candidate


def copy_part(base: kit.Docx, append: kit.Docx, source: str) -> str:
    target = free_part_name(base, source)
    base.parts[target] = append.parts[source]
    base.order.append(target)
    base._cache.pop(target, None)
    for node in append.content_types().findall(CT + "Override"):
        if node.get("PartName") == "/" + source:
            base.ensure_override(target, node.get("ContentType"))
            break
    return target


def copy_defaults(base: kit.Docx, append: kit.Docx) -> None:
    existing = {(node.get("Extension") or "").lower() for node in base.content_types().findall(CT + "Default")}
    for node in append.content_types().findall(CT + "Default"):
        extension = (node.get("Extension") or "").lower()
        if extension and extension not in existing:
            clone = etree.SubElement(base.content_types(), CT + "Default")
            clone.set("Extension", node.get("Extension"))
            clone.set("ContentType", node.get("ContentType"))
            existing.add(extension)


def ensure_style(base: kit.Docx, append: kit.Docx, wanted: str) -> bool:
    if not append.exists("word/styles.xml") or not wanted:
        return False
    base_styles = base.xml("word/styles.xml")
    present = {node.get(kit.q("styleId")) for node in base_styles.findall(kit.q("style"))}
    if wanted in present:
        return False
    source_styles = {node.get(kit.q("styleId")): node for node in append.xml("word/styles.xml").findall(kit.q("style"))}
    pending = [wanted]
    copied = False
    while pending:
        style_id = pending.pop()
        node = source_styles.get(style_id)
        if node is None or style_id in present:
            continue
        clone = etree.fromstring(etree.tostring(node))
        base_styles.append(clone)
        present.add(style_id)
        copied = True
        for link_tag in ("basedOn", "next", "link"):
            ref = node.find(kit.q(link_tag))
            if ref is not None and ref.get(kit.q("val")):
                pending.append(ref.get(kit.q("val")))
    return copied


def remap_numbering(base: kit.Docx, append: kit.Docx, nodes: list) -> dict[str, str]:
    used = set()
    for node in nodes:
        for num_pr in node.iter(kit.q("numPr")):
            num_id = num_pr.find(kit.q("numId"))
            if num_id is not None and num_id.get(kit.q("val")):
                used.add(num_id.get(kit.q("val")))
    if not used or not append.exists("word/numbering.xml"):
        return {}
    if not base.exists("word/numbering.xml"):
        base.parts["word/numbering.xml"] = append.parts["word/numbering.xml"]
        base.order.append("word/numbering.xml")
        base.ensure_override("word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml")
        base.ensure_rel("word/document.xml", kit.REL_NUMBERING, "numbering.xml")
        return {}

    base_root = base.xml("word/numbering.xml")
    source_root = append.xml("word/numbering.xml")
    base_nums = {node.get(kit.q("numId")): node for node in base_root.findall(kit.q("num"))}
    base_abstract = {node.get(kit.q("abstractNumId")): node for node in base_root.findall(kit.q("abstractNum"))}
    next_num = max([int(value) for value in base_nums if (value or "").isdigit()], default=0) + 1
    next_abstract = max([int(value) for value in base_abstract if (value or "").isdigit()], default=0) + 1
    source_nums = {node.get(kit.q("numId")): node for node in source_root.findall(kit.q("num"))}
    source_abstract = {node.get(kit.q("abstractNumId")): node for node in source_root.findall(kit.q("abstractNum"))}
    mapping = {}
    for old in used:
        node = source_nums.get(old)
        if node is None:
            continue
        clone = etree.fromstring(etree.tostring(node))
        reference = clone.find(kit.q("abstractNumId"))
        abstract_old = reference.get(kit.q("val")) if reference is not None else None
        if abstract_old in source_abstract and abstract_old not in base_abstract:
            abstract_clone = etree.fromstring(etree.tostring(source_abstract[abstract_old]))
            abstract_clone.set(kit.q("abstractNumId"), str(next_abstract))
            base_root.insert(0, abstract_clone)
            base_abstract[str(next_abstract)] = abstract_clone
            next_abstract += 1
            if reference is not None:
                reference.set(kit.q("val"), abstract_clone.get(kit.q("abstractNumId")))
        clone.set(kit.q("numId"), str(next_num))
        mapping[old] = str(next_num)
        base_root.append(clone)
        base_nums[str(next_num)] = clone
        next_num += 1
    return mapping


def remap_relationships(base: kit.Docx, append: kit.Docx, nodes: list) -> int:
    mapping = {}
    copied = 0
    source_rels = {entry["id"]: entry for entry in append.relationships("word/document.xml")}
    attributes = (kit.q("embed", kit.R), kit.q("id", kit.R), kit.q("link", kit.R))
    for node in nodes:
        for element in node.iter():
            for attribute in attributes:
                rid = element.get(attribute)
                if not rid:
                    continue
                if rid not in mapping:
                    rel = source_rels.get(rid)
                    if rel is None:
                        mapping[rid] = rid
                        continue
                    if rel["mode"] == "External":
                        mapping[rid] = base.ensure_rel("word/document.xml", rel["type"], rel["target"], external=True)
                    elif append.exists(rel["resolved"]):
                        target = copy_part(base, append, rel["resolved"])
                        relative = posixpath.relpath(target, "word")
                        mapping[rid] = base.ensure_rel("word/document.xml", rel["type"], relative)
                        copied += 1
                    else:
                        mapping[rid] = rid
                element.set(attribute, mapping[rid])
    return copied


NOTE_PARTS = (
    ("word/footnotes.xml", kit.REL_FOOTNOTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml", kit.q("footnote"), (kit.q("footnoteReference"),)),
    ("word/endnotes.xml", kit.REL_ENDNOTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml", kit.q("endnote"), (kit.q("endnoteReference"),)),
    ("word/comments.xml", kit.REL_COMMENTS, "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml", kit.q("comment"), (kit.q("commentReference"), kit.q("commentRangeStart"), kit.q("commentRangeEnd"))),
)


def remap_part_relationships(base: kit.Docx, append: kit.Docx, append_part: str, base_part: str, nodes: list) -> int:
    """Remap r:embed/r:id/r:link inside nodes, copying targets into the base package."""
    source_rels = {entry["id"]: entry for entry in append.relationships(append_part)}
    attributes = (kit.q("embed", kit.R), kit.q("id", kit.R), kit.q("link", kit.R))
    mapping = {}
    copied = 0
    for node in nodes:
        for element in node.iter():
            for attribute in attributes:
                rid = element.get(attribute)
                if not rid:
                    continue
                if rid not in mapping:
                    rel = source_rels.get(rid)
                    if rel is None:
                        mapping[rid] = rid
                        continue
                    if rel["mode"] == "External":
                        mapping[rid] = base.ensure_rel(base_part, rel["type"], rel["target"], external=True)
                    elif append.exists(rel["resolved"]):
                        target = copy_part(base, append, rel["resolved"])
                        relative = posixpath.relpath(target, posixpath.dirname(base_part))
                        mapping[rid] = base.ensure_rel(base_part, rel["type"], relative)
                        copied += 1
                    else:
                        mapping[rid] = rid
                element.set(attribute, mapping[rid])
    return copied


def merge_note_part(base: kit.Docx, append: kit.Docx, part: str, rel_type: str, content_type: str, note_tag: str) -> dict[str, str]:
    """Merge a footnotes/endnotes/comments part into the base, returning old→new ids."""
    if not append.exists(part):
        return {}
    source_root = append.xml(part)
    if base.exists(part):
        target_root = base.xml(part)
    else:
        target_root = etree.Element(source_root.tag, nsmap=source_root.nsmap)
        for note in source_root.findall(note_tag):
            raw = note.get(kit.q("id"))
            if raw is not None and raw.lstrip("-").isdigit() and int(raw) <= 0:
                target_root.append(etree.fromstring(etree.tostring(note)))
        base.set_xml(part, target_root)
        base.ensure_override(part, content_type)
        base.ensure_rel("word/document.xml", rel_type, posixpath.relpath(part, "word"))

    used = {
        int(node.get(kit.q("id")))
        for node in target_root.findall(note_tag)
        if (node.get(kit.q("id")) or "").lstrip("-").isdigit()
    }
    next_id = max(used, default=0) + 1
    mapping: dict[str, str] = {}
    for note in source_root.findall(note_tag):
        raw = note.get(kit.q("id"))
        if raw is None or not raw.lstrip("-").isdigit() or int(raw) <= 0:
            continue
        clone = etree.fromstring(etree.tostring(note))
        clone.set(kit.q("id"), str(next_id))
        remap_part_relationships(base, append, part, part, [clone])
        target_root.append(clone)
        mapping[raw] = str(next_id)
        next_id += 1
    return mapping


def bind_note_references(clones: list, ref_tags: tuple, mapping: dict[str, str], target_exists: bool) -> int:
    """Point body references at the merged notes; drop references that have no note."""
    dropped = 0
    for clone in clones:
        for ref_tag in ref_tags:
            for element in list(clone.iter(ref_tag)):
                raw = element.get(kit.q("id"))
                if raw is None:
                    continue
                if raw in mapping:
                    element.set(kit.q("id"), mapping[raw])
                elif target_exists and raw.isdigit() and int(raw) <= 0:
                    continue
                else:
                    parent = element.getparent()
                    if parent is not None:
                        parent.remove(element)
                        dropped += 1
    return dropped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append one .docx body to another, copying media, numbering and styles.")
    parser.add_argument("base", help="Document to append to")
    parser.add_argument("append", help="Document whose body is copied in")
    parser.add_argument("--out", required=True, help="Output .docx")
    parser.add_argument("--allow_drawings", action="store_true", help="Copy drawings and their relationships")
    args = parser.parse_args(argv)

    try:
        base = kit.Docx(args.base)
        append = kit.Docx(args.append)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    append_body = append.body()
    incoming = [child for child in append_body if child.tag != kit.q("sectPr")]
    if not incoming:
        print("error: %s has an empty body" % args.append, file=sys.stderr)
        return 2

    has_drawings = any(child.find(".//" + tag) is not None for child in incoming for tag in (kit.q("drawing"), kit.q("pict")))
    if has_drawings and not args.allow_drawings:
        print("error: appended body contains drawings; re-run with --allow_drawings", file=sys.stderr)
        return 1

    style_ids = set()
    numbering_nodes = []
    for child in incoming:
        for node in child.iter():
            for tag in ("pStyle", "rStyle", "tblStyle"):
                if node.tag == kit.q(tag) and node.get(kit.q("val")):
                    style_ids.add(node.get(kit.q("val")))
        if child.find(".//" + kit.q("numPr")) is not None:
            numbering_nodes.append(child)

    styles_copied = sum(1 for style_id in sorted(style_ids) if ensure_style(base, append, style_id))
    number_map = remap_numbering(base, append, numbering_nodes)

    clones = [etree.fromstring(etree.tostring(child)) for child in incoming]
    if number_map:
        for clone in clones:
            for num_pr in clone.iter(kit.q("numPr")):
                num_id = num_pr.find(kit.q("numId"))
                if num_id is not None and num_id.get(kit.q("val")) in number_map:
                    num_id.set(kit.q("val"), number_map[num_id.get(kit.q("val"))])
    media_copied = remap_relationships(base, append, clones)
    notes_merged = 0
    references_dropped = 0
    for part, rel_type, content_type, note_tag, ref_tags in NOTE_PARTS:
        exists = append.exists(part)
        mapping = merge_note_part(base, append, part, rel_type, content_type, note_tag) if exists else {}
        notes_merged += len(mapping)
        references_dropped += bind_note_references(clones, ref_tags, mapping, exists)
    copy_defaults(base, append)

    body = base.body()
    sect = body.find(kit.q("sectPr"))
    anchor = body.index(sect) if sect is not None else len(body)
    for offset, clone in enumerate(clones):
        body.insert(anchor + offset, clone)

    base.save(args.out)
    kit.emit(
        {
            "ok": True,
            "output": str(Path(args.out)),
            "appended_elements": len(clones),
            "styles_copied": styles_copied,
            "media_copied": media_copied,
            "numbering_remapped": len(number_map),
            "notes_merged": notes_merged,
            "references_dropped": references_dropped,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
