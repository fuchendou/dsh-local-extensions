# Theme tokens

## Mechanics

The theme part (`ppt/theme/theme1.xml`) holds two palettes and two font lists:

- `dk1/lt1/dk2/lt2/accent1..6/hlink/folHlink` — every `RGBColor` you *do not*
  set falls back to one of these, and PowerPoint's "theme colors" picker edits
  them for the whole deck.
- `majorFont` / `minorFont` — the heading and body typefaces inherited by every
  run without an explicit font.

Write `RGBColor.rgb` when a colour must never change; reference a theme colour
when the user may re-skin the deck. A deck with hard-coded hex everywhere cannot
be re-branded — usually why the user supplied a template.

## Recipe: define the palette once, use it everywhere

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt
from pptx.enum.dml import MSO_THEME_COLOR

PALETTE = {
    "ink": RGBColor(0x16, 0x1D, 0x28),
    "muted": RGBColor(0x5F, 0x6B, 0x7A),
    "accent": RGBColor(0xD9, 0x8B, 0x1E),
    "rule": RGBColor(0xD6, 0xDC, 0xE4),
}
TYPE = {"title": Pt(34), "body": Pt(18), "caption": Pt(12)}

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

def put(text, left, top, width, size, colour, bold=False):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(0.6))
    frame = box.text_frame
    frame.word_wrap = True
    frame.margin_left = frame.margin_right = 0
    run = frame.paragraphs[0].add_run()
    run.text = text
    run.font.size = size
    run.font.bold = bold
    run.font.color.rgb = PALETTE[colour]
    return box

put("Automation Review", 0.9, 2.4, 11.5, TYPE["title"], "ink", bold=True)
put("Warehouse network · FY2026", 0.9, 3.3, 11.5, TYPE["body"], "muted")
put("Source: FY2026 capital plan", 0.9, 6.7, 6.0, TYPE["caption"], "muted")
prs.save("themed.pptx")
print("palette keys:", sorted(PALETTE), "theme colour sample:", MSO_THEME_COLOR.ACCENT_1)
PY
```

## Reading the theme you were given

```python
from pptx import Presentation
prs = Presentation("template.pptx")
theme = prs.slide_masters[0].part.part_related_by(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
)
blob = theme.blob.decode("utf-8", "ignore")
print("accent1" in blob, "majorFont" in blob)
```

`template_following_scripts/inspect_template_deck.py` already reports the font
names it finds in the theme, so check there before introducing a new typeface.

## Pitfalls this avoids

- Two similar hexes drifting apart across slides (`#161d28` here, `#171e29`
  there) because the colour was retyped instead of referenced.
- A serif body font set from taste rather than from the theme, so the deck
  contradicts the template it was built in.
- `font.color.theme_color = MSO_THEME_COLOR.ACCENT_1` *and* `font.color.rgb` on
  the same run: the last assignment wins and the theme reference vanishes.

## CLI fast path

`pptx create` uses the default template's theme. For a branded deck, start from
the supplied template (see [master-and-layouts](master-and-layouts.md)) rather
than recolouring a blank deck.
