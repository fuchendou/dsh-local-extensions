# Authoring workflow

## What a deck is

A `.pptx` is a zip of XML parts: `presentation.xml` (slide order), one part per
slide, a slide master per theme, a layout per family, chart parts with embedded
workbooks, notes parts, a media folder. Read the file back; never trust the code
that wrote it.

Three consequences:

1. **Geometry is explicit.** Nothing reflows on open except autofit; shapes that
   overlap in XML overlap on screen.
2. **Inheritance is real.** A slide draws background, type sizes and bullet
   glyphs from its layout and master. Overriding at slide level is a per-slide
   decision; at master level a deck decision.
3. **Data stays alive.** A native chart or table keeps its numbers and can be
   checked; a screenshot cannot.

## The loop

1. **Decide the story.** One sentence per slide, in order, before any XML.
2. **Pick the frame.** Slide size from the target: `13.333 × 7.5 in` is the 16:9
   default; check `prs.slide_width` of a supplied template, never assume.
3. **Place, top-down.** Background, chrome, title, body, evidence; later shapes
   paint over earlier ones.
4. **Fill or delete every placeholder.** An empty one shows in edit view and
   prints "Click to add text".
5. **Render, look, fix.** `container_tools/render_slides.py`, then `read_image`
   on every PNG; repeat until nothing surprises you.

## Layout numbers

Type, colour and density: [style-guidelines](style-guidelines.md).

| Value | Rule |
|---|---|
| Slide size | 13.333 × 7.5 in (16:9); 10 × 5.625 in for "wide" templates |
| Margin | 0.6–0.9 in; below 0.5 in a projector crops it |
| Line spacing | 1.1–1.2; tighter crowds ascenders |
| Gap between blocks | 0.2–0.4 in; the eye groups by proximity |
| Footer zone | bottom 0.55 in; keep text out |

One unit only: `Inches(x)` in code, `x * 914400` for raw XML. Never mix EMU and
inches.

## Deciding slide count

One idea per slide; two competing headlines is two slides. One headline plus a
table too large for 14 pt makes the table an appendix, and the body slide states
the conclusion in one line. N minutes ≈ N/2 content slides at 60–90 seconds each,
plus a cover and a closing ask.

## Where the detail lives

- Type, colour, density, cover art: [style-guidelines](style-guidelines.md).
- Bullets that read as sentences: [native-bullets](native-bullets.md).
- Charts, tables and notes: [native-evidence](native-evidence.md).
- Supplied templates: [templates](templates.md).
- Pre-delivery checklist: [finalization](finalization.md).
