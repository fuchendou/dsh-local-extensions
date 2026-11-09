# Task: edit an existing deck

Editing is mutation, and mutation lives in this pack's tools, not in the helper
CLI: `container_tools/replace_text.py`, `add_slides.py`, `core_properties.py`,
plus the recipes for anything structural.

**Never write over the original.** Every tool defaults to
`<original>-edited.pptx`; keep that default unless the user names a path.

## 1. Understand the file first

```bash
"<python>" "<cli>" pptx read --input deck.pptx
"<python>" "<skill>/container_tools/inspect_presentation_layout_geometry.py" --input deck.pptx
```

`pptx read` gives titles, text, tables and chart data per slide; the geometry
gate gives every shape's rect in inches, to decide whether a new block fits.

## 2. Text changes: run-level replace

```bash
"<python>" "<skill>/container_tools/replace_text.py" --input deck.pptx \
  --find "Q4 2025" --replace "Q4 2026" --out deck-edited.pptx
```

Batch form:

```json
{
  "replacements": [
    { "find": "Q4 2025", "replace": "Q4 2026" },
    { "find": "€", "replace": "EUR ", "match_case": true },
    { "find": "draft", "replace": "final", "slide": 7 }
  ]
}
```

```bash
"<python>" "<skill>/container_tools/replace_text.py" --input deck.pptx --spec replacements.json
```

A pattern matches **inside a single run** only. Text PowerPoint split for
formatting ("**Q4** 2025") will not match "Q4 2025" and the report lists it under
`unmatched`. When a pattern cannot match, edit that paragraph with a run-level
snippet ([rich text runs](../recipes/rich-text-runs.md)) rather than widening the
match.

Exit code 1 means a pattern matched nothing; the file is still written, so read
`unmatched` before delivering.

## 3. Adding slides

```bash
"<python>" "<skill>/container_tools/add_slides.py" --input deck.pptx --spec extra-slides.json
```

The spec uses the same slide object as `pptx create` (`layout`, `title`,
`subtitle`, `bullets`, `table`, `chart`, `image`). Outside that vocabulary, add
the slide with `add_slides.py`, then place content with a recipe.

## 4. Metadata

```bash
"<python>" "<skill>/container_tools/core_properties.py" --input deck.pptx \
  --title "Automation Review" --author "Warehouse Ops" --subject "FY2026 capital plan"
```

## 5. Structural changes

| Change | Route |
|---|---|
| Move or resize a shape | set `.left/.top/.width/.height` from `slide.shapes` |
| Restyle a family | [masters and layouts](../recipes/master-and-layouts.md) |
| Add notes | [speaker notes](../recipes/speaker-notes.md) |
| Replace a chart's data | [native charts](../recipes/native-charts.md) — edit the series, do not paste a picture |
| Fix a table's total | [tables](../recipes/tables.md), then the arithmetic gate |
| Delete a slide | `prs.slides._sldIdLst.remove(...)` after `prs.part.drop_rel(rId)` |

## 6. Verify before delivering

Deleting or inserting a slide commonly breaks nothing visible and everything
relational:

```bash
"<python>" "<skill>/container_tools/inspect_presentation_package_integrity.py" --input deck-edited.pptx
"<python>" "<skill>/container_tools/render_slides.py" --input deck-edited.pptx --out-dir preview
```

Then look at the changed pages. A replacement that pushes a title onto a third
line is a layout change, not a text change.
