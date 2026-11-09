# Stamp a footer, header, or label

An overlay is a small one-page PDF drawn with reportlab and merged onto the target page, so the original content stream is untouched and existing widgets keep working. Positions are points from the bottom-left of the page box; an A4 page is 842 points tall.

## Fast path: the stamp script

```bash
"<python>" "<skill>/scripts/stamp_overlay.py" --input "<file.pdf>" --out "<file-stamped.pdf>" \
  --text "Confidential - page {page} of {pages}" --position bottom-center --render-dir "<render>"
```

`{page}` and `{pages}` are substituted per page. Positions: `bottom-left`, `bottom-center`, `bottom-right`, `top-left`, `top-center`, `top-right`. `--pages "1,3-5"` limits the stamp; `--font-size`, `--font`, `--color`, `--margin`, and `--opacity` control the look. The script merges page by page with pypdf, refuses to overwrite the input, and can render the stamped pages for a look.

## Draw it yourself

Use reportlab directly for a bar, a rotated line, or a block of text:

```bash
"<python>" - <<'PY'
import io
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

reader = PdfReader("in.pdf")
writer = PdfWriter()
for index, page in enumerate(reader.pages):
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(width, height))
    c.setFillColor(HexColor("#c0392b"))
    c.setFont("Helvetica-Bold", 10)
    c.saveState()
    c.translate(width / 2, 18)
    c.drawCentredString(0, 0, f"CONFIDENTIAL  |  page {index + 1} of {len(reader.pages)}")
    c.restoreState()
    c.save()
    buffer.seek(0)
    page.merge_page(PdfReader(buffer).pages[0])
    writer.add_page(page)
with open("out.pdf", "wb") as handle:
    writer.write(handle)
PY
```

Use each page's own `mediabox` when sizes may mix; a stamp drawn for A4 lands in the wrong place on a landscape page. `merge_page` paints over the page, so a solid bar hides what it covers — put it in a margin or inside a band you mean to cover.

## Pitfalls

- **Existing footers**: check the bottom margin first; the render is the proof, not the coordinate math. If a page number is already there, skip the stamp or use the opposite side.
- **Rotated pages**: a `/Rotate 90` page renders sideways, so text drawn unrotated appears rotated. Rotate the stamp (`c.rotate(90)`, adjusting the origin), or rotate the page back first.
- **Repeated stamping**: merging the same overlay twice doubles the opacity at the same position; re-run from the original input when iterating.
- **Fonts**: Helvetica handles Latin; for CJK the script registers a system CJK font (YaHei, WenQuanYi, PingFang, Noto) and reports it as `font_file`. Pass `--font-file` with a specific TTF/OTF/TTC when the host has none; without one it exits 2 instead of drawing blank boxes. Check the render.
- **Font files**: a `.ttc` collection needs its first face; the script handles that. Keep `--font` at its default when passing `--font-file` — the file overrides the base-14 name.
- **Opacity**: `setFillAlpha` works only in viewers that honour transparency groups; a stamp that must show on any viewer is safer at full opacity.

## Verify

Render every stamped page: the text sits inside the margin, does not overlap body text or an existing footer, is the size the user asked for, and appears on exactly the selected pages. Then `"<python>" "<cli>" pdf read --input "<file-stamped.pdf>"` — the stamp text joins the page text, so searching for the label confirms it landed once, not twice.
