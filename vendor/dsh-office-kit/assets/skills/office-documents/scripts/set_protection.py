#!/usr/bin/env python
"""Set or clear Word's document-protection editing restriction.

Protection is a workplace guardrail, not encryption: without a password hash the
restriction can be removed by anyone who knows the settings part, which is often
exactly what is wanted for review copies.  Supply a precomputed ``--hash`` if the
file must resist casual removal.

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

MODES = {
    "off": None,
    "none": None,
    "readonly": "readOnly",
    "read_only": "readOnly",
    "read-only": "readOnly",
    "comments": "comments",
    "comment": "comments",
    "trackedchanges": "trackedChanges",
    "tracked_changes": "trackedChanges",
    "tracked-changes": "trackedChanges",
    "forms": "forms",
    "form": "forms",
}
HASH_ALGORITHM_SID = "4"  # SHA-512, the modern Word default


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply or remove the editing restriction stored in settings.xml.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--mode", required=True, help="off, readOnly, comments, trackedChanges, forms")
    parser.add_argument("--out", default=None, help="Output .docx (default: overwrite the input)")
    parser.add_argument("--no_enforce", action="store_true", help="Write the mode but leave enforcement off")
    parser.add_argument("--hash", default=None, help="Precomputed password hash (skip to leave protection password-free)")
    parser.add_argument("--salt", default=None, help="Salt value that belongs with --hash")
    parser.add_argument("--spin_count", default="100000")
    args = parser.parse_args(argv)

    mode = MODES.get(args.mode.strip().lower())
    if mode is None and args.mode.strip().lower() not in ("off", "none"):
        print("error: unknown --mode %r (use off, readOnly, comments, trackedChanges, forms)" % args.mode, file=sys.stderr)
        return 2

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    settings = doc.xml("word/settings.xml")
    for existing in settings.findall(kit.q("documentProtection")):
        settings.remove(existing)

    if mode is not None:
        node = etree.Element(kit.q("documentProtection"))
        node.set(kit.q("edit"), mode)
        node.set(kit.q("enforcement"), "0" if args.no_enforce else "1")
        if args.hash:
            node.set(kit.q("cryptProviderType"), "rsaFull")
            node.set(kit.q("cryptAlgorithmClass"), "hash")
            node.set(kit.q("cryptAlgorithmType"), "typeAny")
            node.set(kit.q("cryptAlgorithmSid"), HASH_ALGORITHM_SID)
            node.set(kit.q("cryptSpinCount"), args.spin_count)
            node.set(kit.q("hash"), args.hash)
            if args.salt:
                node.set(kit.q("salt"), args.salt)
        anchor = settings.find(kit.q("writeProtection"))
        if anchor is None:
            settings.insert(0, node)
        else:
            anchor.addnext(node)

    out = args.out or args.docx
    doc.save(out)
    kit.emit({"ok": True, "output": str(Path(out)), "mode": mode or "off", "enforced": bool(mode) and not args.no_enforce, "password_hash": bool(args.hash)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
