# Formula patterns

People who did not write a formula have to read it, and engines that disagree at the edges recalculate it. Prefer the direct, boring form.

## Anchoring

| Reference | Moves when filled | Use for |
| --- | --- | --- |
| `C8` | both ways | A grid where every cell looks at its own row and column |
| `C$4` | down only | A header row of periods |
| `$A8` | right only | A column of item labels |
| `$B$3` | never | One rate, a case selector, a fixed constant |

`=SUMIFS(Amount,Month,C$4,Item,$A8)` reads the period from the header and the item from the label. `=C8*$B$3` multiplies by one fixed rate; `=C8*C$3` multiplies by the rate in that column. Getting this backwards is the most common silent error in a copied model — check one filled row and one filled column by hand.

## Aggregation

- `SUM` for a column, `SUMIFS` for filtered totals, `COUNTIFS` for counts, `AVERAGEIFS` for averages.
- Use `SUMIFS`/`COUNTIFS` even with one criterion; they read the same and extend cleanly.
- `SUMPRODUCT(qty_range, rate_range)` for paired multiplication; it does not collapse to a single cell the way array arithmetic would.
- `PRODUCT` for multiplied factors, but it skips blanks: a missing input silently removes a factor. Check the inputs before trusting the result.
- `INDEX`/`MATCH`, `VLOOKUP(...,FALSE)`, or `XLOOKUP` — all fine. Keep the exact-match flag explicit. A matched key is not a filled value: check the returned cell for blank as well as for the key existing.
- Long category lists belong in a mapping table with a lookup, not in a nested `IF` chain.

## Dates and periods

- Use the date the source gives; `TODAY()` only when the workbook should track today, and label it when it does.
- Store real dates with a date number format. Text dates do not calculate.
- Derive period filters from one header row so a new month is a copy, not an edit: `=SUMIFS(Amount,Date,">="&C$4,Date,"<"&EDATE(C$4,1),Item,$A8)`.
- Week starting on the first business day (Monday unless the business says otherwise); say which in the header.
- Time scales run left to right coarse to fine: Annual, Quarterly, Monthly, Weekly — with narrow unfilled spacer columns, not merged headers over hidden helpers.

## Missing data

- A real zero is zero. A missing value is blank, or honestly `n.a.`/`N/A` where the reader expects text. Never substitute one for the other to make a chart look complete.
- `IFERROR` only around a failure you understand, never around a whole block to hide it. `IFERROR(x,0)` turns a broken reference into a plausible zero.
- Guards must not swallow the failure they guard against: `=IF(C8=0,"n.a.",B8/C8)` is a clear answer, `=IFERROR(B8/C8,0)` is a lie.
- Missing keys in a lookup should show as missing (`=IFNA(...,"not found")`), not as zero.

## Things not to write

- `LET`, dynamic arrays/spills, `MAP`, `REDUCE`, `LAMBDA`: the engines that read these files implement them unevenly, and openpyxl stores text without validating it.
- `INDIRECT` for everything. It breaks traceability and does not update when a sheet is renamed. Keep it only where the existing file already relies on it.
- Volatile functions (`TODAY`, `NOW`, `RAND`, `OFFSET`) in a calculation grid: every keystroke recalculates them, and the value changes when the file is reopened.

## Circular references

Avoid unintended cycles; Excel flags them for a reason. If a cycle is deliberate (interest on average balance, iterative allocation), document it in the sheet, confirm iteration is enabled, and verify the result converges to the expected number. A model that only "works" because the last recalc happened to stop at iteration 100 is not verified.
