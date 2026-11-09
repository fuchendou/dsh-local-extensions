# Edit an existing workbook

The file is the specification. Read its conventions before writing a cell, then make the smallest change that satisfies the request.

## Procedure

1. `"<python>" "<cli>" xlsx read --input "<book.xlsx>" --json-out "<dump>.json"` — every sheet, its used range, and its formulas.
2. `"<python>" "<skill>/container_tools/inspect_workbook.py" --input "<book.xlsx>"` — what the read verb hides: merged ranges, conditional formatting, defined names, Excel Tables, charts and their series, freeze panes, protections. It prints JSON; `--no-values` skips the second load that looks for cached results.
3. Render the sheets you are about to touch and look at them: `xlsx render`, then `read_image`. Match the surrounding format, not your personal default.
4. Apply the edit with the narrowest tool that fits (below), or with an openpyxl snippet when the change is not one of those shapes.
5. Read back and re-check structure, recalculate if formulas changed, render again, compare.

## Mutation tools

There is no `xlsx edit` verb. Each tool loads the workbook, changes only what you name, and saves a copy.

| Change | Command |
| --- | --- |
| Write values and formulas | `set_cells.py --input "<book.xlsx>" --out "<step1.xlsx>" --sheet Model --set B3=0.07 --set D9="=SUM(D2:D8)"` |
| Reuse a file of assignments | `set_cells.py --input "<book.xlsx>" --spec "<cells.json>"` |
| Format cells | `style_cells.py --input "<step1.xlsx>" --out "<step2.xlsx>" --sheet Model --range B11:B14 --style '{"number_format":"#,##0"}'` |
| Append records | `append_rows.py --input "<book.xlsx>" --sheet Pipeline --rows '[["Delta Supply","R. Osei","Proposal",98000,0.4]]'` |
| Add, rename, delete, reorder sheets | `sheet_ops.py --input "<book.xlsx>" --add Checks` / `--rename Sheet1=Assumptions` / `--delete Scratch` / `--order "Outputs,Assumptions,Build"` |
| Add a native chart | `add_chart.py --input "<book.xlsx>" --sheet Trend --type line --title "Monthly revenue (USD)" --anchor A6 --data-min-col 2 --data-min-row 3 --data-max-col 13 --data-max-row 3 --cat-min-row 2 --cat-max-row 2` |
| Embed an image | `add_image.py --input "<book.xlsx>" --sheet Cover --path logo.png --anchor B2 --width 320` |

Each tool writes `<input>-edited.xlsx` unless you pass `--out`, so chain by naming outputs — never edit the file you just read and lose the step in between.

`cells.json` is `{"sheet": "Model", "cells": {"B3": 0.07, "D9": "=SUM(D2:D8)"}}` or a list of those. `styles.json` is `{"sheet": "Model", "styles": {"A11:B11": {"bold": true}, "C11:C14": {"number_format": "0.0%"}}}`.

Two tool limits are deliberate: `append_rows.py` does not extend an Excel Table, copy the formula from the row above, or grow a chart — use a snippet from `recipes/data-tables.md` and `recipes/charts.md`, or the new rows sit outside the table and the chart stops at the old last row. `add_chart.py` treats a one-row data range as one series of many points (what a monthly row means) but cannot set axis number formats or series colours; fix those in the same snippet.

## What must survive an edit

| Thing | Why it breaks | Guard |
| --- | --- | --- |
| Formula cells outside the edit | openpyxl keeps the formula text, so they survive — unless something flattens them | Never write computed results over formulas |
| Pivot tables | openpyxl does not model pivots; a save-backed rewrite can drop the cache | Inspect before/after, or edit with a snippet that touches only cells |
| Excel Tables (`ListObject`) | Rows appended below a table are outside it | Extend `table.ref` when you add rows |
| Shared formulas and array formulas | Re-saving can materialise or drop them | If the area uses them, edit only the cells asked and diff after |
| Named ranges, conditional formats, validation | Not always round-tripped by third-party writers | Confirm with `inspect_workbook.py` after the save |
| Charts, images, sparklines | Anchored objects; some are dropped on re-save | Count them before and after; rebuild from `recipes/charts.md` if lost |
| Freeze panes, hidden/grouped rows, tab colours, protection | Structural metadata | Diff structure before and after |
| Sheet names used in formulas | Renaming breaks every reference | Prefer adding a sheet over renaming one |

New conditional formatting that covers a whole table must extend to the rows you add, or the new rows look unfinished. A dynamic chart range whose source grows needs the same extension, or the chart stops at the old last row.

## Cells: the smallest change

- Write to the sheet and address you resolved; never "the first empty row" of an unnamed sheet.
- A text edit changes run-level text only; the cell format stays unless the request names it.
- A number-format change is a format change, not a value change: do not replace `0.0649` with `6.5%` text.
- Do not autofit every column or restyle a table to fix one clipped cell. Widen the column, or shrink the font only for that block.
- Do not add spacer rows, helper sheets, or "Notes" tabs unless the request needs them.

## Errors you did not cause

If `xlsx read` shows `#REF!`, `#DIV/0!`, or a formula pointing at a sheet that no longer exists, it is pre-existing. Summarise where it is and ask before touching it — repairing it silently changes numbers the user may already have reported.

## Verify

```bash
"<python>" "<cli>" xlsx recalc --input "<book-edited.xlsx>" --out "<book-edited.xlsx>"
"<python>" "<skill>/container_tools/recalc_gate.py" --input "<book-edited.xlsx>"
"<python>" "<skill>/container_tools/diff_workbooks.py" --before "<book.xlsx>" --after "<book-edited.xlsx>"
"<python>" "<cli>" xlsx render --input "<book-edited.xlsx>" --out-dir "<render-dir>"
```

The diff is the closest thing to a guarantee that nothing else moved: it reports changed cells and formulas, changed formatting unless you pass `--no-formats`, and structure changes (sheets, merges, widths, tables, charts, defined names). Exit code `1` means differences — not failure. Use `--sheet` to narrow and `--limit` to cap the per-sheet cell list. Gate flags and exit codes: `tasks/recalc-and-check.md`.
