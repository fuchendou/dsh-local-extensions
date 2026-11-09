"""Shared helpers for the slide-deck container tools.

Purpose: one import surface for the small, boring things every checker needs —
opening a deck, walking shapes (including groups), reading a bounding box in
inches, guessing how much room a line of text needs, and printing a JSON
verdict. Nothing here decides anything; the scripts do.

Import from a sibling script with:

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ooxml_helpers import ...

Exit codes are documented per script; this module only exits when a caller
passes a bad path to `open_presentation`.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Iterator

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

EMU_PER_INCH = 914400

# Anything that renders about a full em wide and wraps mid-token.
WIDE_CHAR = re.compile(r"[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]")
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’.,%+\-]*")

TOTAL_WORDS = re.compile(
    r"\b(total|totals|sum|sums|subtotal|sub-total|grand\s+total|overall|all\s+regions?|combined)\b",
    re.IGNORECASE,
)
NOT_ADDITIVE = re.compile(
    r"(rate|ratio|percent|percentage|%|share|average|avg|mean|median|margin|margin\s+%|uplift|"
    r"growth|index|price|unit|cpu|latency|duration|per\s+unit|headcount\s+ratio)",
    re.IGNORECASE,
)
PLACEHOLDER_TITLE = re.compile(r"^(chart\s*title|title|click\s+to\s+add\s+(a\s+)?title)\s*$", re.IGNORECASE)


def open_presentation(path: str | Path):
    """Open a .pptx; exits 2 with a JSON error if it cannot be read."""
    from pptx import Presentation

    target = Path(path)
    if not target.is_file():
        emit_error("input_missing", f"no such file: {target}")
        raise SystemExit(2)
    try:
        return Presentation(str(target))
    except Exception as exc:  # noqa: BLE001 - report, never traceback at the user
        emit_error("unreadable_presentation", f"{type(exc).__name__}: {exc}")
        raise SystemExit(2)


def slide_size_in(prs) -> tuple[float, float]:
    return prs.slide_width / EMU_PER_INCH, prs.slide_height / EMU_PER_INCH


def iter_shapes(shapes) -> Iterator[Any]:
    """Yield every shape, descending into groups."""
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    for shape in shapes:
        yield shape
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_shapes(shape.shapes)


def box(shape) -> tuple[float, float, float, float] | None:
    """(left, top, width, height) in inches, or None when the shape has no frame."""
    if shape.left is None or shape.top is None:
        return None
    width = shape.width or 0
    height = shape.height or 0
    return (
        shape.left / EMU_PER_INCH,
        shape.top / EMU_PER_INCH,
        width / EMU_PER_INCH,
        height / EMU_PER_INCH,
    )


def label(shape) -> str:
    name = getattr(shape, "name", "") or ""
    if name:
        return name
    return f"{shape.shape_type}"


def placeholder_kind(shape) -> str | None:
    """Placeholder role as a bare token: TITLE, BODY, SUBTITLE, DATE, ...

    python-pptx stringifies the enum differently across versions ("TITLE (13)",
    "<PP_PLACEHOLDER.TITLE: 13>"), so the number and decorations are stripped
    here and every caller can compare against one spelling.
    """
    try:
        fmt = shape.placeholder_format
    except (AttributeError, ValueError, KeyError):
        return None
    if fmt is None:
        return None
    kind = getattr(fmt, "type", None)
    if kind is None:
        return "UNKNOWN"
    raw = str(kind).upper().replace("PP_PLACEHOLDER.", " ")
    for token in ("<", ">", "(", ")", ":", "."):
        raw = raw.replace(token, " ")
    tokens = [token for token in raw.split() if token and not token.isdigit()]
    return tokens[-1] if tokens else "UNKNOWN"


def has_text_frame(shape) -> bool:
    return getattr(shape, "has_text_frame", False) and shape.has_text_frame


def text_of(shape) -> str:
    if not has_text_frame(shape):
        return ""
    return "\n".join(p.text for p in shape.text_frame.paragraphs).strip()


def has_visible_text(shape) -> bool:
    return bool(text_of(shape))


def run_size_pt(shape) -> float | None:
    """Largest explicit size in the shape, or None when fully inherited.

    Size can sit on the run or on the paragraph's default run properties; a
    paragraph-level size still resolves in PowerPoint, so both count.
    """
    if not has_text_frame(shape):
        return None
    sizes: list[float] = []
    for paragraph in shape.text_frame.paragraphs:
        try:
            if paragraph.font.size is not None:
                sizes.append(paragraph.font.size.pt)
        except AttributeError:  # older python-pptx without paragraph.font
            pass
        sizes.extend(run.font.size.pt for run in paragraph.runs if run.font.size is not None)
    return max(sizes) if sizes else None


def paragraph_size_pt(paragraph, fallback: float) -> float:
    try:
        if paragraph.font.size is not None:
            return paragraph.font.size.pt
    except AttributeError:
        pass
    for run in paragraph.runs:
        if run.font.size is not None:
            return run.font.size.pt
    return fallback


def default_size_pt(shape) -> float:
    """Approximate the size a viewer resolves for an under-specified text box."""
    kind = (placeholder_kind(shape) or "").upper()
    if "CENTER_TITLE" in kind:
        return 44.0
    if "TITLE" in kind:
        return 32.0
    if "SUBTITLE" in kind:
        return 20.0
    if "BODY" in kind:
        return 18.0
    return 18.0


def line_height_in(font_pt: float, spacing: float = 1.2) -> float:
    return font_pt * spacing / 72.0


def wrap_lines(text: str, font_pt: float, width_in: float) -> int:
    """Crude but stable line count: wide chars cost one em, latin words wrap."""
    if not text.strip():
        return 1
    per_line = max(1.0, width_in * 72.0 / max(font_pt, 1.0))
    used = 0.0
    lines = 1
    for token in re.findall(r"\S+\s*", text):
        cost = 0.0
        for char in token:
            cost += 1.0 if WIDE_CHAR.match(char) else 0.55
        if used + cost > per_line and used > 0:
            lines += 1
            used = cost
        else:
            used += cost
    return lines


def estimated_text_height_in(shape) -> float | None:
    """Rough height the text needs at its declared size, or None if no text."""
    if not has_text_frame(shape):
        return None
    geometry = box(shape)
    if geometry is None:
        return None
    frame = shape.text_frame
    inner_w = max(0.2, geometry[2] - (frame.margin_left + frame.margin_right) / EMU_PER_INCH)
    total = 0.0
    any_text = False
    for paragraph in frame.paragraphs:
        text = paragraph.text
        if not text.strip():
            total += line_height_in(default_size_pt(shape)) * 0.5
            continue
        any_text = True
        size = default_size_pt(shape)
        for run in paragraph.runs:
            if run.font.size is not None:
                size = run.font.size.pt
                break
        else:
            size = paragraph_size_pt(paragraph, size)
        total += wrap_lines(text, size, inner_w) * line_height_in(size)
    return total if any_text else None


def is_picture(shape) -> bool:
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    return shape.shape_type == MSO_SHAPE_TYPE.PICTURE


def is_table(shape) -> bool:
    return getattr(shape, "has_table", False) and shape.has_table


def is_chart(shape) -> bool:
    return getattr(shape, "has_chart", False) and shape.has_chart


def is_connector(shape) -> bool:
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    return shape.shape_type in {MSO_SHAPE_TYPE.LINE, MSO_SHAPE_TYPE.FREEFORM} or shape.__class__.__name__ == "Connector"


def is_decorative(shape) -> bool:
    """Shapes a template owner would call furniture: no text, or a picture/line."""
    return is_picture(shape) or is_connector(shape) or not has_text_frame(shape) or not has_visible_text(shape)


def cell_number(value: str) -> float | None:
    """Parse a numeric table cell; None when it is not a number."""
    text = (value or "").strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    cleaned = re.sub(r"[,\s\u00a0]", "", text.strip("()"))
    cleaned = re.sub(r"^[^\d+\-.]*", "", cleaned)
    match = re.match(r"^[+-]?\d*\.?\d+", cleaned)
    if not match:
        return None
    try:
        number = float(match.group(0))
    except ValueError:
        return None
    return -number if negative else number


def decimals(value: str) -> int:
    match = re.search(r"\.(\d+)", (value or "").replace(",", ""))
    return len(match.group(1)) if match else 0


def rects_intersect(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return not (ax + aw <= bx or bx + bw <= ax or ay + ah <= by or by + bh <= ay)


def intersection_area(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    dx = min(ax + aw, bx + bw) - max(ax, bx)
    dy = min(ay + ah, by + bh) - max(ay, by)
    return max(0.0, dx) * max(0.0, dy)


def overlap_ratio(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    smaller = min(a[2] * a[3], b[2] * b[3])
    if smaller <= 0:
        return 0.0
    return intersection_area(a, b) / smaller


def emit(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def emit_error(code: str, message: str) -> None:
    emit({"ok": False, "error": {"code": code, "message": message}})


def finding(kind: str, severity: str, message: str, **extra: Any) -> dict[str, Any]:
    payload = {"kind": kind, "severity": severity, "message": message}
    payload.update({key: value for key, value in extra.items() if value is not None})
    return payload


def number_or_none(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def iter_media_parts(prs) -> Iterable[Any]:
    for part in prs.part.package.iter_parts():
        if "/media/" in str(part.partname):
            yield part


def demo() -> int:
    """Self-check: the three estimates every gate leans on. Run with --help too."""
    # A 40-character latin line at 18pt needs ~ (40*0.55*18)/72 = 5.5in.
    assert wrap_lines("x" * 40, 18, 5.5) == 1
    # Words wrap: 20 tokens cost 20 * 1.1em, so a 2in frame splits them.
    assert wrap_lines("ab " * 20, 18, 2.0) > 1
    # Wide characters cost a full em, so the same word count needs more lines.
    assert wrap_lines("物 " * 20, 18, 2.0) > wrap_lines("x " * 20, 18, 2.0)
    assert cell_number("(1,234.50)") == -1234.5
    assert cell_number("n/a") is None
    assert decimals("1.50") == 2
    # Coplanar 2x2 boxes offset by 1in share half the smaller area: ratio 0.5.
    assert abs(overlap_ratio((0, 0, 2, 2), (1, 0, 2, 2)) - 0.5) < 1e-9
    # A box swallowed whole counts as fully covered.
    assert overlap_ratio((0, 0, 2, 2), (0, 0, 2, 1)) == 1.0
    emit({"ok": True, "module": "ooxml_helpers", "helpers": 24, "checks": "wrap_lines, cell_number, decimals, overlap_ratio"})
    return 0


if __name__ == "__main__":
    raise SystemExit(demo())
