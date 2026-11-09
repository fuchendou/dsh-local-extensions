# Task: apply an annotation payload

The user draws on a rendered slide and sends back an `office-annotations` block.
Treat it as a change request with coordinates, not as editor state.

## 1. Re-create the geometry the user drew on

Annotations refer to the preview the user saw. Render the same way so the
coordinates mean the same thing:

```bash
"<python>" "<skill>/container_tools/render_slides.py" --input deck.pptx --out-dir preview
```

Slide index = `page` in the payload, 1-based. Keep the PNGs to compare the same
slide before and after.

## 2. Resolve each annotation to shapes

The region is normalised 0–1 on that slide image. Map it to inches:

```
left_in   = region.left   * slide_width_in
top_in    = region.top    * slide_height_in
width_in  = region.width  * slide_width_in
height_in = region.height * slide_height_in
```

Select candidate shapes whose bounding box overlaps that rect, largest overlap
first:

```bash
"<python>" "<skill>/container_tools/inspect_presentation_layout_geometry.py" --input deck.pptx --json-out geometry.json
```

`geometry.json` lists every shape per slide with `left`, `top`, `width`, `height`
in inches, plus its text. Overlapping shapes (a title over a background panel)
are common: use the annotation's `text` to disambiguate — prefer an exact or
prefix match.

## 3. Decide the smallest edit

| Requirement reads like | Do this |
|---|---|
| "change this wording" | run-level replace on that shape ([edit-deck](edit-deck.md)) |
| "move this down" | set `left/top` on that shape only |
| "make this bigger" | set font size on the runs of that shape, then re-check fit |
| "this overlaps the table" | resize the shape, or the table, not the whole slide |
| "recolour" | change the run colour, not the theme |
| "add a line here" | the rect is a position, not an insertion point: add the shape at that rect, matching nearby type |

Never restyle a slide to satisfy a region. The region identifies *what*, the
requirement says *how much*.

## 4. Apply, write a copy, re-render

Mutations go through this pack's tools (`replace_text.py`, `add_slides.py`,
`core_properties.py`) or a focused `python-pptx` snippet — always to
`<original>-edited.pptx`.

```bash
"<python>" "<skill>/container_tools/replace_text.py" --input deck.pptx --find "old" --replace "new" --out deck-edited.pptx
"<python>" "<skill>/container_tools/render_slides.py" --input deck-edited.pptx --out-dir preview-after
```

## 5. Confirm, in words

Open the same slide number and check the region now looks right. Report which
shape changed, what changed, and the slide number.

## When it cannot be mapped

- Empty region, or no shape overlaps it → say the region covers blank space and
  ask what object was meant.
- Overlapping candidates that `text` does not disambiguate → name both and ask.
- The requirement is about something the file has no geometry for (an uninstalled
  font, a transition) → say so plainly.
- The region covers a chart or table whose values would need to change → state
  that values come from the data, and ask for corrected figures rather than
  editing rendered numbers.

Never guess silently. "I changed the title on slide 3; the region also touched the
subtitle, which I left alone" is a good answer. Silence plus a diff is not.
