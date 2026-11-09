# Auto-layout rules

## Mechanics

PowerPoint has two "autofit" ideas; mixing them up wastes a round trip:

- `word_wrap` decides whether text wraps inside the width. Turn it on for every
  authored box.
- `auto_size` decides whether the *frame* follows the text (`MSO_AUTO_SIZE.
  SHAPE_TO_FIT_TEXT`) or the text shrinks to fit the frame
  (`TEXT_TO_FIT_SHAPE`). `TEXT_TO_FIT_SHAPE` is a **render-time** behaviour:
  PowerPoint recalculates it when the file opens, so a deck that looks fine in a
  draft preview can still shrink to 8 pt on a real screen.

The reliable pattern: fixed frame, explicit sizes, content measured against the
frame, no text-to-fit. Estimate, then verify by rendering.

## Recipe: fit a variable number of bullets

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import MSO_ANCHOR

BULLETS = [
    "Picking is 41% of floor labour hours",
    "Travel between aisles adds 12 minutes per order",
    "Manual cycle counts stop the line twice a week",
    "Two cells idle below 60% utilisation",
    "Overtime covers the Friday peak",
]

def fits(text: str, width_in: float, height_in: float, size_pt: float) -> bool:
    per_line = max(1, int(width_in * 96 / (0.55 * size_pt)))
    lines = max(1, -(-len(text) // per_line))
    return lines * 1.2 * size_pt / 72 <= height_in

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

width, height = 8.4, 4.6                  # the body rect you reserved
box = slide.shapes.add_textbox(Inches(0.9), Inches(1.6), Inches(width), Inches(height))
frame = box.text_frame
frame.word_wrap = True
frame.vertical_anchor = MSO_ANCHOR.TOP

size = next(pt for pt in (24, 22, 20, 18) if fits(" ".join(BULLETS), width, height, pt))
needed = sum(
    max(1, -(-len(item) // max(1, int(width * 96 / (0.55 * size))))) * 1.2 * size / 72
    for item in BULLETS
)
for index, item in enumerate(BULLETS):
    paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
    paragraph.text = item
    paragraph.font.size = Pt(size)
    paragraph.space_after = Pt(10)

prs.save("autofit.pptx")
print(f"size={size}pt lines_estimate_in={needed:.2f} frame_in={height}")
PY
```

## Rules that hold regardless of content

1. Body text is 18 pt or larger; below that the back row cannot read it.
2. Six bullets or three lines of body is where a slide should split.
3. Longer text shrinks the number of *words*, not the type size. If the fit loop
   lands below the body floor, cut copy or split the slide.
4. Keep 0.5 in of bottom margin for the footer and for projectors that crop.
5. Two columns beat one narrow column: a 4.2 in column of 18 pt text is a wall.

## Pitfalls this avoids

- `frame.text` then `paragraph.font.size` on paragraph 0 only: a multi-paragraph
  assignment leaves paragraphs 1..n at the inherited 18 pt.
- Text-to-fit hiding the overflow: the file opens fine and the audience reads
  9 pt. Measure; do not delegate the fit to the renderer.
- A frame height exactly equal to the text height: one extra word on edit and the
  block runs into the evidence below. Reserve 10% slack.

## CLI fast path

`pptx create` with `layout: "bullets"` fills the layout's body placeholder at its
own size. Use the loop above when the number of bullets is unknown before the
content is written.
