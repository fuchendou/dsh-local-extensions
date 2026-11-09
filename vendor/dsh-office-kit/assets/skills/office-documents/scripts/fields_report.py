#!/usr/bin/env python
"""List the Word fields in a .docx and show what each one asks for.

Fields are the dynamic bits Word fills at layout time: ``TOC``, ``SEQ``, ``REF``,
``PAGEREF``, ``HYPERLINK``, ``DATE`` and friends.  Each is reported once with its
instruction, cached result, and the part it lives in, so a headless workflow can
tell whether a document depends on a refresh before rendering.

Exit codes: 0 success (also when there are no fields), 2 bad input or missing part.
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report Word fields (TOC, SEQ, REF, PAGEREF, HYPERLINK, ...) in a .docx.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--max_examples", type=int, default=8, help="How many sample instructions to keep per field type")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    counts: dict[str, int] = {}
    examples: dict[str, list[dict]] = {}
    kinds: dict[str, int] = {}
    for part, paragraph, field in kit.iter_fields(doc):
        name = field["type"] or "UNKNOWN"
        counts[name] = counts.get(name, 0) + 1
        kinds[field["kind"]] = kinds.get(field["kind"], 0) + 1
        bucket = examples.setdefault(name, [])
        if len(bucket) < args.max_examples:
            bucket.append({"part": part, "instr": field["instr"], "result": field["result"][:80]})

    kit.emit(
        {
            "ok": True,
            "input": str(Path(args.docx)),
            "total": sum(counts.values()),
            "counts": counts,
            "kinds": kinds,
            "examples": examples,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
