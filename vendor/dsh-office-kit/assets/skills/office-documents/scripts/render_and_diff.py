#!/usr/bin/env python
"""Render two documents and report which pages changed, pixel by pixel.

This is how you prove an edit did what you meant without opening Word: render
both versions, diff the page images, then look at the pages that moved.  The diff
image marks changed pixels in colour so a one-line change is obvious.

Exit codes: 0 compared, 1 render failed, 3 no renderer installed, 2 bad input.
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

THRESHOLD = 8


def render(path: Path, out_dir: Path, dpi: int) -> tuple[int, list[str], str]:
    code, stdout, stderr = kit.run_office_cli(["docx", "render", "--input", str(path), "--out-dir", str(out_dir), "--dpi", str(dpi)])
    payload = kit.cli_json(stdout) or kit.cli_json(stderr) or {}
    detail = payload.get("error") or payload.get("reason") or ""
    if not detail:
        lines = [line.strip() for line in (stderr or stdout).splitlines() if line.strip() not in ("", "{", "}")]
        detail = lines[-1] if lines else "render failed"
    return code, payload.get("pages") or [], detail


def diff_pages(first: Path, second: Path, out_path: Path) -> dict:
    from PIL import Image, ImageChops, ImageOps

    with Image.open(first) as a, Image.open(second) as b:
        left = a.convert("RGB")
        right = b.convert("RGB")
        if left.size != right.size:
            right = right.resize(left.size)
        difference = ImageChops.difference(left, right)
        grey = difference.convert("L").point(lambda value: 255 if value > THRESHOLD else 0)
        changed = sum(1 for value in grey.getdata() if value)
        box = difference.getbbox()
        ImageOps.autocontrast(difference).save(out_path)
        return {
            "changed_pixels": changed,
            "total_pixels": left.width * left.height,
            "ratio": round(changed / float(left.width * left.height), 6),
            "bbox": list(box) if box else None,
            "size": list(left.size),
            "diff_image": str(out_path),
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render two .docx files and report per-page pixel differences.")
    parser.add_argument("first", help="Original .docx")
    parser.add_argument("second", help="Changed .docx")
    parser.add_argument("--outdir", required=True, help="Directory for rendered pages and diff images")
    parser.add_argument("--dpi", type=int, default=120)
    parser.add_argument("--threshold", type=int, default=THRESHOLD, help="Per-pixel channel difference that counts as a change")
    args = parser.parse_args(argv)

    root = Path(args.outdir).expanduser().resolve()
    first = Path(args.first).expanduser().resolve()
    second = Path(args.second).expanduser().resolve()
    for path in (first, second):
        if not path.is_file():
            print("error: %s not found" % path, file=sys.stderr)
            return 2

    code_a, pages_a, detail_a = render(first, root / "a", args.dpi)
    code_b, pages_b, detail_b = render(second, root / "b", args.dpi)
    if code_a != 0 or code_b != 0 or not pages_a or not pages_b:
        detail = detail_a or detail_b or "render failed"
        reason = "no_renderer" if ("renderer" in detail.lower() or "libreoffice" in detail.lower()) else "render_failed"
        kit.emit({"ok": False, "reason": reason, "detail": detail, "remedy": "Install this plugin inside the DeepSeek Harness tree so @deepseek-ai/libreoffice-kit is available, or set DSH_LIBREOFFICE_KIT_CLI, then re-run."})
        return 3 if reason == "no_renderer" else 1

    pairs = list(zip(pages_a, pages_b))
    results = []
    for index, (left, right) in enumerate(pairs, start=1):
        results.append(diff_pages(Path(left), Path(right), root / ("diff-%02d.png" % index)))

    changed_pages = [index for index, item in enumerate(results, start=1) if item["changed_pixels"]]
    kit.emit(
        {
            "ok": True,
            "pages_first": len(pages_a),
            "pages_second": len(pages_b),
            "changed_pages": changed_pages,
            "page_count_delta": len(pages_b) - len(pages_a),
            "diffs": results,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
