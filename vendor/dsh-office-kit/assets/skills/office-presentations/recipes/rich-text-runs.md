# Rich text runs

## Mechanics

Text lives at three levels: `text_frame` → `paragraph` → `run`. A run is a span
with one formatting state. Assigning `paragraph.text` (or `text_frame.text`)
replaces every run, so **format runs, never paragraphs**:

- `paragraph.text = "x"` — one run, all previous formatting gone.
- `run = paragraph.add_run(); run.text = "x"; run.font.bold = True` — formatting
  survives and can differ inside the paragraph.
- `paragraph.font.size` is not something PowerPoint respects for mixed content; it
  sets the default for later runs only. Set the size on every run you add.

Paragraph-level properties (`alignment`, `level`, `space_after`, `line_spacing`)
apply to the whole paragraph and are safe to set once.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

box = slide.shapes.add_textbox(Inches(0.9), Inches(2.0), Inches(11.0), Inches(1.6))
frame = box.text_frame
frame.word_wrap = True

MUTED = RGBColor(0x5F, 0x6B, 0x7A)
ACCENT = RGBColor(0xD9, 0x8B, 0x1E)

lead = frame.paragraphs[0]
lead.alignment = PP_ALIGN.LEFT
for text, bold, size, colour in (
    ("Orders fulfilled ", False, Pt(28), RGBColor(0x16, 0x1D, 0x28)),
    ("rose 71%", True, Pt(28), ACCENT),
    (" across FY2026.", False, Pt(28), RGBColor(0x16, 0x1D, 0x28)),
):
    run = lead.add_run()
    run.text = text
    run.font.bold = bold
    run.font.size = size
    run.font.color.rgb = colour

footnote = frame.add_paragraph()
footnote.space_before = Pt(10)
note = footnote.add_run()
note.text = "Q4 is forecast; the other three quarters are actuals."
note.font.size = Pt(12)
note.font.italic = True
note.font.color.rgb = MUTED
prs.save("runs.pptx")
print("runs in paragraph 0:", len(lead.runs))
PY
```

## Rules

1. A number the reader should remember gets its own run, usually with a weight
   change — not a second bullet.
2. Superscripts, footnote markers and unit symbols are runs, not characters
   smuggled into the sentence.
3. One family of emphasis per deck: bold+accent for numbers, italic+muted for
   provenance. Three competing emphases read as decoration.
4. Repeated strings (units, currency, product names) belong in a variable so a
   later edit does not leave two spellings.

## Pitfalls this avoids

- `paragraph.text = "Total: "` then `add_run()`: the first assignment already
  replaced the frame's runs, so earlier formatting is gone.
- A run with no `font.size` inherits the layout's size, which is 44 pt on a title
  layout — footnote markers become headlines.
- Building the paragraph by f-string with `**` markers PowerPoint does not
  interpret; markup in a deck is a run, not a syntax.

## CLI fast path

`pptx create` writes plain paragraphs; bullets and titles are single-run. Mixed
formatting inside one line is the recipe's job.
