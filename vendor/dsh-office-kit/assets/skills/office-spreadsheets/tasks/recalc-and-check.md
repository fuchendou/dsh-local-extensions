# Recalculate and gate consistency

A workbook written by openpyxl or by a script has formula text and no cached results. Open it in a viewer that does not calculate and every formula cell shows blank. `xlsx recalc` runs the real engine to fill the cache; the gate then proves every formula cell got a value and none is an error.

```bash
"<python>" "<cli>" xlsx recalc --input "<book.xlsx>" --out "<book-recalculated.xlsx>"
"<python>" "<skill>/container_tools/recalc_gate.py" --input "<book-recalculated.xlsx>"
```

- `recalc` needs the DSH LibreOffice kit (the same renderer used for images) and runs on Windows, macOS and Linux. Without the kit the verb fails with a plain message and changes nothing.
- `recalc_gate.py --cli` runs `recalc` for you: it takes `--input`, writes `<stem>-recalculated.xlsx` unless `--out` is given, then scans every formula cell.
- It exits `0` clean, `1` with failures, `2` on a usage or file error, and `3` when recalculation was requested but no engine exists. Exit `3` with `verdict: unverified` is an honest result — report it as "structure verified, numbers not recalculated", never as "numbers verified".

## What the gate flags

| Flag | Meaning | Action |
| --- | --- | --- |
| `errors` | Cached value is `#REF!`, `#DIV/0!`, `#NAME?`, `#VALUE!`, `#N/A`, … | Fix the formula or the input; do not paint the cell red and move on |
| `missing` | Formula cell with no cached value | Either recalc did not reach it or it was written after the recalc |
| `dangling` | Formula references a sheet that does not exist | Renaming a sheet without updating formulas does this; restore the name or repoint the reference |
| `ignored` | Cells you passed with `--ignore` | Pre-existing errors the user asked you to leave alone |

`--strict` treats missing values as failures instead of notes, which is what you want after a successful recalc. `--ignore 'Rates!B7,B9'` keeps a known, user-accepted error out of the verdict without hiding the rest.

## Consistency checks the gate cannot do

Recalculation proves formulas evaluate, not that they are right. Check by hand:

- Totals equal the sum of the rows above them, and detail rows add to the summary — not just that both computed something.
- Percentages are stored as fractions and formatted, not typed as `6.4`.
- A case selector drives every tab that claims to follow the case. Two tabs showing different cases is the most expensive defect in a model.
- Hard-coded overrides are visible (a different fill or a comment) and the formula path still exists. If an override replaced a formula, the workbook can no longer update.
- Every input the user expects to change is in a cell they can find, not inside a formula constant.

## When there is no engine

Report exactly what happened: the file was created and structurally verified, the numbers are formulas, and they will populate the first time the user opens the file in Excel, LibreOffice, or Sheets. Offer to render so the user sees the layout and labels. Do not invent values to make the preview look complete.
