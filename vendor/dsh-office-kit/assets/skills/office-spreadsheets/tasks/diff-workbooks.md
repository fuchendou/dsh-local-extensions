# Diff two workbooks

```bash
"<python>" "<skill>/container_tools/diff_workbooks.py" --before "<original.xlsx>" --after "<edited.xlsx>"
```

Exit code `0` means the files match at the requested level, `1` means differences (not a failure), `2` is a usage or read error. The report is JSON on stdout.

## Options

| Flag | Effect |
| --- | --- |
| `--no-formats` | Compare values and formulas only; ignore styling, number formats, widths |
| `--sheet NAME` | Restrict to one sheet (repeatable) |
| `--limit N` | Cap the cell-level changes listed per sheet (default 200); counts stay exact |

## What it compares

- **Structure** — sheet list and order, added/removed sheets, merged ranges, column widths, hidden state.
- **Cells** — value and formula changes, reported as `{cell, before, after}` per sheet, with a count even when the list is truncated.
- **Formatting** — number format, fill, font weight and colour, alignment; dropped by `--no-formats`.
- **Objects** — Excel Table names and refs, defined names, chart counts and series, conditional-formatting rule sets.

## Using it as an edit gate

Run it as `--before original --after original-edited` immediately after any edit, and read the "changed" sections as the diff you are about to describe to the user:

1. Cells you did not intend to touch are collateral damage — revert and redo with a narrower edit.
2. A sheet, table, name, or chart under "removed" is a lost object; rebuild it from `recipes/charts.md` / `recipes/named-ranges.md` before presenting.
3. Formatting-only differences across many rows usually mean a style object was reapplied to a range instead of a cell.

Diffing a file against itself is a useful sanity check that the tool and the file load cleanly: it should return `identical: true`.

## Limits

- Cached formula results are not compared; use `recalc_gate.py` for that.
- Pivot caches and VBA are compared by part presence, not content.
- Chart internals are compared by count and series references; a restyled chart of the same data reads as unchanged.
