# Annotation recipes

The user may reply to a rendered preview with an `office-annotations` payload: a
JSON array wrapped in `<office-annotations>` … `</office-annotations>` tags.
Each format sends a slightly different item; these are the shapes the client
emits.

| Format | Item keys | `page` means |
| --- | --- | --- |
| pdf | `target`, `fileName`, `page`, `text`, `requirement`, `region`, `imageName` | 1-based page of the PDF itself |
| docx | `target`, `fileName`, `page`, `text`, `requirement`, `region` | page of the rendered PDF preview, not a Word page |
| pptx | `target`, `fileName`, `page`, `text`, `requirement`, `region` | rendered PDF page; one slide per page, so page N is slide N |
| xlsx | `target`, `fileName`, `text: ""`, `requirement`, `region`, `imageName`, `unmapped: true` | no `page`, no `sheet`, no `range` |

- `target` and `fileName` name the file.
- `region` is normalised 0–1 against the rendered preview page the user drew on.
- `requirement` is natural language. Read it as a change request.
- `text` is the words under the mark. For docx and pdf it is stronger evidence
  than `region`; for xlsx it is always empty.
- `imageName` marks a location screenshot that arrived as a normal image
  attachment.

Rules that apply everywhere:

1. Render the *current* file first and look at the same page the user annotated.
   Geometry is only meaningful against a render you can reproduce.
2. Locate the concrete object, then apply the smallest edit that satisfies
   `requirement`. Do not restyle the document or rewrite neighbours.
3. Re-render and look at the edited page. The item is done when the region shows
   the requested change and the layout still holds.
4. If the payload cannot be tied to an object (empty region, no geometry, no
   matching text), say what you could not locate. Never guess and never move the
   region to make it fit.

Worked examples use `report.docx`, `report.pdf`, `deck.pptx`, and `book.xlsx`,
plus the `python`/`cli`/`skill` values from the `## Office runtime` block.

## Turn a region into page text

Save this as `region_text.py`; it prints the page rect and the words under the
region. Run it with the runtime python.

```python
import sys, pymupdf
pdf, page_no, l, t, w, h = sys.argv[1], int(sys.argv[2]), *map(float, sys.argv[3:7])
page = pymupdf.open(pdf)[page_no - 1]
r = page.rect
rect = pymupdf.Rect(r.x0 + l * r.width, r.y0 + t * r.height,
                    r.x0 + (l + w) * r.width, r.y0 + (t + h) * r.height)
print(rect, " ".join(word[4] for word in page.get_text("words", clip=rect)))
```

## docx — rendered-PDF page plus text matching

`page` is the page of the **rendered PDF preview**, not a Word page number.

```bash
"<python>" "<cli>" docx render --input "report.docx" --out-dir "render" --pdf
```

Writes `render/page-1.png` and `render/report.pdf`.

Locate it from the text, not the pixels:

- `docx read --input "report.docx"` lists paragraphs with styles. Find the one
  containing `text`.
- Use `region` only to break ties or confirm the preview page; if they disagree,
  trust `text` and say so.
- `region_text.py` on `render/report.pdf` confirms the words under the region.

Apply the edit and write `<original>-edited.docx` with the pack's replacement
tool:

```json
{
  "replace": [{
    "find": "Revenue grew 18.4% year over year.",
    "replace": "Revenue grew 19% year over year."
  }]
}
```

```bash
"<python>" "<skill>/scripts/replace_text.py" --input "report.docx" --spec "edit.json" --out "report-edited.docx" --require-all
```

The report returns `replacements` (total), per-pair counts in `pairs`, and
`misses`; `--require-all` exits 1 when any `find` did not match. Zero means the
text split across runs or differs verbatim — re-read the paragraph instead of
guessing. Re-render `report-edited.docx` and `read_image` page 1. A longer
sentence can reflow the page: check the paragraphs below the edit too.

## pdf — convert the region and work on the converted rect

`page` is a 1-based page of the PDF itself. `region × page.rect` is the real
place in the file, so convert once and use the device rect directly. Run
`region_text.py` on `report.pdf`.

Example: page 1, region over the title, `text` "Field report", requirement
"make the title say Field report (revised), keep the author". If `imageName` is
present, `read_image` it when the text layer is ambiguous or the page is
scanned.

Choose the edit the pack scripts support:

- Metadata → `metadata.py`. Repeat `--set`; unset fields keep their old values.

  ```bash
  "<python>" "<skill>/scripts/metadata.py" --input "report.pdf" --set "title=Field report (revised)" --out "report-edited.pdf"
  ```

- Rotation, page order, merge, page removal → `page_ops.py`. Indices are
  zero-based.

  ```bash
  "<python>" "<skill>/scripts/page_ops.py" --input "report.pdf" --out "report-edited.pdf" --merge "cover.pdf" --order "2,0,1"
  ```

- Text or graphics **on** the page → no in-place edit. Rebuild from a
  `pdf create` spec using `pdf read` text, and say the PDF was rebuilt, not
  patched. Never call a rebuild a surgical edit.

