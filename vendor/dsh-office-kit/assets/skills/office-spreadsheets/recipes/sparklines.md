# Sparklines and in-cell bars

openpyxl writes no sparkline object (and neither does the helper CLI), so a "sparkline" here is one of two things: a formula that draws a bar inside the cell, or a tiny native chart. Pick by what the user needs to read.

```python
import sys
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font

wb = load_workbook(sys.argv[1])
ws = wb["Trend"]

for col in range(2, 14):                       # B..M
    letter = ws.cell(1, col).column_letter
    cell = ws.cell(4, col, f'=IF({letter}3="","",REPT("█",MAX(1,ROUND({letter}3/MAX($B$3:$M$3)*7,0))))')
    cell.font = Font(size=9, color="FF2E7D32")
    cell.alignment = Alignment(horizontal="left", shrink_to_fit=True)
ws.row_dimensions[4].height = 14
wb.save(sys.argv[2])
```

- `REPT` needs a repeat count that fits the column. A 9-character column shows about 7 blocks at 9pt; anything longer spills into the neighbouring cell and the bars look like one continuous smear. Scale to the column width, not to 22.
- Keep the count formula-driven (`value / MAX(values) * width`), so a changed number moves the bar.
- The block character is text. Sorting the column sorts blocks, and a reader who copies the cell gets `████`, not a number — never put these in the column the numbers should be read from.
- Guard blanks with `IF(cell="","",…)`, otherwise a blank reads as zero and every missing month draws a minimum bar.
- An in-cell native chart is not the same as a chart object: if the user needs a hover tooltip, axis, or legend, build a real chart with `recipes/charts.md` instead of stretching a formula.

## When a real chart is the right answer

A sparkline is context for one number, in a dense table. If the sheet has space and the point is the trend itself, a small `LineChart` (height 4, width 9, no legend, no gridlines) reads better and stays editable. Two or three word-sized charts beat a wall of block characters.
