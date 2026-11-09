# Speaker notes

## Mechanics

Notes live in `ppt/notesMasters/` plus one `ppt/notesSlides/notesSlideN.xml` per
slide, tied to the slide by a relationship. In `python-pptx` this is
`slide.notes_slide.notes_text_frame` — the notes slide is created on first
access, so reading it in a loop silently adds one per slide. Only touch it when
writing.

Notes are invisible in the render, so a notes problem cannot be caught by looking
at the PNGs: check them with `pptx read` or by reading the XML back.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Pt

NOTES = {
    1: "Open with the ask: approve two cells, not three.",
    2: "41% comes from the Q3 time study; the two other numbers are from the driver logs.",
    4: "Say the total out loud: 553 orders over four quarters.",
    5: "Peak hour is 14:00-15:00; the bars are Q1-Q4, not hours.",
}

prs = Presentation("deck.pptx")
for index, slide in enumerate(prs.slides, start=1):
    if index not in NOTES:
        continue
    frame = slide.notes_slide.notes_text_frame
    frame.text = NOTES[index]
    for paragraph in frame.paragraphs:
        paragraph.font.size = Pt(12)
prs.save("deck-notes.pptx")
print("notes written:", len(NOTES))
PY
```

## What belongs in a note

- The sentence you will actually say, not a copy of the slide.
- The provenance of any number the audience may challenge ("Q3 time study,
  12 sites").
- The answer to the question the slide invites.
- Nothing that belongs on the slide: if the audience needs it, put it on the
  slide — notes are invisible when the deck is sent as a PDF.

## Pitfalls this avoids

- Iterating `prs.slides` and *reading* `notes_slide` on a template with none:
  every slide gains an empty notes part and the file grows.
- Long notes pasted as one paragraph with line breaks that only look like
  paragraphs; use `add_paragraph()` per intended paragraph so the notes pane and
  presenter view indent them.
- Assuming notes render into the preview: they do not, so verify them from the
  file.

## CLI fast path

`pptx create` writes slides without notes. The recipe above is the route; then
`pptx read --input deck-notes.pptx` does not print notes, so read them back from
`ppt/slides` sibling `notesSlide` parts via
`inspect_presentation_package_integrity.py` (it counts `notesSlides`).
