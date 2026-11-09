# Finalization checklist

Run this before `present`. Every item has shipped a broken deck at least once.

## The file

- [ ] Opens: `"<python>" "<cli>" pptx read --input deck.pptx` returns slides.
- [ ] Package is coherent:
      `"<python>" "<skill>/container_tools/inspect_presentation_package_integrity.py" --input deck.pptx`
      → `passed: true`, no dangling relationships, media and charts present.
- [ ] Slide count matches the intent; nothing left over from an earlier draft.
- [ ] Core properties set:
      `"<python>" "<skill>/container_tools/core_properties.py" --input deck.pptx --title "..." --author "..."`
      (an untitled deck shows as "PowerPoint Presentation" in every file list).

## The content

- [ ] Every placeholder filled or deleted — no "Click to add text".
- [ ] No default chart title ("Chart Title") survives:
      `"<python>" "<skill>/container_tools/native_chart_title_gate.py" --input deck.pptx`.
- [ ] Totals are arithmetic:
      `"<python>" "<skill>/container_tools/native_table_arithmetic_gate.py" --input deck.pptx --contracts totals.json`.
- [ ] Charts have their data in the file (portable mode passes) and categories
      are in a meaningful order.
- [ ] Numbers in the deck agree with the source data at the precision shown.
- [ ] Speaker notes carry the provenance of the non-obvious numbers.

## The layout

- [ ] Geometry gate passes:
      `"<python>" "<skill>/container_tools/inspect_presentation_layout_geometry.py" --input deck.pptx --json-out geometry.json`
      → `passed: true`; review findings read and consciously accepted.
- [ ] Nothing outside the slide edge, nothing overlapping the footer zone.
- [ ] Titles are one or two lines; no title ends in a full stop.
- [ ] Body text at least 18 pt, captions at least 12 pt.
- [ ] One idea per slide, one emphasis per paragraph.

## The look

- [ ] Rendered at viewing size and actually looked at:
      `"<python>" "<skill>/container_tools/render_slides.py" --input deck.pptx --out-dir preview`
      then `read_image` on each PNG (or on the contact sheet from
      `"<skill>/template_following_scripts/make_contact_sheet.py`).
- [ ] Text is not clipped, ellipsised or shrunk to illegibility.
- [ ] Photographs are not stretched; their sources are listed.
- [ ] Charts read at thumbnail size: the point is visible before any label.
- [ ] Cover and closing slide both say something.

## Delivery

- [ ] The file lives in the user's workspace, not in a temp directory.
- [ ] Output name is either new (`deck.pptx`) or `<original>-edited.pptx`.
- [ ] `present` called; the reply states what changed in one sentence and, for
      edits, both paths.

## When rendering is unavailable

`render_slides.py --engine draft` draws a PyMuPDF geometry preview when no office
suite is installed. Type is drawn at declared sizes in a substitute face and
layout chrome is not rendered. Use it to catch overlap, overflow and placement —
not to judge typography.
