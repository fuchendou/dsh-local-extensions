# Redact a region of a page

Redaction deletes glyphs and vector paths inside the rectangle from the content stream, so no extractor recovers them. A black box that covers text is not a redaction: "black out then flatten" leaks the original.

## Fast path: the region script

```bash
"<python>" "<skill>/scripts/redact_region.py" --input "<file.pdf>" --out "<file-redacted.pdf>" \\
  --annotations '{"page":1,"region":{"left":0.064,"top":0.318,"width":0.891,"height":0.153}}' \\
  --json-out "<redact.json>"
```

The payload is a 1-based `page` plus a region normalised 0–1 against the rendered page. The script converts it, expands the rectangle by `--pad` points (default 2.5), calls `add_redact_annot(rect, fill=None)` then `apply_redactions(images=PDF_REDACT_IMAGE_NONE, graphics=PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED, text=PDF_REDACT_TEXT_REMOVE)`, and reports `removed_chars`, `removed_drawings`, per-page before/after counts, and `leftover_chars_in_rect`. `--region`/`--page` take single values without JSON; multiple annotations apply page by page.

## Padding

Glyphs overhang the geometric text box and preview boxes are approximate. Expand by 2–3 points to catch ascenders, descenders, rules touching the text, and the anti-aliased edge without touching neighbours. Measure: `get_textbox(rect)` lists what the rectangle takes; `leftover_chars_in_rect` must be zero afterwards.

By hand, for another shape or a dry run:

```bash
"<python>" - <<'PY'
import pymupdf
doc = pymupdf.open("in.pdf")
page = doc[0]
r = page.rect
rect = pymupdf.Rect(r.x0 + 0.064 * r.width, r.y0 + 0.318 * r.height,
                    r.x0 + 0.955 * r.width, r.y0 + 0.471 * r.height)
rect = (rect + (-2.5, -2.5, 2.5, 2.5)) & page.rect
print("will remove:", repr(page.get_textbox(rect)[:200]))
before = len(page.get_text()), len(page.get_drawings())
page.add_redact_annot(rect, fill=None)
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                      graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
after = len(page.get_text()), len(page.get_drawings())
print("chars/drawings", before, "->", after)
doc.save("out.pdf", garbage=3, deflate=True)
PY
```

## The flags are not interchangeable

- `fill=None` erases without painting. `fill=(1, 1, 1)` paints a rectangle that becomes a new drawing and hides the page's background tint; the drawing count goes up, not down.
- `images=PDF_REDACT_IMAGE_NONE` leaves pictures untouched, so a scanned region stays visible. `PDF_REDACT_IMAGE_PIXELS` blanks the pixels a rectangle covers inside an image; use a stronger setting only when the whole image should go.
- `graphics=PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED` deletes intersecting paths; paths entirely inside are always removed. `PDF_REDACT_LINE_ART_NONE` keeps all line art, for text-only removal.
- Text removal is the default (`PDF_REDACT_TEXT_REMOVE`); keeping text while erasing its surroundings is almost never what the user means.

## Counting the result

`removed_chars` is the page-level difference in extracted text; `region_chars_removed` is what was inside the rectangle. They differ by the newline or space joining the block to its neighbours: expect equal or one apart. Fewer characters removed than the region held means the rectangle missed part of the block — enlarge `--pad` or redo the geometry.

Sample: page 1 region `{left: 0.064, top: 0.318, width: 0.891, height: 0.153}` deletes the "Latest News" block alone — 16 drawings → 5, page text 1049 → 879 (block 169), `leftover_chars_in_rect` 0, and the body paragraph, header, and footer still extract and render.

## Leftovers redaction does not cover

- **Metadata and embedded files**: the info dictionary and attachments are not page content; clear them for a clean file (`scripts/metadata.py`). An ID/xref may still fingerprint the file.
- **Previous revisions**: incrementally saved files keep old objects; save with `garbage=3, deflate=True`. For forensic certainty, say the output was rebuilt and confirm by text search that the words are gone.
- **Images inside the region**: they stay by default. For a screenshot of the sensitive text, use `--images pixels` or rebuild the page.

## Verify

Render the page: the region empty, the surrounding text intact, and ruled boxes of the block gone rather than half-erased. Then search the output for the removed words:

```bash
"<python>" - <<'PY'
import pymupdf
text = pymupdf.open("out.pdf")[0].get_text()
print("latest news" in text.lower(), len(text))
PY
```

If they still appear, the rectangle missed them — fix the geometry, do not hand the file over.
