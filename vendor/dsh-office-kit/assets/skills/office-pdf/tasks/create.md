# Create a PDF

## Fast path: the helper CLI spec

```bash
"<python>" "<cli>" pdf create --spec "<spec.json>" --out "<output.pdf>"
```

```json
{
  "title": "Field report",
  "author": "Ada Lovelace",
  "page_size": "A4",
  "blocks": [
    { "type": "title", "text": "Field report" },
    { "type": "paragraph", "text": "One sentence of body copy." },
    { "type": "bullets", "items": ["First", "Second"] },
    { "type": "table", "headers": ["Item", "Value"], "rows": [["Pump", "3"]] },
    { "type": "page_break" }
  ]
}
```

Blocks: `title`, `heading` (`level` 1–2), `paragraph`, `quote`, `bullets`, `numbered`, `table` (`headers`, `rows`), `image` (`path`, `width` inches, height derived at 0.66 aspect), `page_break`, `spacer` (`height` inches). Use `pages: [{ "blocks": [...], "break": true }]` when the page grouping matters. `page_size` accepts `A4` or `Letter`.

## Direct path: reportlab

Reach for reportlab when the layout does not fit the block model: columns, absolute placement, custom rules, rotated text.

```bash
"<python>" - <<'PY'
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

c = canvas.Canvas("out.pdf", pagesize=A4)
width, height = A4
c.setTitle("Field report")
c.setFont("Helvetica-Bold", 18)
c.drawString(22 * mm, height - 30 * mm, "Field report")
c.setFont("Helvetica", 11)
text = c.beginText(22 * mm, height - 45 * mm)
for line in ["One sentence of body copy.", "A second line."]:
    text.textLine(line)
c.drawText(text)
c.showPage()
c.save()
PY
```

`drawString` takes a baseline point measured from the bottom-left corner, not the top. Convert top-down coordinates once (for a page height `h`, baseline `y = h - top - font_size`), or every later measurement drifts.

## Fonts

Base-14 fonts (`Helvetica`, `Times-Roman`, `Courier`) need no embedding and cover Latin text. Non-Latin text needs a real font file registered with `pdfmetrics.registerFont(TTFont("Body", "<path>.ttf"))`; a font that cannot render a glyph produces a blank box, which the render step shows. The CLI tries the first available CJK system font and says so when none exists.

## Quality rules

- Keep body text inside 12–16 pt leading; below 9 pt text becomes unreliable on print.
- ASCII hyphens only in prose; do not paste typographic dashes into generated copy unless the source used them.
- Give every page a consistent header/footer treatment, or none at all.
- Full layout checklist: `references/layout-quality.md`.

## Verify

Render every page: a created PDF has no text-layer surprises, so problems are layout problems — text past the margin, blocks overlapping, table columns squeezed, a `page_break` landing on an empty page, a CJK line silently blank.

```bash
"<python>" "<cli>" pdf render --input "out.pdf" --out-dir "render" --dpi 110
```

Then confirm the page count and per-page text with `"<python>" "<cli>" pdf read --input "out.pdf"` before `present`.
