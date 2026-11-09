# Slide mechanics and paste-runnable recipes

The helper CLI covers the common path: title, bullets, table, chart, picture.
Everything else — exact coordinates, master edits, notes, theme tokens,
connectors — is `python-pptx` work. These recipes are the route and run as-is
from a shell, from any working directory:

```bash
"<python>" - <<'PY'
from pptx import Presentation
...
PY
```

## The four numbers that decide every layout

| Question | Answer |
|---|---|
| Where is this shape? | `left`, `top`, `width`, `height` in **EMU** (English Metric Units). |
| What is an inch? | `914400` EMU. `pptx.util.Inches(1)` is the polite wrapper. |
| What is a point? | `12700` EMU. Font sizes use points, geometry uses EMU; mixing them silently breaks layout. |
| What is a slide? | `prs.slide_width` / `prs.slide_height`; check them, never assume 16:9. |

`Emu(914400) == Inches(1)`, `Pt(28) == Emu(355600)`, and a slide fraction is
`int(0.1 * prs.slide_width)`.

## Z-order

Shapes paint in `slide.shapes` order; later covers earlier. Reorder without
deleting:

```python
tree = slide.shapes._spTree
shape = slide.shapes[3]
tree.remove(shape._element)
tree.insert(2, shape._element)  # after nvGrpSpPr and grpSpPr
```

Index `2` is the first painted shape — where a full-bleed background belongs.

## What this pack ships

| Recipe | Use it when |
|---|---|
| [textbox-at-coordinate](textbox-at-coordinate.md) | Text must land on an exact rect, not "somewhere under the title". |
| [autolayout](autolayout.md) | The same build must fit 3 bullets or 9 without hand-tuning. |
| [tables](tables.md) | Numbers need column widths and per-cell formatting. |
| [native-charts](native-charts.md) | Data must stay editable, not a chart picture. |
| [master-and-layouts](master-and-layouts.md) | Whole-deck changes: title bar, accent line, footer. |
| [speaker-notes](speaker-notes.md) | A script attached to each slide. |
| [theme-tokens](theme-tokens.md) | Colours and fonts from one place. |
| [rich-text-runs](rich-text-runs.md) | One paragraph mixes bold, accent colour, footnote. |
| [images](images.md) | A crop, a cover fit or real alt text. |
| [connectors](connectors.md) | A line between boxes that survives a move. |

## Order of work

Follow the loop in [authoring-workflow](../references/authoring-workflow.md):
story → frame → place top-down in EMU → fill or delete placeholders → render and
look. Type sizes live in [style-guidelines](../references/style-guidelines.md).
