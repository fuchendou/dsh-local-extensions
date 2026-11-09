# Named ranges

A defined name is a saved reference with a readable name: `Q4Growth` instead of `Model!$B$6`. Formulas that use names survive row and column insertion, and the user can select the name box instead of hunting for a cell.

```python
import sys
from openpyxl import load_workbook
from openpyxl.workbook.defined_name import DefinedName

wb = load_workbook(sys.argv[1])
wb.defined_names["Q4Growth"] = DefinedName("Q4Growth", attr_text="Model!$B$6")
wb.defined_names["PlanRevenue"] = DefinedName("PlanRevenue", attr_text="Model!$B$11")
wb.save(sys.argv[2])
```

- The name must be a legal identifier: letters, digits, underscore, not a cell address (`Q4` alone is a column, so it is refused).
- `attr_text` is a full sheet reference; quote sheet names with spaces: `'Case A'!$B$4`.
- Workbook-level names live in `wb.defined_names`. To scope a name to one sheet, put it on the worksheet: `wb["Model"].defined_names["Rate"] = ...` — the same name can then mean different cells on different sheets, which confuses readers unless the workbook already works that way.
- Read the existing names with `container_tools/inspect_workbook.py` before adding one; a duplicate name is a repair prompt in Excel.
- Never point a name at a range whose size changes (`A2:A900`) unless the sheet really ends there; prefer the exact used range, or a table reference.

## Using names in formulas

`=PlanRevenue*Q4Growth` is more readable than `=Model!$B$11*Model!$B$6`, and it does not break when a row is inserted. Paste the formula text exactly as the user would type it; openpyxl never resolves the name.

## Removing a name

Deleting a name leaves every formula that used it as `#NAME?`. Find the users first (formula text is visible in `inspect_workbook.py` output and `xlsx read`), then delete, then recalculate and check the gate.
