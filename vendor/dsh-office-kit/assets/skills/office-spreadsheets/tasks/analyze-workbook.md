# Answer questions about an existing workbook

This is a read-only job. Do not "improve" the file, do not recalculate it in place, and do not save a copy unless the user asked for one.

## Procedure

1. `"<python>" "<cli>" xlsx read --input "<book.xlsx>" --json-out "<dump>.json"` — sheet names, used ranges, and cell contents.
2. Read **values**, not formulas, when the question is about numbers: `xlsx read --data-only` returns cached results. If the cache is empty (the file was last written by a script), say so and quote the formula instead of a number, or recalculate into a copy first (`tasks/recalc-and-check.md`).
3. `container_tools/inspect_workbook.py --input "<book.xlsx>" --sample 8` when the question touches structure: which cells are formulas, merged ranges, totals rows, conditional formats, defined names, hidden rows, extra sheets.
4. Answer with the cells you used: "`Pipeline!B4:B13`, the Amount column, sums to `812,000`" beats "the pipeline is about 800k". Name the sheet, the range, and the figure.

## Judgement calls

- A number that disagrees with the user's expectation is usually a real answer, not an error to fix. Explain the calculation and stop.
- Pre-existing `#REF!`/`#DIV/0!` cells are part of the answer. Point at them, say what breaks, and wait for instructions.
- Two tabs with the same title and different numbers: report both and ask which one the user means before averaging or picking.
- Empty cells are not zeros. "Not reported" and "zero" are different answers, and a missing month in a total usually means a filter, not a zero.
- If the workbook has a case selector, check it. The answer depends on it.

## Output shape

Short answer first (one line with the figure), then the cells behind it, then any caveat about missing data or stale cache. No file changes, no new workbook, no chart unless asked.
