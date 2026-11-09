# Number formats

A number format changes how a stored value is displayed, never the value. The cell keeps full precision; `0.0%` shows `6.4%` for `0.06398`. Never store a rounded number to make a column look tidy, and never store `"6.4%"` as text — it stops summing.

```python
import sys
from openpyxl import load_workbook

wb = load_workbook(sys.argv[1])
ws = wb["Model"]

formats = {
    "B11:B14": "#,##0",        # whole dollars
    "B6:B7":   "0.0%",         # rates, one decimal
    "B8":      '"$"#,##0',     # currency with a literal sign
    "C2:C13":  "yyyy-mm-dd",   # real dates, ISO order
    "D2:D13":  '"$"#,##0;[Red]-"$"#,##0',   # negatives in red
}
for rng, code in formats.items():
    block = ws[rng]
    rows = block if isinstance(block, tuple) else ((block,),)   # a single cell is not a tuple
    for row in rows:
        for cell in row:
            cell.number_format = code
wb.save(sys.argv[2])
```

## The codes worth knowing

| Purpose | Code | Notes |
| --- | --- | --- |
| Thousands, no decimals | `#,##0` | The default for money in a model |
| Thousands, two decimals | `#,##0.00` | Prices, unit costs |
| Percent, one decimal | `0.0%` | Analytical percentages — rates, margins, growth |
| Percent, no decimal | `0%` | Dashboard and KPI tiles only |
| Percent, two decimals | `0.00%` | When differences of a tenth of a point matter |
| Currency | `"$"#,##0` | A literal sign keeps the unit visible in every cell |
| Negative in red | `#,##0;[Red]-#,##0` | Check that the reader wants colour, not a `( )` convention |
| Date | `yyyy-mm-dd` | Sortable, unambiguous; store a real date, not text |
| Text passthrough | `@` | For codes and account numbers with leading zeros |

Do not use `0,0%` or `#.##0`. They are not locale-independent and render differently on an engine that reads `,` as a decimal separator.

## Signs, units, and scale

- State the unit once, in the header or title (`Revenue (USD)`), and keep the stored value in that unit. A column that stores thousands but is headed "USD" is a defect waiting to be discovered.
- If the presentation needs thousands (`$K`) while the data is in units, format does not divide — either store thousands and say so, or divide with a formula in a helper column. Never scale twice.
- Percentages: store `0.064`, never `6.4`. A stored `6.4` formatted `0.0%` reads `640.0%`.

## Widths and `###`

`###` means the column is narrower than the formatted number. Widen that column (`ws.column_dimensions["B"].width = 14`) or shrink the font for the block. Never shorten the number, switch to text, or reduce decimals just to fit — and do not autofit every column in the sheet to fix one.

## Dates

Write a real date (`datetime.date(2026, 1, 31)`) and set `yyyy-mm-dd`. An ISO string sorts alphabetically and calculates as text: `EDATE`, `SUMIFS` on dates, and `YEAR()` all fail silently or with `#VALUE!`. A date typed as a number of days since 1899-12-30 is a serial — fine for formulas, unreadable for people, so format it.
