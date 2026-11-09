# Page geometry

PDF units are points, 1/72 inch: A4 is 595 × 842, Letter 612 × 792. Numbers in a spec, a region, or a stamp are points unless stated otherwise.

## Boxes

- **MediaBox** — the physical page, the outermost boundary.
- **CropBox** — the visible area, defaulting to MediaBox; viewers show the CropBox.
- **BleedBox / TrimBox / ArtBox** — print-production hints, usually absent in office output.

PyMuPDF's `page.rect` is the CropBox (MediaBox when no CropBox exists), with `x0, y0` normally 0 and `x1, y1` the width and height; pypdf exposes `.mediabox` and `.cropbox`. When moving content between documents, use the page's own box, never a constant: mixed-size sources are common after a merge.

## Coordinates

The origin is the bottom-left of the page box, x right, y up. Rectangle-taking calls (`page.get_textbox(rect)`, `add_redact_annot`, `get_pixmap(clip=...)`) and word-box calls (`page.get_text("words")`, `search_for`) all use that system — a word's box is not a baseline, so a text redaction rect may clip the line.

reportlab's `drawString(x, y, text)` places a *baseline* measured from the bottom. Convert a top-down measurement: `y = page_height - top - font_size * 0.8` puts the glyph body roughly where it was.

## Rotation

`/Rotate` is a per-page multiple of 90 applied by viewers on top of the content. `page.rect` in PyMuPDF is the rotated (visible) geometry; `page.mediabox` stays unrotated. Redactions and text boxes use the unrotated content stream, so a rotated page needs the rectangle transformed — simplest is `page.set_rotation(0)`, do the work, set the rotation back, and let the render prove it.

## Normalised regions

`office-annotations` regions are fractions of the rendered preview page:

```
x0 = page.x0 + left * page.width
x1 = page.x0 + (left + width) * page.width
y0 = page.y0 + top * page.height
y1 = page.y0 + (top + height) * page.height
```

That is the whole conversion for an unrotated page. For a rotated page, convert against the preview's own orientation and map back; the words under the converted rect show at once if the mapping is off.

## Pixels and DPI

A raster at `dpi` has `pixels = points * dpi / 72`; a 110 dpi A4 page is roughly 909 × 1287 pixels. A region drawn on a rendered image is a DPI-independent fraction, so you never need the pixel size to convert it. For print, 150 dpi is the minimum for a screenshot, 300 dpi for artwork.

## Text measurements

`page.get_text("dict")` gives blocks → lines → spans, each span with `size` (points), `font`, `origin` (baseline point), and text. When redrawing a line, use the span measurements, not the bounding box: the box includes ascenders and descenders and changes the apparent size.

`page.get_textbox(rect)` returns the characters whose boxes intersect `rect`, in reading order — the correct way to confirm what a region covers. `page.get_text("words", clip=rect)` returns word tuples when you need the boxes too.
