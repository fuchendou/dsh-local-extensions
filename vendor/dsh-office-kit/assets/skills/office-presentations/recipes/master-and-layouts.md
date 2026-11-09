# Masters, layouts and slide families

## Mechanics

A deck has three levels; where you make a change decides how many slides it
fixes:

- **Slide master** (`ppt/slideMasters/`) — theme fonts, colours, background, and
  the shapes every slide inherits (title bar, accent rule, logo).
- **Slide layout** (`ppt/slideLayouts/`) — one per slide family (title, title and
  content, section, blank…), each with named placeholders at fixed rects.
- **Slide** — its own shapes plus *placeholder overrides*: text, and position if
  someone dragged a placeholder.

Editing a placeholder's *text* is a per-slide change. Editing the layout's
placeholder *rect* moves that frame on every slide of that family. Editing the
master's background moves it everywhere.

`slide.slide_layout` is read-only; the family is fixed when the slide is created.
To change a slide's family, delete it and add a new one from the target layout —
losing its content, so plan families before filling them.

**One quirk:** `master.shapes` and `layout.shapes` are read-only in `python-pptx`
(`MasterShapes` has no `add_shape`). Build chrome shapes on a scratch slide and
move their XML into the master's shape tree.

## Recipe: restyle a family from the master

```python
"<python>" - <<'PY'
import copy
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation("template.pptx")
master = prs.slide_masters[0]

master.background.fill.solid()
master.background.fill.fore_color.rgb = RGBColor(0x0F, 0x17, 0x22)

# Chrome rule on every slide: build it on a scratch slide, move the XML, drop the slide.
scratch = prs.slides.add_slide(prs.slide_layouts[6])
rule = scratch.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.06))
rule.fill.solid()
rule.fill.fore_color.rgb = RGBColor(0xE0, 0x9B, 0x2D)
rule.line.fill.background()
master.shapes._spTree.append(copy.deepcopy(rule._element))

slide_id = prs.slides._sldIdLst[-1]
prs.part.drop_rel(slide_id.rId)
prs.slides._sldIdLst.remove(slide_id)

# Move the title frame for one family only.
layout = next(l for l in master.slide_layouts if "title and content" in l.name.lower())
title = next(p for p in layout.placeholders if p.placeholder_format.idx == 0)
title.left, title.top = Inches(0.9), Inches(0.55)
title.width, title.height = Inches(11.5), Inches(1.0)
for paragraph in title.text_frame.paragraphs:
    paragraph.font.size = Pt(32)
    paragraph.font.bold = True

prs.save("restyled.pptx")
print("layouts:", [l.name for l in master.slide_layouts], "slides:", len(prs.slides))
PY
```

## Recipe: delete the empty placeholders a layout leaves behind

A layout hands every slide a placeholder, filled or not. Section and title-only
layouts carry body slots that are empty by design; in edit view they print "Click
to add text" and there is no CLI verb for removing them, so do it in code:

```python
"<python>" - <<'PY'
from pptx import Presentation

prs = Presentation("deck.pptx")
removed = []
for index, slide in enumerate(prs.slides, start=1):
    for placeholder in list(slide.placeholders):
        if placeholder.has_text_frame and not placeholder.text_frame.text.strip():
            removed.append((index, placeholder.placeholder_format.idx, placeholder.name))
            placeholder._element.getparent().remove(placeholder._element)
prs.save("deck-cleaned.pptx")
print("removed:", removed)
PY
```

This clears the `empty_placeholder` review finding in
`container_tools/inspect_presentation_layout_geometry.py`. Keep a placeholder you
still intend to fill, and never delete the one slide numbers are linked to.

## Reusing the source's own layouts

With a supplied template, do not rebuild its look — put content into its
placeholders. The inspection script prints each layout's placeholders with index,
kind and rect, which is what you need to address them:

```bash
"<python>" container_tools/inspect_presentation_layout_geometry.py --input template.pptx --json-out geometry.json
```

Then address a placeholder by index on the slide:
`slide.placeholders[1].text = "..."`. Slides created from a layout always have a
placeholder for every non-empty slot, so index-based addressing is stable.

## Pitfalls this avoids

- Drawing the accent rule on every slide instead of the master: one edit later,
  half the deck has two rules.
- Dragging a placeholder on a slide to fix one frame; the layout is untouched and
  the next slide of the same family misbehaves again.
- Appending the scratch shape to the master without `drop_rel`: the orphan slide
  part stays in the package and `inspect_presentation_package_integrity.py`
  reports a slide count mismatch.
- Adding a *blank* slide and a floating textbox where the template has a title
  placeholder: the deck no longer answers to its own master, and the outline view
  is empty.

## CLI fast path

`pptx create --spec` starts from the blank default template and maps
`title|bullets|section|title_only|blank` to built-in layouts. Copying a supplied
template is `template_following_scripts/prepare_template_starter_deck.py`, which
keeps and fills the template's own slides.
