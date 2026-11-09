# Answering questions about a workbook the user has open

Read-only: no writes, no saves, no restyling. Deliver an answer with cell references the
user can check, not a changed document.

## Reading

- `info` first: which workbook, sheets, used ranges, tables, charts, pivots — and whether
  the thing asked about exists.
- `read_range --formulas` for the cells that matter. The value says *what*; the formula
  says *why*. A number with no formula is a typed input; a formula with no precedent is
  untrustworthy.
- `read_range --display` when the question is how something *reads* (`###`, a truncated
  label, a date shown as a serial): displayed text follows the number format, values do
  not.
- Read the workbook's labels — headers, periods, "Actual" vs "Forecast", units — before
  interpreting a cell. `D14` means nothing without "Q3 advertising spend, USD".
- The window may be ahead of the file. `info` showing `saved: false` means you are reading
  the user's unsaved state; say so when the answer would differ.

## Answering

1. **Locate the output by its labels**, not by guessing: find the metric's row/column and
   the period, then read the intersection.
2. **Trace the precedent chain** back to labelled assumptions or raw inputs. Use
   `read_range --formulas` at each step; stop at typed cells. Reporting an intermediate
   total as the cause is the classic error.
3. **Reconcile before asserting.** If a total is not the sum of its parts, that is the
   finding: report the gap and the cells; do not average it away.
4. **Compute from underlying values.** A cell showing `1.2` may hold `1.2345`; use the
   stored value, and say so if the requested precision forces the displayed one.
5. **Rank drivers** by absolute contribution for "why did it move": the top two or three,
   with cells and amounts, not everything.
6. **Cite cells**: `` `Summary!D14` shows 1,234 units because `Build!F7:F12` sums to that ``.
   A claim without an address is unverifiable.
7. Sheets disagree: say which you believe and why (more recent period, source over copy,
   formula chain over paste) and do not "fix" either unasked.

## Sensitive reviews

Clinical records, payroll/compensation, customer-level data: answer at the level asked and
no lower. Inspect structure, formats, dependency chains and formulas as evidence; do not
echo restricted values unless the user needs that figure to act. If the question cannot be
answered without exposing personal data, say what you can answer instead.

## Limits

- Do not equate the live window with the saved file, or present a read-only answer as
  verified against disk.
- External links, volatile functions (`NOW()`, `RAND()`) or an unrefreshed pivot cache make
  the number provisional; say so.
- Protected sheets: reads work; report the protection, do not work around it.
- `#REF!`, `#DIV/0!` and friends are part of the answer: name the cell, the formula and what
  it broke.
