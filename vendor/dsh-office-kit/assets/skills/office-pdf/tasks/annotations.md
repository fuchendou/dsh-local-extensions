# Resolve an `office-annotations` region on a PDF

`page` is the 1-based page of the file, and `region × page.rect` is the real rectangle in the page's coordinate system. Convert once; then every operation — read, redact, stamp, fill — uses that rect.

## 1. Reproduce the page first

```bash
"<python>" "<cli>" pdf render --input "<file.pdf>" --out-dir "<render>" --dpi 110
```

Open `"<render>/page-<N>.png"` with `read_image`. Geometry is only meaningful against the page the user saw, so never resolve a region on a page you have not rendered.

## 2. Convert the region and read what it covers

```bash
"<python>" - <<'PY'
import pymupdf
doc = pymupdf.open("in.pdf")
page = doc[0]                       # page 1
r = page.rect
region = (0.064, 0.318, 0.891, 0.153)   # left, top, width, height
left, top, width, height = region
rect = pymupdf.Rect(r.x0 + left * r.width, r.y0 + top * r.height,
                    r.x0 + (left + width) * r.width, r.y0 + (top + height) * r.height)
print("rect", rect)
print("words:", " ".join(w[4] for w in page.get_text("words", clip=rect)))
print("textbox:", repr(page.get_textbox(rect)[:300]))
print("images:", page.get_image_info(clip=rect))
PY
```

Compare the words with the annotation's `text`. If `text` is present and those words are not in the region, trust `text` and say the region was off — do not shift the rectangle to make it land. If `imageName` came with the payload, open that screenshot with `read_image` to see exactly what was marked.

## 3. Pick the smallest operation that satisfies `requirement`

| What the region covers | Operation |
| --- | --- |
| A metadata line, title, author | `scripts/metadata.py --set ...` |
| A whole block to delete | `scripts/redact_region.py` |
| A widget or a form label | `scripts/forms.py fill` / `inspect` |
| A footer, header, or label to add | `scripts/stamp_overlay.py` |
| Page order, rotation, deletion | `scripts/page_ops.py` or `scripts/split_pages.py` |
| A single word or sentence to change | redact the old line, then stamp the new text (below) |
| A picture to replace | overlay a cover rect and draw the new image with reportlab |

A requirement like "make this sentence shorter" is a content edit; do not rebuild the whole page when the block is one line.

## 4. Patch one line in place

Delete the old glyphs first, then draw the replacement at the same baseline. Covering without deleting leaves the original text extractable.

```bash
"<python>" - <<'PY'
import io
import pymupdf
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

old = "Revenue grew 18.4% year over year."
new = "Revenue grew 19% year over year."
doc = pymupdf.open("in.pdf")
page = doc[3]                                  # page 4
hits = page.search_for(old)
assert hits, "text not found; re-read the page"
rect = hits[0] + (-1, -1, 1, 1)                # a little air around the line
page.add_redact_annot(rect, fill=None)
page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                      graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
doc.save("cleaned.pdf", garbage=3, deflate=True)

reader = PdfReader("cleaned.pdf")
writer = PdfWriter()
with pymupdf.open("in.pdf") as source:
    font_size = 11
for index, page in enumerate(reader.pages):
    if index == 3:
        buffer = io.BytesIO()
        c = canvas.Canvas(buffer, pagesize=(float(page.mediabox.width), float(page.mediabox.height)))
        c.setFont("Helvetica", font_size)
        c.drawString(float(rect.x0), float(page.mediabox.height) - float(rect.y0) - font_size, new)
        c.save()
        buffer.seek(0)
        page.merge_page(PdfReader(buffer).pages[0])
    writer.add_page(page)
with open("out.pdf", "wb") as handle:
    writer.write(handle)
PY
```

Line height and font size must match the original text; read them from the original spans (`page.get_text("dict")` → blocks → lines → spans → `size`, `font`, `origin`). A different font or size is visible in the render and reads as a patch job.

## 5. When the payload cannot be tied to an object

Say which part you could not locate — render page, the words found under the region, the missing item — and ask for the target text or a clearer region. Blocked cases are in `references/limits.md`: name the missing capability and the way out, never a bare "unsupported".

## 6. Re-render and confirm

Apply the edit, render the same page, and `read_image` it again: the region must show the requested result, neighbouring text must be untouched, and the layout must hold. Then confirm with `pdf read` that the change is in the text layer, not only in pixels. Report in the user's own terms: page number plus a one-line description of the change.
