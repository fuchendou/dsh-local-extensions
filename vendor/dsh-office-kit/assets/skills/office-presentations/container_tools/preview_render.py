"""Draft slide preview: rasterise a .pptx into one PNG per slide without Office.

Purpose: `render_slides.py` needs pixels to look at, and a machine may have no
office renderer at all. This module reads the package with
python-pptx and redraws every shape onto a PyMuPDF page: rectangles, text at
its declared size, table grids, images, and a bar/line/pie sketch of charts.
It then rasterises each page to PNG.

What it proves and what it does not:
  * proves geometry — what sits where, what collides, what leaves the slide,
    and which text boxes ran out of room (PyMuPDF tells us when a textbox
    truncates);
  * does NOT prove typography — fonts fall back to a built-in face and theme
    colours/fills that python-pptx cannot resolve are approximated.

Exit codes: 0 ok, 2 unreadable input, 3 nothing rasterised.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:  # PyMuPDF ships both names; prefer the current one
    import pymupdf as fitz  # noqa: E402
except ImportError:  # pragma: no cover - older wheels only expose fitz
    import fitz  # noqa: E402

from ooxml_helpers import (  # noqa: E402
    EMU_PER_INCH,
    box,
    default_size_pt,
    estimated_text_height_in,
    has_text_frame,
    is_chart,
    is_picture,
    is_table,
    iter_shapes,
    open_presentation,
    placeholder_kind,
    run_size_pt,
    slide_size_in,
    text_of,
    WIDE_CHAR,
)

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

INK = (0.13, 0.15, 0.18)
MUTED = (0.42, 0.45, 0.50)
RULE = (0.80, 0.82, 0.85)
ACCENT = (0.16, 0.36, 0.62)
PANEL = (0.96, 0.97, 0.98)
CJK_FONT = "china-s"


def _has_cjk(text: str) -> bool:
    return any(WIDE_CHAR.match(char) for char in text)


def _font_for(text: str, size: float) -> tuple[str, str | None]:
    if _has_cjk(text):
        return CJK_FONT, None
    return ("helv" if size < 20 else "hebo"), None


def _solid_rgb(shape) -> tuple[float, float, float] | None:
    try:
        from pptx.enum.dml import MSO_FILL

        if shape.fill.type != MSO_FILL.SOLID:
            return None
        rgb = shape.fill.fore_color.rgb
        return (rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    except Exception:  # noqa: BLE001 - theme colours raise; preview just skips them
        return None


def _text_rgb(shape) -> tuple[float, float, float]:
    for paragraph in getattr(shape, "text_frame", None).paragraphs if has_text_frame(shape) else []:
        for run in paragraph.runs:
            try:
                rgb = run.font.color.rgb
            except Exception:  # noqa: BLE001
                continue
            if rgb is not None:
                return (rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
    return INK


def _draw_text(page, rect: fitz.Rect, text: str, size: float, color, align: int = 0) -> float:
    if not text.strip():
        return 1.0
    fontname, _ = _font_for(text, size)
    try:
        return page.insert_textbox(rect, text, fontsize=size, fontname=fontname, color=color, align=align, lineheight=1.22)
    except Exception:  # noqa: BLE001 - a bad font name must not kill the render
        return page.insert_textbox(rect, text, fontsize=size, color=color, align=align)


def _draw_shape(page, shape, slide_no: int, notes: list[dict[str, Any]]) -> None:
    geometry = box(shape)
    if geometry is None:
        return
    left, top, width, height = geometry
    rect = fitz.Rect(left * 72, top * 72, (left + width) * 72, (top + height) * 72)
    if rect.is_empty:
        return

    if is_picture(shape):
        try:
            page.insert_image(rect, stream=shape.image.blob, keep_proportion=False)
        except Exception as exc:  # noqa: BLE001
            notes.append({"slide": slide_no, "shape": shape.name, "issue": f"picture not drawn: {exc}"})
        return

    if is_table(shape):
        _draw_table(page, shape, rect, slide_no, notes)
        return

    if is_chart(shape):
        _draw_chart(page, shape, rect, slide_no, notes)
        return

    fill = _solid_rgb(shape)
    if fill is not None:
        page.draw_rect(rect, color=RULE, fill=fill, width=0.6)
    elif getattr(shape, "shape_type", None) is not None and shape.shape_type is not None:
        page.draw_rect(rect, color=RULE, width=0.4, dashes="[2 2] 0")

    if not has_text_frame(shape):
        return

    frame = shape.text_frame
    inset = fitz.Rect(
        rect.x0 + (frame.margin_left or 0) / EMU_PER_INCH * 72,
        rect.y0 + (frame.margin_top or 0) / EMU_PER_INCH * 72,
        rect.x1 - (frame.margin_right or 0) / EMU_PER_INCH * 72,
        rect.y1 - (frame.margin_bottom or 0) / EMU_PER_INCH * 72,
    )
    text = text_of(shape)
    if not text.strip():
        return
    size = run_size_pt(shape) or default_size_pt(shape)
    color = _text_rgb(shape)
    kind = (placeholder_kind(shape) or "").upper()
    align = 1 if kind in {"CENTER_TITLE", "TITLE"} else 0
    # Title-like placeholders inherit middle anchoring from the master; the
    # preview would otherwise pin every title to the top of its box.
    if kind in {"CENTER_TITLE", "TITLE", "SUBTITLE"}:
        needed = estimated_text_height_in(shape) or 0.0
        slack = inset.height - needed * 72
        if slack > 4:
            inset = fitz.Rect(inset.x0, inset.y0 + slack / 2, inset.x1, inset.y1)
    spare = _draw_text(page, inset, text, size, color, align)
    if spare < 0:
        # PyMuPDF draws nothing at all when the text cannot fit. Grow the frame
        # downward and retry so the preview shows the overflow instead of an
        # empty box, and still report it.
        grown = fitz.Rect(inset.x0, inset.y0, inset.x1, inset.y1 + abs(spare) + 24)
        _draw_text(page, grown, text, size, color, align)
        notes.append(
            {
                "slide": slide_no,
                "shape": shape.name,
                "issue": "text overflows its frame",
                "fontPt": round(size, 1),
                "overflowPt": round(-spare, 1),
            }
        )


def _draw_table(page, shape, rect: fitz.Rect, slide_no: int, notes: list[dict[str, Any]]) -> None:
    table = shape.table
    columns = len(table.columns)
    rows = len(table.rows)
    if not columns or not rows:
        return
    widths = [column.width or 0 for column in table.columns]
    total_w = sum(widths) or 1
    heights = [row.height or int(0.4 * EMU_PER_INCH) for row in table.rows]
    total_h = sum(heights) or 1
    x = rect.x0
    y = rect.y0
    for row_index in range(rows):
        row_h = rect.height * (heights[row_index] / total_h)
        x = rect.x0
        for column_index in range(columns):
            column_w = rect.width * (widths[column_index] / total_w)
            cell_rect = fitz.Rect(x, y, x + column_w, y + row_h)
            page.draw_rect(cell_rect, color=RULE, width=0.5, fill=PANEL if row_index == 0 else None)
            cell = table.cell(row_index, column_index)
            cell_text = (cell.text or "").strip()
            if cell_text:
                size = 10.0 if row_index else 10.5
                inner = fitz.Rect(cell_rect.x0 + 4, cell_rect.y0 + 2, cell_rect.x1 - 4, cell_rect.y1 - 2)
                spare = _draw_text(page, inner, cell_text, size, INK)
                if spare < 0:
                    notes.append({"slide": slide_no, "shape": f"{shape.name}[{row_index},{column_index}]", "issue": "table cell clips"})
            x += column_w
        y += row_h


def _draw_chart(page, shape, rect: fitz.Rect, slide_no: int, notes: list[dict[str, Any]]) -> None:
    chart = shape.chart
    page.draw_rect(rect, color=RULE, fill=(1, 1, 1), width=0.8)
    title = ""
    try:
        if chart.has_title and chart.chart_title.text_frame.text.strip():
            title = chart.chart_title.text_frame.text.strip()
    except Exception:  # noqa: BLE001
        title = ""
    plot = fitz.Rect(rect.x0 + 18, rect.y0 + 12, rect.x1 - 14, rect.y1 - 26)
    if title:
        _draw_text(page, fitz.Rect(plot.x0, rect.y0 + 4, plot.x1, rect.y0 + 26), title, 11, INK)
        plot = fitz.Rect(plot.x0, rect.y0 + 30, plot.x1, rect.y1 - 26)

    try:
        categories = [str(category) for category in chart.plots[0].categories]
    except Exception:  # noqa: BLE001
        categories = []
    series: list[tuple[str, list[float]]] = []
    try:
        for plot_series in chart.series:
            values = [float(value) if value is not None else 0.0 for value in plot_series.values]
            series.append((str(plot_series.name), values))
    except Exception:  # noqa: BLE001 - a broken chart cache must not kill the render
        notes.append({"slide": slide_no, "shape": shape.name, "issue": "chart values unreadable"})

    if not series or not categories:
        _draw_text(page, plot, "chart data unavailable", 11, MUTED)
        return

    kind = str(getattr(chart, "chart_type", ""))
    max_value = max([abs(value) for _, values in series for value in values] + [1.0])
    baseline = plot.y1 - 16

    if "PIE" in kind.upper() or "DOUGHNUT" in kind.upper():
        values = series[0][1]
        total = sum(abs(value) for value in values) or 1.0
        center = fitz.Point((plot.x0 + plot.x1) / 2, (plot.y0 + baseline) / 2)
        radius = min(plot.width, baseline - plot.y0) * 0.34
        start = 0.0
        shades = [0.25, 0.40, 0.55, 0.70, 0.85, 0.95]
        for index, value in enumerate(values):
            sweep = 360.0 * abs(value) / total
            shade = shades[index % len(shades)]
            # PyMuPDF 1.28 dropped Page.draw_pie; draw_sector has been stable since 1.16.
            edge = fitz.Point(center.x + radius * math.cos(math.radians(start)), center.y + radius * math.sin(math.radians(start)))
            page.draw_sector(center, edge, sweep, color=RULE, fill=(shade, shade, shade * 0.95 + 0.05), width=0.6)
            start += sweep
        return

    if "LINE" in kind.upper():
        step = plot.width / max(len(categories) - 1, 1)
        for series_index, (_, values) in enumerate(series):
            points = []
            for index, value in enumerate(values):
                x = plot.x0 + step * index
                y = baseline - (abs(value) / max_value) * (baseline - plot.y0 - 6)
                points.append(fitz.Point(x, y))
            if len(points) > 1:
                shade = 0.20 + 0.18 * series_index
                page.draw_polyline(points, color=(shade, shade, shade + 0.1), width=1.6)
            for point in points:
                page.draw_circle(point, 2.0, color=ACCENT, fill=ACCENT)
        _draw_categories(page, plot, baseline, categories)
        return

    group_width = plot.width / max(len(categories), 1)
    bar_width = group_width * 0.6 / max(len(series), 1)
    for index, category in enumerate(categories):
        for series_index, (_, values) in enumerate(series):
            if index >= len(values):
                continue
            value = abs(values[index])
            bar_height = (value / max_value) * (baseline - plot.y0 - 8)
            x0 = plot.x0 + group_width * index + group_width * 0.2 + bar_width * series_index
            bar = fitz.Rect(x0, baseline - bar_height, x0 + bar_width * 0.92, baseline)
            shade = 0.30 + 0.22 * series_index
            page.draw_rect(bar, color=ACCENT, fill=(shade * 0.55, shade * 0.75, shade), width=0.5)
            _draw_text(page, fitz.Rect(bar.x0 - 6, bar.y0 - 12, bar.x1 + 6, bar.y0), _short(values[index]), 7.5, MUTED, 1)
    page.draw_line(fitz.Point(plot.x0, baseline), fitz.Point(plot.x1, baseline), color=RULE, width=0.8)
    _draw_categories(page, plot, baseline, categories)


def _short(value: float) -> str:
    return f"{value:g}"


def _draw_categories(page, plot: fitz.Rect, baseline: float, categories: list[str]) -> None:
    group_width = plot.width / max(max(len(categories), 1), 1)
    for index, category in enumerate(categories):
        cell = fitz.Rect(
            plot.x0 + group_width * index,
            baseline + 2,
            plot.x0 + group_width * (index + 1) - 2,
            baseline + 18,
        )
        _draw_text(page, cell, category[:18], 7.5, MUTED, 1)


def render_preview(pptx_path: str | Path, out_dir: str | Path, width_px: int = 1600) -> dict[str, Any]:
    """Rasterise every slide to `<out_dir>/slide-NN.png`; returns a JSON-able report."""
    presentation = open_presentation(pptx_path)
    destination = Path(out_dir)
    destination.mkdir(parents=True, exist_ok=True)
    slide_w_in, slide_h_in = slide_size_in(presentation)
    page_w = slide_w_in * 72
    page_h = slide_h_in * 72
    zoom = max(1.0, width_px / page_w)

    files: list[str] = []
    notes: list[dict[str, Any]] = []
    document = fitz.open()
    try:
        for slide_no, slide in enumerate(presentation.slides, start=1):
            page = document.new_page(width=page_w, height=page_h)
            page.draw_rect(fitz.Rect(0, 0, page_w, page_h), color=None, fill=(1, 1, 1))
            try:
                background = slide.background.fill
                rgb = background.fore_color.rgb
                page.draw_rect(
                    fitz.Rect(0, 0, page_w, page_h),
                    color=None,
                    fill=(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255),
                )
            except Exception:  # noqa: BLE001 - most decks inherit a white master
                pass
            for shape in iter_shapes(slide.shapes):
                _draw_shape(page, shape, slide_no, notes)
            page.insert_text(
                fitz.Point(page_w - 54, page_h - 10),
                f"{slide_no}",
                fontsize=7,
                fontname="helv",
                color=MUTED,
            )
            png = destination / f"slide-{slide_no:02d}.png"
            page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(str(png))
            files.append(str(png.resolve()))
    finally:
        document.close()

    report = {
        "ok": True,
        "engine": "draft-preview",
        "fidelity": "geometry-only",
        "note": "Shapes redrawn from OOXML; fonts and theme colours are approximations. Use it to judge placement, collisions and overflow, not typography.",
        "slides": len(files),
        "slideSize": [round(slide_w_in, 3), round(slide_h_in, 3)],
        "files": files,
        "overflow": notes,
    }
    (destination / "preview.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Rasterise a .pptx to PNGs using a draft geometry renderer (no Office required).")
    parser.add_argument("presentation", help="path to the .pptx")
    parser.add_argument("--out-dir", required=True, help="directory for slide-NN.png and preview.json")
    parser.add_argument("--width", type=int, default=1600, help="output pixel width (default 1600)")
    args = parser.parse_args(argv)

    report = render_preview(args.presentation, args.out_dir, args.width)
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if report["slides"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
