# Tables

## Mechanics

A table in a deck is a grid of cells on a canvas; it does not reflow. Three
properties decide whether it reads as a table or as soup:

- **Column widths** are the layout. `table.columns[i].width = Inches(3.2)` —
  mandatory, because `add_table` splits the width evenly.
- **Row heights** are a minimum. Text taller than the row pushes it open, which
  runs into whatever sits below.
- **Cell margins** default to 0.1 in left/right and 0.05 in top/bottom on a
  0.5 in row — most of the row. Reduce them when rows are tight.

Header row emphasis (`table.first_row = True`) is a table style switch, not a
formatting guess: it turns on the theme's header fill and bold.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

ROWS = [
    ("Quarter", "Orders", "Touches"),
    ("Q1", "100", "410"),
    ("Q2", "128", "402"),
    ("Q3", "154", "386"),
    ("Q4", "171", "371"),
    ("Total", "553", "1569"),
]

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

shape = slide.shapes.add_table(
    len(ROWS), len(ROWS[0]), Inches(0.9), Inches(1.7), Inches(9.6), Inches(0.46 * len(ROWS))
)
table = shape.table
table.first_row = True
for index, width in enumerate((3.4, 3.1, 3.1)):
    table.columns[index].width = Inches(width)
for row_index, row in enumerate(ROWS):
    table.rows[row_index].height = Inches(0.46)
    for column_index, value in enumerate(row):
        cell = table.cell(row_index, column_index)
        cell.text = value
        cell.margin_left = cell.margin_right = Inches(0.12)
        cell.margin_top = cell.margin_bottom = Inches(0.04)
        for paragraph in cell.text_frame.paragraphs:
            paragraph.font.size = Pt(16)
            if row_index == 0:
                paragraph.font.bold = True
            if column_index > 0:
                paragraph.alignment = 2  # right
total = table.cell(len(ROWS) - 1, 0)
for paragraph in total.text_frame.paragraphs:
    paragraph.font.bold = True
prs.save("table.pptx")
print(f"rows={len(ROWS)} total_width={sum(c.width for c in table.columns) / 914400:.2f}in")
PY
```

## Numbers people trust

- Right-align numeric columns, left-align the label column, keep decimals
  consistent per column (`553`, not `553.0` next to `171`).
- A total row is a claim. Show enough rows that the reader can check it, and let
  `container_tools/native_table_arithmetic_gate.py` prove it from the file.
- Units belong in the header (`Orders`, `Touches`), not in every cell.
- Money keeps its currency in the header or first row; `¥1,240` in every cell of
  a dense table is noise.

## Pitfalls this avoids

- Even column widths turning "Q1" into a 4 in column while numbers crowd.
- A declared height smaller than the content: the last row is drawn below the
  intended block and collides with the footer.
- Colouring cells individually instead of letting `first_row` do the header.

## CLI fast path

`pptx create` accepts `{"table": {"headers": [...], "rows": [[...]]}}` and places
it at 0.8 in from the left, full content width, at the running cursor. For a
chosen rect, column widths or right-aligned numbers, use the recipe.
