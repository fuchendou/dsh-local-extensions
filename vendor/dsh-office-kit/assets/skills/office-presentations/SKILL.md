---
description: Create, edit, inspect, and verify PowerPoint .pptx slide decks — slides, templates, charts, render — with python-pptx and the bundled Office helper CLI.
---

# Presentations (.pptx)

A `.pptx` is a zip of XML parts — slides, layouts, masters, charts with embedded
workbooks, notes, media — and the reader sees only those parts. Author them, then
read the file back.

`<python> "<cli>" pptx {create|read|render}` plus `office_status` builds from a
JSON spec, reads structure and renders; it does not mutate. Everything else is
here: [recipes](recipes/README.md), mutation tools and gates in
[container_tools/](container_tools/), templates in
[template_following_scripts/](template_following_scripts/). Author with
`python-pptx` — real shapes, chart parts, notes, never a screenshot.

## Before any file work

Call `office_status`. Read the `## Office runtime` JSON block appended to this
file for the absolute `python`, `cli`, `skill` and `shared` values; quote paths.
No working runtime → stop and report the diagnostic and deployment-document
remedy. Do not install dependencies automatically or claim a deck was created
or verified without a runtime.

## Delivery

`present` the finished file, then state the change in one sentence. A bare path
is not delivery: chat renders `.docx`/`.pptx`/`.xlsx`/`.pdf` links as
"二进制文件，无法显示改动".

- Create: write into the user's workspace, verify, `present`.
- Edit: never overwrite the original. Write `<original>-edited.<ext>` (or the
  user's name), verify, `present`, and give both paths.

## Annotations

An `office-annotations` block — `[{ page, text, requirement, region: { left,
top, width, height } }]` — is a change request, not editor state. `page` is the
1-based preview slide; `region` is 0–1 on it, mapped to inches by
`left_in = region.left * slide_width_in`. Select shapes by bounding-box overlap,
`text` breaking ties. Apply the smallest edit satisfying `requirement`, re-render,
confirm. Unmappable → say what you cannot locate; never guess.

Full procedure, mapping arithmetic and the edit table:
[tasks/apply-annotations.md](tasks/apply-annotations.md). Candidates come from
`container_tools/inspect_presentation_layout_geometry.py --json-out
geometry.json`.

## Verify

Render, look at every page, then deliver.

```bash
"<python>" "<skill>/container_tools/render_slides.py" --input "<file.pptx>" --out-dir "<render-dir>"
```

`render_slides.py` uses the CLI's `pptx render` (DSH LibreOffice kit) and falls
back to a draft preview without the kit, so it is always the right entry point.
JSON `engine: "libreoffice-kit"` means a faithful render.

`read_image` every PNG, or one sheet via
`"<skill>/template_following_scripts/make_contact_sheet.py"`. Check: titles one
or two lines, body ≥ 18 pt, nothing clipped or off-slide, no empty placeholder,
table and chart not overlapping, chart readable at thumbnail size.

No office suite: `--engine draft` is a PyMuPDF geometry preview — placement, not
typography. Say which you used.

The six blocking gates and their flags are owned by
[tasks/inspect-and-verify.md](tasks/inspect-and-verify.md); a gate that reports
`passed: false` stops delivery.

Never present a deck you have not rendered and looked at.

## Tasks

| Job | Start here |
|---|---|
| Create a deck | [tasks/create-deck.md](tasks/create-deck.md) |
| Edit an existing deck | [tasks/edit-deck.md](tasks/edit-deck.md) |
| Inspect, gate and verify | [tasks/inspect-and-verify.md](tasks/inspect-and-verify.md) |
| Follow a supplied template | [tasks/template-following.md](tasks/template-following.md) |
| Charts, tables, speaker notes | [tasks/charts-tables-notes.md](tasks/charts-tables-notes.md) |
| Apply an annotation payload | [tasks/apply-annotations.md](tasks/apply-annotations.md) |

## Tools and recipes

Mutations: one JSON object, non-zero exit on failure, default
`<original>-edited.pptx`.

| Need | Command |
|---|---|
| Replace text, run-level | `"<skill>/container_tools/replace_text.py" --input "<deck>" --find "old" --replace "new"` |
| Append slides | `"<skill>/container_tools/add_slides.py" --input "<deck>" --spec "<slides.json>"` |
| Core properties | `"<skill>/container_tools/core_properties.py" --input "<deck>" --title "..."` |
| Render | `"<skill>/container_tools/render_slides.py" --input "<deck>" --out-dir "<dir>"` |
| Contact sheet | `"<skill>/template_following_scripts/make_contact_sheet.py" --dir "<dir>" --out "<sheet.png>"` |

Template flow: `inspect_template_deck.py` → frame map →
`validate_template_plan.py` → `prepare_template_starter_deck.py` →
`check_template_fidelity.py`.

Recipes: [README](recipes/README.md) · [textbox at a
coordinate](recipes/textbox-at-coordinate.md) · [auto-layout](recipes/autolayout.md) ·
[tables](recipes/tables.md) · [native charts](recipes/native-charts.md) ·
[masters and layouts](recipes/master-and-layouts.md) · [speaker
notes](recipes/speaker-notes.md) · [theme tokens](recipes/theme-tokens.md) ·
[rich text runs](recipes/rich-text-runs.md) · [images](recipes/images.md) ·
[connectors](recipes/connectors.md).

Guidance: [authoring workflow](references/authoring-workflow.md) ·
[style](references/style-guidelines.md) ·
[bullets](references/native-bullets.md) ·
[evidence](references/native-evidence.md) ·
[templates](references/templates.md) ·
[finalization](references/finalization.md) ·
[finance decks](domain_guidance/finance.md) ·
[Google Slides](routing/google_slides.md).

## Non-negotiables

- One idea per slide; a title is a claim, not a label.
- Body ≥ 18 pt, title ≥ 28 pt, captions ≥ 12 pt.
- Native charts and tables, never a picture of a spreadsheet.
- Every placeholder filled or deleted; no "Chart Title", no trailing full stop on
  a heading.
- Numbers in the deck agree with the numbers supplied.
- New output in the user's workspace; an edit is a new file.

## Genuine gaps

- DSH LibreOffice kit missing (`office_status` reports `renderers.available: false`) →
  no true render. Use `--engine draft` and say the check was geometric; only a harness
  install shipping the kit fixes it (the plugin records its path in `config.json`
  on load), not a standalone Office/LibreOffice.
- Fonts the user lacks are substituted by any renderer; the pack cannot install
  them.
- Google Slides import fidelity is outside our control; see
  [routing/google_slides.md](routing/google_slides.md).

## Shared workflow

Use `"<shared>/common-workflow.md"` for the cross-format delivery loop, and
`"<shared>/annotation-recipes.md"` to turn an annotation payload into an edit.
