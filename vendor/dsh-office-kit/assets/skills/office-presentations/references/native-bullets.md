# Bullets that read as sentences

## The shape of a bullet

A bullet is a claim, not a label. Two forms work:

- **Claim + consequence**: "Picking is 41% of floor labour hours — travel is the
  cost, not the pick."
- **Number + meaning**: "12 minutes per order lost to aisle travel."

Forms that fail: a single noun ("Efficiency"), a truncated clause ("Picking
accounts for…"), three adjectives in a row, or a bullet that restates the slide
title.

## Length and count

- One line, two at the absolute maximum, per bullet on a 16:9 slide.
- Three to five bullets. Six is a signal to split; eight is a document.
- No sub-sub-bullets. A bullet needing a child means the parent was a section.
- Keep bullets grammatically parallel: all sentences, or all noun phrases.

## Native bullet glyphs

Bullets are paragraph properties, not characters. A typed bullet ("• Picking…")
cannot re-indent, cannot change level, and looks unlike every other bullet.

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])
box = slide.shapes.add_textbox(Inches(0.9), Inches(1.8), Inches(11.0), Inches(3.6))
frame = box.text_frame
frame.word_wrap = True

for index, text in enumerate((
    "Picking is 41% of floor labour hours",
    "Aisle travel costs 12 minutes per order",
    "Manual cycle counts stop the line twice a week",
)):
    paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
    paragraph.text = text
    paragraph.font.size = Pt(20)
    paragraph.space_after = Pt(12)
    paragraph.level = 0
    paragraph.alignment = PP_ALIGN.LEFT
    # PowerPoint's own bullet: a literal glyph in the paragraph's pPr
    paragraph._pPr.set("marL", str(Inches(0.3)))
    paragraph._pPr.set("indent", str(-Inches(0.3)))
    bu = paragraph._pPr.makeelement(
        "{http://schemas.openxmlformats.org/drawingml/2006/main}buChar", {"char": "•"}
    )
    paragraph._pPr.append(bu)

prs.save("bullets.pptx")
print("bullets:", len(frame.paragraphs))
PY
```

The `marL`/`indent` pair pulls a wrapped bullet's second line under the text
instead of under the glyph — the most common "malformed bullet" defect in
generated decks.

## Anti-patterns

- Bullets as a script: a slide is not a transcript; the speaker notes are.
- Fake bullets via "– " or "→ " prefixes; they do not indent.
- Six bullets of equal weight where one is the point. Make the point the title,
  the bullets the evidence.
- Numbered lists where order does not matter, bullets where it does.
