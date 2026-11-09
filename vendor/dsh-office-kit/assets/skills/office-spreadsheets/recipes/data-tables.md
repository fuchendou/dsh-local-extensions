# Data tables (Excel Tables)

An Excel Table (`ListObject`) is the object behind `Insert > Table`: a name, a structured reference, banded rows, an optional totals row, and header filters. It is not a pivot table and not a formatted range. Use it when the user asks for a table, when a filter row helps, or when formulas should read `Sales[Amount]` instead of `$D$2:$D$900`.

```python
import sys
from openpyxl import load_workbook
from openpyxl.worksheet.table import Table, TableStyleInfo

wb = load_workbook(sys.argv[1])
ws = wb["Pipeline"]
table = Table(displayName="PipelineTable", ref="A1:G13")
table.tableStyleInfo = TableStyleInfo(
    name="TableStyleMedium2", showRowStripes=True, showColumnStripes=False
)
ws.add_table(table)
wb.save(sys.argv[2])
```

Rules that survive contact with the user:

- `displayName` has no spaces, no hyphens, and must be unique in the workbook — it becomes the structured reference name (`PipelineTable[Amount]`).
- `ref` must start at the header row and match the real data rectangle. A table whose `ref` is off by one row shows a phantom header and breaks the filter.
- One table per rectangle, one header row, no merged cells inside it.
- Give it a style from `TableStyleLight*`/`Medium*`/`Dark*`; a bare table with no style looks like an unstyled range and the user asks why the stripes went away.

## Appending rows to a table

Rows written below the last table row are outside the table until you widen `ref`. Widen it in the same pass, or the new records will not filter, will not band, and structured references will not see them.

```python
table = ws.tables["PipelineTable"]
first_row = int(table.ref.split(":")[1].rstrip("0123456789"))
new_last = first_row + added
table.ref = f"A1:G{new_last}"          # same columns, one row longer
```

Copy the format and any formula from the previous row (`ws.cell(r, c)._style = ws.cell(r - 1, c)._style`) before widening, so the new row does not appear as a plain block inside a banded table.

## Totals row

`table.totalsRowCount = 1` declares a totals row, and `totalsRowFunction` on a column sets `sum`, `count`, `average`, `min`, `max`, `stdDev`, or `var`. The row below the last data row must exist and hold the header labels Excel expects; a totals row declared without that row renders oddly in some engines. If the user only wants a bold total line under a table, a formula row outside the table is simpler and less fragile.
