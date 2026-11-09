#!/usr/bin/env python3
"""Append blocks to the end of an existing Word document.

The block builder (headings, paragraphs, bullets, numbered lists, tables,
images, equations, quotes, page breaks, spacers) is the helper CLI's own
`_docx_add_blocks`, imported rather than re-implemented so a spec that works
with `docx create` works here too.

Usage:
  append_blocks.py --input IN.docx [--out OUT.docx] --blocks blocks.json
  append_blocks.py --input IN.docx [--out OUT.docx] --spec spec.json

`--blocks` takes a JSON list of blocks or {"blocks": [...]}; `--spec` takes a
document spec whose `blocks` (or `sections`) array is appended.

Exit codes: 0 appended, 1 the document or a block could not be handled, 2
argparse usage error.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import docx_kit as kit  # noqa: E402

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

COUNTER_KEYS = ("headings", "paragraphs", "list_items", "tables", "images", "equations", "equation_fallbacks")


def fail(payload: dict, code: int = 1) -> int:
    kit.emit({"ok": False, **payload})
    return code


def load_builder():
    cli = kit.office_cli_path()
    if cli is None:
        raise FileNotFoundError("helper CLI not found; set DSH_OFFICE_CLI to python/office_cli.py")
    sys.path.insert(0, str(cli.parent))
    import office_cli

    return office_cli


def load_blocks(args) -> list[dict]:
    raw = args.blocks or args.spec
    text = raw.strip()
    if text.startswith(("[", "{")):
        payload = json.loads(text)
    else:
        payload = json.loads(Path(text).expanduser().read_text(encoding="utf-8"))
    if isinstance(payload, list):
        blocks = payload
    else:
        blocks = payload.get("blocks", payload.get("sections", []))
    if not isinstance(blocks, list):
        raise ValueError("blocks must be a JSON array")
    return [block for block in blocks if isinstance(block, dict)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Append content blocks to a .docx copy.")
    parser.add_argument("--input", required=True, help="source .docx (never modified)")
    parser.add_argument("--out", help="output path; default <name>-edited.docx")
    parser.add_argument("--blocks", help="JSON file holding an array of blocks")
    parser.add_argument("--spec", help="JSON document spec; its blocks array is appended")
    args = parser.parse_args()

    if not (args.blocks or args.spec):
        return fail({"error": "pass --blocks or --spec"}, 2)

    source = Path(args.input).expanduser()
    if not source.is_file():
        return fail({"error": f"input not found: {args.input}"})
    out = Path(args.out).expanduser() if args.out else source.with_name(f"{source.stem}-edited.docx")
    if out.resolve() == source.resolve():
        return fail({"error": "refusing to overwrite the input; pass a different --out"})

    try:
        blocks = load_blocks(args)
    except (OSError, ValueError) as exc:
        return fail({"error": f"cannot read blocks: {exc}"}, 2)

    try:
        office_cli = load_builder()
    except FileNotFoundError as exc:
        return fail({"error": str(exc)})

    from docx import Document

    document = Document(str(source))
    counters = {key: 0 for key in COUNTER_KEYS}
    try:
        office_cli._docx_add_blocks(document, blocks, counters)
    except SystemExit as exc:  # the builder reports bad blocks through the CLI
        return fail({"error": f"a block was rejected: {exc}", "counts": counters})

    out.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(out))
    kit.emit({"ok": True, "input": str(source), "output": str(out), "appended": len(blocks), "counts": counters})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
