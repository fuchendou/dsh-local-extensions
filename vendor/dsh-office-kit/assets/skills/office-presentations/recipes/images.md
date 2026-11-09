# Images

## Mechanics

`add_picture(path, left, top, width=…, height=…)`:

- Give **width only** and the height follows the aspect ratio. Give both and the
  picture stretches — deliberate for a full-bleed background, a mistake for a
  product photo.
- `picture.crop_left/right/top/bottom` are fractions of the *source*; they crop
  without changing the frame, which is how a "cover" fit is done.
- The bytes live in `ppt/media/`; the same file added twice is stored once, keyed
  by content hash.
- `picture._element.nvPicPr.cNvPr.set("descr", "…")` is the alt text. Decks get
  read aloud and exported; an untagged picture is an empty sentence.

## Recipe: cover-fit into a fixed frame

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches
from PIL import Image

def cover(picture, frame_w_in, frame_h_in, source_w, source_h):
    """Crop the picture so it fills the frame without distortion."""
    frame_ratio = frame_w_in / frame_h_in
    source_ratio = source_w / source_h
    if source_ratio > frame_ratio:          # too wide: crop the sides
        keep = frame_ratio / source_ratio
        picture.crop_left = picture.crop_right = (1 - keep) / 2
    elif source_ratio < frame_ratio:        # too tall: crop top and bottom
        keep = source_ratio / frame_ratio
        picture.crop_top = picture.crop_bottom = (1 - keep) / 2

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

with Image.open("aisle.png") as image:
    source_w, source_h = image.size

frame = slide.shapes.add_picture("aisle.png", Inches(0.9), Inches(1.7), Inches(8.0), Inches(4.5))
cover(frame, 8.0, 4.5, source_w, source_h)
frame._element.nvPicPr.cNvPr.set("descr", "Racking aisle in the pilot cell at peak hour")

# full-bleed background, sent to the back
background = slide.shapes.add_picture("aisle.png", 0, 0, prs.slide_width, prs.slide_height)
tree = slide.shapes._spTree
tree.remove(background._element)
tree.insert(2, background._element)
prs.save("image.pptx")
print("placed", source_w, "x", source_h)
PY
```

## Rules

1. Never upscale past the source resolution: a 900 px wide image at 8 in is
   ~110 ppi and looks soft on a projector. Check `Image.open(...).size`.
2. One dominant image per slide. A hero plus three thumbnails is two slides.
3. Full-bleed backgrounds need deliberate text contrast — a dark scrim rectangle
   between picture and text, not hope.
4. Alt text on every picture, in the language of the deck.

## Pitfalls this avoids

- Passing both width and height and getting a squashed photograph nobody can
  name as the cause.
- `add_picture` after the text: the picture covers the words. Add backgrounds
  first, or move them to index 2.
- Re-using a screenshot of a chart or table as "evidence": unreadable at
  projector size, unverifiable. Use a native chart or table.

## CLI fast path

`pptx create` accepts `{"image": {"path": "...", "left": 0.9, "top": 1.6,
"width": 8.0}}` and derives the height from the aspect ratio — no crop, no alt
text. Cropping, alt text and background placement are the recipe's job.
