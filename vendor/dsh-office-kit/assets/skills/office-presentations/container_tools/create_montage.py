"""Assemble slide PNGs into one labelled contact sheet.

Purpose: eyeballing twenty renders one file at a time wastes context; a single
grid image lets you spot collisions, empty slides and stray template text at a
glance, then zoom into the slide that looks wrong.

Exit codes: 0 sheet written, 2 no readable input, 3 Pillow unavailable.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - whitelist dependency, but fail clearly
    print(json.dumps({"ok": False, "error": {"code": "pillow_missing", "message": "Pillow is required"}}))
    raise SystemExit(3)


def _collect(paths: list[str], directory: str | None) -> list[Path]:
    found: list[Path] = [Path(item) for item in paths]
    if directory:
        found.extend(sorted(Path(directory).glob("*.png")))
    ordered: list[Path] = []
    seen: set[str] = set()
    for path in found:
        key = str(path.resolve())
        if key in seen or not path.is_file() or path.name in {"contact-sheet.png", "montage.png"}:
            continue
        seen.add(key)
        ordered.append(path)
    return ordered


def _label(draw, box, text: str, size: int, colour) -> None:
    try:
        font = ImageFont.truetype("arial.ttf", size)
    except OSError:
        try:
            font = ImageFont.load_default(size=size)
        except TypeError:  # very old Pillow
            font = ImageFont.load_default()
    draw.text((box[0], box[1]), text, fill=colour, font=font)


def make_montage(
    paths: list[str],
    output: str | Path,
    directory: str | None = None,
    columns: int = 3,
    cell_width: int = 480,
    padding: int = 16,
    background: tuple[int, int, int] = (245, 246, 248),
) -> dict:
    images = _collect(paths, directory)
    if not images:
        return {"ok": False, "error": {"code": "no_images", "message": "no PNG inputs found"}}

    loaded: list[tuple[Path, Image.Image]] = []
    for path in images:
        try:
            with Image.open(path) as handle:
                loaded.append((path, handle.convert("RGB")))
        except Exception as exc:  # noqa: BLE001 - one bad file must not kill the sheet
            loaded.append((path, Image.new("RGB", (cell_width, int(cell_width * 0.5625)), (220, 60, 60))))
    columns = max(1, min(columns, len(loaded)))
    cell_height = max(1, int(round(cell_width * loaded[0][1].height / max(loaded[0][1].width, 1))))
    rows = (len(loaded) + columns - 1) // columns
    label_height = 22
    sheet = Image.new(
        "RGB",
        (
            columns * cell_width + (columns + 1) * padding,
            rows * (cell_height + label_height) + (rows + 1) * padding,
        ),
        background,
    )
    draw = ImageDraw.Draw(sheet)
    for index, (path, image) in enumerate(loaded):
        column = index % columns
        row = index // columns
        x = padding + column * (cell_width + padding)
        y = padding + row * (cell_height + label_height + padding)
        draw.rectangle([x - 1, y - 1, x + cell_width, y + cell_height], outline=(205, 210, 218))
        thumb = image.copy()
        thumb.thumbnail((cell_width, cell_height), Image.LANCZOS)
        sheet.paste(thumb, (x + (cell_width - thumb.width) // 2, y + (cell_height - thumb.height) // 2))
        _label(draw, (x, y + cell_height + 4), path.stem, 13, (70, 76, 86))

    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)
    return {
        "ok": True,
        "output": str(target.resolve()),
        "cells": len(loaded),
        "columns": columns,
        "size": list(sheet.size),
        "cells_in_order": [path.name for path, _ in loaded],
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Combine slide PNGs into one labelled grid image.")
    parser.add_argument("images", nargs="*", help="PNG files (order is preserved)")
    parser.add_argument("--dir", help="also include every .png in this directory, sorted")
    parser.add_argument("--out", required=True, help="path of the contact sheet to write")
    parser.add_argument("--columns", type=int, default=3, help="grid columns (default 3)")
    parser.add_argument("--cell-width", type=int, default=480, help="width of one cell in pixels (default 480)")
    args = parser.parse_args(argv)

    report = make_montage(args.images, args.out, args.dir, args.columns, args.cell_width)
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    if report.get("ok"):
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
