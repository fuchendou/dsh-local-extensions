# Textbox at a coordinate

## Mechanics

A free textbox is placed by its rect, not by a layout slot. Four facts control
what you see:

- `left`/`top` are the **top-left corner** of the frame, not of the glyphs. A
  28 pt line has roughly 4 pt of space above the cap height inside its frame.
- `width` is the wrap width. Set `word_wrap = True` explicitly on a new box or
  long lines run past the slide edge instead of wrapping.
- `height` is the *frame*, not the content: PowerPoint lets text spill below it
  (overlapping whatever is under the box) unless autosize is on.
- Interior margins default to 0.1 in left/right and 0.05 in top/bottom. Setting
  them to 0 makes the rect mean exactly what you measured.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import MSO_ANCHOR

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank

box = slide.shapes.add_textbox(Inches(0.9), Inches(1.35), Inches(6.2), Inches(1.1))
frame = box.text_frame
frame.word_wrap = True
frame.vertical_anchor = MSO_ANCHOR.TOP
frame.margin_left = frame.margin_right = 0
frame.margin_top = frame.margin_bottom = 0

paragraph = frame.paragraphs[0]
paragraph.text = "Picking is 41% of floor labour hours"
paragraph.font.size = Pt(28)
paragraph.font.bold = True
prs.save("textbox.pptx")
print("saved")
PY
```

## Measuring before you place

Do not guess whether the text fits — compute it. A line of 28 pt text fits about
`width_in * 96 / (0.55 * 28)` characters (0.55 average advance for a humanist
sans), and each line needs `1.2 * 28 / 72` inches of height. Leave the estimate
in the script, then let the render confirm it.

```python
def fits(text: str, width_in: float, height_in: float, size_pt: float) -> bool:
    per_line = max(1, int(width_in * 96 / (0.55 * size_pt)))
    lines = -(-len(text) // per_line)
    return lines * 1.2 * size_pt / 72 <= height_in
```

## Pitfalls this avoids

- A box sized to text at 18 pt, later edited to 32 pt, now overlaps the table
  below. Frame height follows the *largest* run, so size text first.
- `add_textbox` with `width=Inches(13.3)` on a 13.333 in slide plus default
  margins = 0.2 in of overflow past the right edge. Subtract the margins.
- `MSO_ANCHOR.MIDDLE` on a title looks intentional on a cover and wrong on a
  content slide; anchor per role, not globally.

## CLI fast path

`pptx create` places titles and bullet bodies on the layout's own frames. For
anything at a coordinate, the snippet above is the route.
