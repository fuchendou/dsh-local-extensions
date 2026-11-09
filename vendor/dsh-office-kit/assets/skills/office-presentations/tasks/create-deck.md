# Task: create a deck

## Inputs to settle first

- Audience and setting: live talk, read-on-its-own PDF, or both. A read-only
  deck needs more words; a live deck needs fewer.
- Length: number of slides or minutes.
- Brand: a template file, a colour, or the defaults in
  [style-guidelines](../references/style-guidelines.md).
- Evidence: numbers, charts, tables, images the user has. Never invent a metric —
  if a number is needed and missing, say so.

## Route

### Fast path: the spec-driven builder

For the ordinary deck (cover, bullets, section, table, chart, image, closing):

```bash
"<python>" "<cli>" pptx create --spec deck-spec.json --out deck.pptx
```

`deck-spec.json`:

```json
{
  "title": "Automation Review",
  "author": "Warehouse Ops",
  "slides": [
    { "layout": "title", "title": "Automation Review", "subtitle": "Warehouse network · FY2026" },
    {
      "layout": "bullets",
      "title": "Where the time goes",
      "bullets": [{ "text": "Picking is 41% of floor labour hours" }, { "text": "Aisle travel costs 12 minutes per order" }]
    },
    { "layout": "section", "title": "What the pilot measured" },
    {
      "layout": "blank",
      "title": "Throughput rose while touches fell",
      "table": {
        "headers": ["Quarter", "Orders", "Touches"],
        "rows": [["Q1", 100, 410], ["Q2", 128, 402], ["Total", 228, 812]]
      }
    },
    {
      "layout": "blank",
      "title": "Orders per quarter",
      "chart": {
        "type": "column",
        "title": "Orders fulfilled per quarter",
        "categories": ["Q1", "Q2"],
        "series": [{ "name": "Orders", "values": [100, 128] }],
        "left": 0.9,
        "top": 1.45,
        "width": 11.5,
        "height": 5.1
      }
    },
    {
      "layout": "bullets",
      "title": "Decision for Thursday",
      "bullets": [{ "text": "Approve two cells in Q1" }]
    }
  ]
}
```

Layouts: `title`, `bullets`, `section`, `title_only`, `blank`. Tables sit 0.8 in
from the left at the running cursor and cannot be positioned — give a table its
own slide, or use the [tables recipe](../recipes/tables.md).

### Everything else: build it with the recipes

Anything at a coordinate, any crop, connector or master change is a `python-pptx`
snippet: [textbox at a coordinate](../recipes/textbox-at-coordinate.md),
[auto-layout](../recipes/autolayout.md), [tables](../recipes/tables.md) ·
[native charts](../recipes/native-charts.md), [images](../recipes/images.md) ·
[connectors](../recipes/connectors.md), [rich text
runs](../recipes/rich-text-runs.md) · [theme tokens](../recipes/theme-tokens.md),
[speaker notes](../recipes/speaker-notes.md) · [masters and
layouts](../recipes/master-and-layouts.md).

Extending a deck you already built:

```bash
"<python>" "<skill>/container_tools/add_slides.py" --input deck.pptx --spec extra-slides.json --out deck-2.pptx
```

### From a template

See [template-following](template-following.md). Do not rebuild a supplied
template's look by hand.

## Then

1. Set properties: `"<python>" "<skill>/container_tools/core_properties.py" --input deck.pptx --title "..." --author "..."`.
2. Verify: [inspect-and-verify](inspect-and-verify.md).
3. Deliver with `present`.

## Writing the slides

Story first: the one-sentence claim for every slide, in order, then fill the
frames (loop in [authoring-workflow](../references/authoring-workflow.md)). A
claim needing two sentences is two slides. Bullets are claims
([native-bullets](../references/native-bullets.md)); evidence is native
([native-evidence](../references/native-evidence.md)).
