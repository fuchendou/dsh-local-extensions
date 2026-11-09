# Native charts

A native chart is an object bound to cell ranges: the numbers stay in cells, the chart reads them, and editing a cell moves the bar. That is the whole reason to add one instead of pasting an image.

```python
import sys
from openpyxl import load_workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.axis import ChartLines

wb = load_workbook(sys.argv[1])
ws = wb["Trend"]

chart = LineChart()
chart.title = "Monthly revenue (USD)"
chart.height, chart.width = 7, 16
chart.legend = None

data = Reference(ws, min_col=2, min_row=3, max_col=13, max_row=3)   # one row
chart.add_data(data, from_rows=True, titles_from_data=False)        # one series, 12 points
chart.set_categories(Reference(ws, min_col=2, min_row=2, max_row=2))
chart.y_axis.numFmt = "#,##0"
chart.y_axis.majorGridlines = ChartLines()
chart.y_axis.scaling.min = 0                                        # bars must start at zero
ws.add_chart(chart, "A6")
wb.save(sys.argv[2])
```

## Orientation is the bug people hit

A one-row source is **one series of many points**, not many series of one point. `Reference` cannot express that; `add_data(..., from_rows=True)` can. Without it a monthly row becomes twelve invisible one-point series and the chart renders blank. The mirror case is a one-column source added with `from_rows=True`: you get one series per cell row, so pass it only when the data really is row-wise.

## What the helper CLI gives you

`xlsx create` accepts `charts[]` with `type`, `title`, `anchor`, `height`/`width`, `data {min_col,min_row,max_col,max_row,titles_from_data}` and `categories`. `container_tools/add_chart.py` adds the same chart to an existing file and handles the row-oriented case. Neither sets axis number formats, series colours, legend position, data labels, or gap width — if the chart needs those, use a snippet like the one above.

## Checks before you present

- Series count matches the intent (one line per series, not one per point).
- Categories are labels, not values and not an empty axis with `1, 2, 3, …`.
- Bar, column, and area axes start at zero; line and scatter may narrow the range, but the scale must be visible and stated.
- No default legend on a single series; name each series in `titles_from_data` or the legend reads `Series 1`.
- Axis number formats are set on the chart, not inherited from cells — a source column formatted as `0.0%` does not format the axis.
- The chart sits near its data, over empty cells, and is not clipped by the print area when the sheet is printed.

## Editing a chart in an existing file

Read the object first (`inspect_workbook.py` lists type, anchor, and series refs), change the smallest property, and re-render. Moving a chart a few cells is fine; rebuilding it with different styling when the user asked for one number to be added is not.
