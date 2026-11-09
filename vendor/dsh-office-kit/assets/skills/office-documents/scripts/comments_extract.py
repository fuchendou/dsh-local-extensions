#!/usr/bin/env python
"""Extract Word comments to JSON, including the text each comment is anchored to.

The anchor is recovered by walking the marked-up parts in document order and
collecting the text between ``commentRangeStart`` and ``commentRangeEnd`` for
the same id.  Comments whose range was lost still appear, with an empty anchor.

Exit codes: 0 success (an empty list when the file has no comments), 2 bad input.
"""

from __future__ import annotations

import argparse
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


def anchor_map(doc: kit.Docx) -> dict[str, dict]:
    found: dict[str, dict] = {}
    hf = [name for name in doc.names("word/header") + doc.names("word/footer") if name.endswith(".xml") and "_rels" not in name]
    parts = ["word/document.xml"] + hf + [part for part in doc.text_parts() if part != "word/document.xml"]
    for part in parts:
        active = None
        for node in doc.xml(part).iter():
            if not isinstance(node.tag, str):
                continue
            local = node.tag.split("}", 1)[1] if node.tag.startswith("{%s}" % kit.W) else ""
            if local == "commentRangeStart":
                ident = node.get(kit.q("id")) or ""
                active = ident
                found.setdefault(ident, {"part": part, "anchored_text": ""})
            elif local == "commentRangeEnd":
                if active is not None and (node.get(kit.q("id")) or "") == active:
                    active = None
            elif local == "commentReference" and active is None:
                ident = node.get(kit.q("id")) or ""
                found.setdefault(ident, {"part": part, "anchored_text": ""})
            elif active is not None and local in ("t", "delText"):
                found.setdefault(active, {"part": part, "anchored_text": ""})["anchored_text"] += node.text or ""
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract comments (author, date, body, anchored text) from a .docx.")
    parser.add_argument("in_docx", help="Input .docx")
    parser.add_argument("--out", required=True, help="Write the JSON report here")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.in_docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2
    if not doc.exists("word/comments.xml"):
        kit.emit({"ok": True, "input": str(Path(args.in_docx)), "count": 0, "comments": []}, args.out)
        return 0

    anchors = anchor_map(doc)
    comments = []
    for node in doc.xml("word/comments.xml").findall(kit.q("comment")):
        ident = node.get(kit.q("id")) or ""
        paragraphs = [kit.text_of(paragraph) for paragraph in node.iter(kit.q("p"))]
        info = anchors.get(ident, {})
        comments.append(
            {
                "id": int(ident) if ident.lstrip("-").isdigit() else ident,
                "author": node.get(kit.q("author")) or "",
                "initials": node.get(kit.q("initials")) or "",
                "date": node.get(kit.q("date")) or "",
                "text": "\n".join(text for text in paragraphs if text),
                "anchored_text": info.get("anchored_text", "").strip(),
                "part": info.get("part"),
                "resolved": node.get(kit.q("done", kit.W15)) in ("1", "true"),
            }
        )
    comments.sort(key=lambda item: item["id"] if isinstance(item["id"], int) else 0)
    kit.emit({"ok": True, "input": str(Path(args.in_docx)), "count": len(comments), "comments": comments}, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