Verify with `pdf render --input "report-edited.pdf" --out-dir "render"` and
`read_image render/page-1.png`. `pdf render` uses PyMuPDF and works without the
LibreOffice kit, so a PDF annotation is never blocked by a missing renderer.

## pptx — select the shapes that overlap the region

`page` is the rendered PDF page; one slide per page, so page N is slide N.
`pptx read` returns slide text but **no shape geometry**, so compute overlap
yourself with python-pptx. Shape boxes and the payload region are both
fractions of the slide, so the comparison is direct.

```python
import sys
from pptx import Presentation
prs = Presentation(sys.argv[1])
slide_no, l, t, w, h = int(sys.argv[2]), *map(float, sys.argv[3:7])
sw, sh = prs.slide_width, prs.slide_height
for shape in prs.slides[slide_no - 1].shapes:
    x0, y0 = (shape.left or 0) / sw, (shape.top or 0) / sh
    x1, y1 = x0 + (shape.width or 0) / sw, y0 + (shape.height or 0) / sh
    if x1 > l and x0 < l + w and y1 > t and y0 < t + h and shape.has_text_frame:
        print(shape.shape_id, shape.text_frame.text.replace("\n", " | "))
```

Example: slide 2, region over the second bullet, `text` "Renewal 92%". Two
shapes overlap; `text` picks the body.

Apply with the pack's run-level replacement; `slide` scopes a rule:

```json
{ "replacements": [{ "find": "Renewal 92%", "replace": "Renewal 94%", "slide": 2 }] }
```

```bash
"<python>" "<skill>/container_tools/replace_text.py" --input "deck.pptx" --spec "edit.json" --out "deck-edited.pptx"
```

Without `slide`, a rule hits every slide: check `total` and `slides`, then scope
any unintended match. `unmatched` lists patterns that found nothing. Re-render
and `read_image` the page PNG for slide 2. If type overflows its shape, shrink
the run or shorten the text rather than leaving it clipped.

## xlsx — no cell reference, so resolve it yourself and say so

xlsx items are always `unmapped: true` with `text: ""`: you get a region, a
screenshot in `imageName`, and a requirement — no page, no sheet, no A1 range.
Resolve the sheet and cells from evidence, never invent them.

1. **Look at the screenshot.** `read_image` the `imageName` attachment; note
   headers, row labels, and values in the region. With no screenshot you have
   only `region` and `requirement` — say so.
2. **Dump the workbook.** `xlsx read --input "book.xlsx" --json-out "book.json"`.
   Sheets give `name`, `dimensions`, `rows` (no coordinates), and `formulas`.
3. **Resolve the cells.** Match the visible values and headers against the rows,
   then derive A1 from the row/column index:

   ```python
   import json, sys
   from openpyxl.utils import get_column_letter
   data = json.load(open(sys.argv[1], encoding="utf-8"))
   needle = sys.argv[2]
   for sheet in data["sheets"]:
       for r, row in enumerate(sheet["rows"], start=1):
           for c, value in enumerate(row, start=1):
               if isinstance(value, str) and needle in value:
                   print(sheet["name"], f"{get_column_letter(c)}{r}", value)
   ```

   If several sheets share the label, or the screenshot does not pin the
   column, ask which one before editing.
4. **State the resolution before editing.** Say the sheet and A1 range, e.g.
   "Revenue is `Q4!B2:C2` (10, 12); formatting those cells as currency." A wrong
   guess is then visible before it touches the file.
5. **Apply and verify.** Screenshot shows `Revenue 10 12`; requirement is
   "currency with 2 decimals"; `xlsx read` finds `Revenue` in `Q4!A2` with `10`
   and `12` beside it:

   ```bash
   "<python>" "<skill>/container_tools/style_cells.py" --input "book.xlsx" --out "book-edited.xlsx" \
     --sheet "Q4" --range "B2:C2" --style '{"number_format":"#,##0.00"}'
   ```

   One `--range` styles the whole range. `set_cells.py` sets values/formulas,
   `append_rows.py` adds rows, `sheet_ops.py` edits sheet structure. Read the
   workbook back to confirm values.

Forbidden — both put a plausible edit in the wrong place:

- converting `region` pixels to a cell address (the preview zooms and scrolls);
- naming a sheet the screenshot does not show or `xlsx read` cannot match.

Visual confirmation needs `xlsx render`, which requires the DSH LibreOffice kit;
without it, say the change is verified structurally but not visually. Formula
results stay uncalculated until `xlsx recalc` runs (the kit recalculates on any
platform); do not present openpyxl's empty cache as a computed value.

## When to stop and ask

Ask one short question, listing what you did find, when:

- the region covers text on several pages and `text` is empty;
- two shapes on a slide both match `text`;
- the xlsx screenshot does not identify the sheet, or the visible values match
  more than one row or column;
- the requirement needs an operation the pack scripts do not support
  (page-content editing in PDF, animation, comments) — offer the rebuild path
  instead of a silent partial change.
