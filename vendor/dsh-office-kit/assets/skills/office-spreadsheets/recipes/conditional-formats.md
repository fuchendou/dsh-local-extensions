# Conditional formats

Conditional formatting paints a cell from a rule, not from a value. The rule is stored separately from the cell format, so a cell can look red while its stored fill stays default — and a reader who copies the value out gets the number, not the colour.

```python
import sys
from openpyxl import load_workbook
from openpyxl.formatting.rule import (
    CellIsRule, ColorScaleRule, DataBarRule, FormulaRule,
)
from openpyxl.styles import Font, PatternFill

wb = load_workbook(sys.argv[1])
ws = wb["Sensitivity"]

ws.conditional_formatting.add(
    "C4:G8",
    ColorScaleRule(start_type="min", start_color="F8696B",
                   mid_type="percentile", mid_value=50, mid_color="FFEB84",
                   end_type="max", end_color="63BE7B"),
)
ws.conditional_formatting.add(
    "D2:D13",
    DataBarRule(start_type="min", end_type="max", color="5B9BD5"),
)
ws.conditional_formatting.add(
    "C2:C13",
    CellIsRule(operator="lessThan", formula=["0"],
               fill=PatternFill("solid", fgColor="FFC7CE"),
               font=Font(color="9C0006")),
)
ws.conditional_formatting.add(
    "A2:A13",
    FormulaRule(formula=['$F2="Lost"'], fill=PatternFill("solid", fgColor="F2F2F2")),
)
wb.save(sys.argv[2])
```

- `ColorScaleRule`/`DataBarRule` take a range, not a cell; one rule covers the rectangle and scales against the values inside it.
- `CellIsRule` compares one cell: `operator` in `lessThan`, `greaterThan`, `between`, `equal`, `notEqual`, …
- `FormulaRule` evaluates a formula with the range's **top-left** cell, so write the reference for that cell (`$F2` with row relative) and Excel fills the rest.
- A whole-column range (`D:D`) is cheap to write and slow to render; bound the range to the current data (`D2:D13`) and extend it when rows are added.
- Rules stack in priority order; later rules win only when the earlier ones do not match. `stopIfTrue=True` ends the chain — use it when a second rule must not repaint an already-flagged cell.
- Do not also set a static fill on the same cells: the static fill shows through where no rule matches and the sheet looks half-formatted.

## Editing an existing file

Replace a rule; do not add a near-duplicate. Iterate `ws.conditional_formatting` and rebuild the collection for that range — two rules covering `D2:D13` with slightly different thresholds give a result nobody can explain. Keep the rule count per sheet small: a dashboard with forty rules is a compatibility minefield in other engines.

## Verify

Read the file back with `container_tools/inspect_workbook.py`; it lists each range and rule type. Then render and look: a data bar that never appears is usually a range that does not overlap the data, and a rule that fires on the wrong cells is almost always an absolute/relative mistake in `FormulaRule`.
