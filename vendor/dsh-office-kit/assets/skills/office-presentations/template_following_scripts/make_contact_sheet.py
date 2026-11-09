"""Tile slide previews into one image so the whole deck can be judged at once.

Purpose: reading ten previews one by one costs ten looks and hides pace,
repetition and colour drift between slides. One contact sheet shows whether the
deck has a rhythm: which slides are dense, which are empty, whether the cover
carries the same accent as the close.

Exit codes: 0 sheet written, 2 nothing readable.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "container_tools"))


def _natural_key(path: Path) -> list:
    import re

    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.stem)]


def build_sheet(images: list[Path], out_path: Path, columns: int = 3, label_height: int = 48, padding: int = 18) -> dict:
    from PIL import Image, ImageDraw

    columns = max(1, columns)
    rows = max(1, math.ceil(len(images) / columns))
    thumbs = []
    cell_w = 0
    cell_h = 0
    for path in images:
        try:
            with Image.open(path) as opened:
                thumb = opened.convert("RGB")
                thumbs.append((path, thumb.copy(), None))
                cell_w = max(cell_w, thumb.width)
                cell_h = max(cell_h, thumb.height)
        except Exception as exc:  # noqa: BLE001 - unreadable previews become placeholder cells
            thumbs.append((path, None, str(exc)))
    if not cell_w or not cell_h:
        return {"ok": False, "error": {"code": "no_readable_images", "message": "none of the inputs could be opened"}}

    width = columns * cell_w + (columns + 1) * padding
    height = rows * (cell_h + label_height) + (rows + 1) * padding
    sheet = Image.new("RGB", (width, height), (246, 246, 246))
    draw = ImageDraw.Draw(sheet)

    for index, (path, thumb, error) in enumerate(thumbs):
        row, column = divmod(index, columns)
        x = padding + column * (cell_w + padding)
        y = padding + row * (cell_h + label_height + padding)
        if thumb is None:
            draw.rectangle([x, y, x + cell_w, y + cell_h], fill=(232, 232, 232), outline=(180, 60, 60), width=3)
            draw.line([x, y, x + cell_w, y + cell_h], fill=(180, 60, 60), width=3)
            draw.line([x + cell_w, y, x, y + cell_h], fill=(180, 60, 60), width=3)
        else:
            sheet.paste(thumb, (x, y))
            draw.rectangle([x, y, x + cell_w, y + cell_h], outline=(190, 190, 190), width=1)
        draw.text((x + 4, y + cell_h + 8), path.stem, fill=(40, 40, 40))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    return {
        "ok": True,
        "output": str(out_path.resolve()),
        "cells": len(thumbs),
        "grid": {"columns": columns, "rows": rows},
        "size": [width, height],
        "unreadable": [path.name for path, thumb, _ in thumbs if thumb is None],
    }


def _collect(args) -> list[Path]:
    found: list[Path] = []
    for value in [*args.images, *([args.dir] if args.dir else [])]:
        path = Path(value)
        if path.is_dir():
            found.extend(sorted((item for item in path.iterdir() if item.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}), key=_natural_key))
        else:
            found.append(path)
    return found


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Build one contact sheet from slide previews.")
    parser.add_argument("images", nargs="*", help="preview images and/or directories of them")
    parser.add_argument("--dir", help="a directory of preview images to include (same as passing it positionally)")
    parser.add_argument("--out", required=True, help="path of the contact sheet to write")
    parser.add_argument("--columns", type=int, default=3, help="grid width (default 3)")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)
    if not args.images and not args.dir:
        parser.error("give at least one image, one directory, or --dir")

    images = _collect(args)
    report = build_sheet(images, Path(args.out), args.columns) if images else {"ok": False, "error": {"code": "no_images", "message": "no preview images found"}}
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
