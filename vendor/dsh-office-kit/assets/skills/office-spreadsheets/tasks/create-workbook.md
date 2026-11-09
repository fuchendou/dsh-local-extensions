# Create a workbook

`"<python>" "<cli>" xlsx create --spec "<spec.json>" --out "<book.xlsx>"` writes one sheet per `sheets[]` entry, top-left at A1, and treats any string starting with `=` as a formula.

## Spec keys (only these exist)

```json
{
  "sheets": [{
    "name": "Model",
    "rows": [["Revenue (Q3 actual)", 1840000], ["Growth rate", 0.06]],
    "formulas": { "B4": "=B2*(1+B3)" },
    "styles": {
      "A1": { "bold": true, "size": 16, "color": "FFFFFF", "fill": "1F3A5F", "align": "left" },
      "B2:B3": { "number_format": "#,##0" }
    },
    "widths": { "A": 26, "B": 16 },
    "row_heights": { "1": 24 },
    "freeze": "A2",
    "merged": ["A1:F1"],
    "gridlines": false,
    "charts": [{
      "type": "column",
      "title": "Q4 plan (USD)",
      "anchor": "A16",
      "height": 7,
      "width": 14,
      "data": { "min_col": 2, "min_row": 1, "max_col": 2, "max_row": 4 },
      "categories": { "min_col": 1, "min_row": 2, "max_row": 4 }
    }],
    "images": [{ "path": "<absolute png path>", "anchor": "H2", "width": 240 }]
  }]
}
```

- `styles` values: `bold`, `italic`, `size`, `color`, `fill`, `number_format`, `align` (`left`/`center`/`right`, vertically centered). A range key styles every cell in it.
- `formulas` is address → formula string; the leading `=` is required.
- `charts[].data` and `.categories` use 1-based column/row indices on the same sheet, so build the label column before the value column and keep both over the same rows.
- `merged` takes A1 strings. Merge only for presentation (one title across empty header cells); merged cells cannot be resized, sorted, or filled per cell, so keep data out of them.

## Order of work

1. Sketch sheets as roles, not tabs: inputs, calculations, outputs, checks. A five-line model belongs on one sheet with labelled blocks.
2. Put number formats on the cells, not on a copy of the values. `#,##0` for currency-ish amounts, `0.0%` for percentages, `yyyy-mm-dd` for real dates.
3. Write calculations as visible steps (quantity × rate, opening + movements = closing) and link the output to the build rather than repeating the arithmetic.
4. Add a chart only when it answers a comparison question the numbers alone answer slowly; see `references/charts.md`.
5. Render and read the PNG, then recalc if formulas exist.

## What needs more than the spec

| Need | Route |
| --- | --- |
| Excel Table (filter buttons, banded style, structured references) | `recipes/data-tables.md` |
| Conditional formatting, data bars, colour scales | `recipes/conditional-formats.md` |
| Defined names used by formulas or validation | `recipes/named-ranges.md` |
| Sparkline-style in-cell bars | `recipes/sparklines.md` |
| Chart types or settings beyond bar/column/line/pie | `recipes/charts.md` |
| Page setup, print area, tab colours, sheet protection | openpyxl snippet (`ws.page_setup`, `ws.print_area`, `ws.sheet_properties.tabColor`); see `references/style-guidelines.md` |

## Pitfalls

- Values written through the CLI keep their type: `1840000` is a number, `"1,840,000"` is text and will not sum. Format numbers, never pre-format them as strings.
- A chart whose `max_row` exceeds the data plots empty points as zero, which reads as a collapse to the floor. Match the range to the data.
- `anchor` is where the chart's top-left corner sits; a chart outside the print area gets cut off by `xlsx render`. Put it below or beside the data, inside the printed range.
- Dates must be real dates (`date(2026, 1, 31)` via a snippet, or Excel serial numbers), never `"Jan-26"` strings, or period filters fail silently.
- Set the font family explicitly if the file will be opened on another machine; a missing Calibri falls back to a serif in some renderers and every column width shifts.
