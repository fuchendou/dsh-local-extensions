# Tables and layout geometry

Table geometry is three things that must agree: the grid (`w:tblGrid`, one `w:gridCol` per column), the table width (`w:tblW`) and each cell width (`w:tcW`). When they disagree, Word shows a table wider than the text block, or columns that jump on the first edit.

## Create

Use `docx create --spec` with a table block:

```json
{ "type": "table", "headers": ["Region", "Q1"], "rows": [["North", "10"]], "style": "Table Grid" }
```

Header cells are bold. To repeat the header row on every page:

```bash
"<python>" "<skill>/scripts/a11y_audit.py" "<out.docx>" --fix_table_headers first_row --out "<out-fixed.docx"
```

That writes `w:tblHeader` on row 1.

## Inspect and fix geometry

```bash
"<python>" "<skill>/scripts/table_geometry.py" "<file.docx>"
"<python>" "<skill>/scripts/table_geometry.py" "<file.docx>" --fix --out "<file-fixed.docx"
```

The audit reports `tblW`, the layout mode, every grid column in twips with their sum, and the narrowest and widest cell. `--fix` writes a fixed-layout table at the text width (page width minus margins), rescales the grid proportionally and rewrites each `tcW`, including `gridSpan`. On Letter with 1in margins the text width is 9360 twips.

## Move data between formats

```bash
"<python>" "<skill>/scripts/docx_table_to_csv.py" "<file.docx>" --table_index 0 --out "<table.csv"
"<python>" "<skill>/scripts/xlsx_to_docx_table.py" "<book.xlsx>" --sheet Revenue --out "<table.docx>" --title "Revenue by region"
```

`docx_table_to_csv.py` flattens the table, expands horizontal spans and repeats vertically merged values. `xlsx_to_docx_table.py` writes a bold header row plus `w:tblHeader`; it is the route for "put this spreadsheet in the report", not a screenshot or an embedded object.

## Design

- Bold header row, light grey `#D9D9D9` borders, no shading in the body.
- Numeric right-aligned, text left-aligned, thousands separators inside the cells.
- Two or three prose columns at most. A wide table wants landscape through a section break (`tasks/sections_layout.md`), not a smaller font.
- Caption above the table (`tasks/captions_crossrefs.md`). Avoid vertical merges.

## Verify

Render the page: nothing past the right margin, header row intact, no row split across pages, last column not truncated. A table that fits in XML but overflows the page is a real defect that only the render shows.

## Pitfalls

- A table inside a cell inherits the cell width, so check the outer table first.
- `autofit` is a request, not a guarantee.
- Cell margins default to 108 twips of padding.
