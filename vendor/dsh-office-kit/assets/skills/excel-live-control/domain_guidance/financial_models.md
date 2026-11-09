# Financial models

A live edit makes every modelling distinction visible to a watching user.

## The distinctions that matter

| Looks similar | Actually different |
| --- | --- |
| Revenue (earned) | Collections (cash received) — timing, bad debt, deferred revenue |
| Payroll expense | Cash paid to employees — accruals, timing, employer costs |
| Capex | Depreciation / amortisation — cash out once, expense over life |
| Earnings | Cash flow — working capital, non-cash items, financing |
| Budget | Forecast — a target vs an expectation; never mix them silently |

Establish fiscal calendar, horizon (monthly / quarterly / annual) and grain (company,
segment, product) before typing a number; without all three it is not a model input. Show
actuals and forecast apart (divide, label or fill) so the reader sees where history stops.

## Schedules

Build a driver schedule per line, then a statement, then the output.

- **Revenue**: volume × price; mix for segments; recognition timing for multi-period
  contracts. No straight growth percentage unless the user asked.
- **Payroll**: headcount, FTE and paid FTE are three numbers. Prorate hires and exits by
  month; never divide an annual salary by 12 twice; state commission and employer-cost basis.
- **Opex**: units × rate, fixed, or one-time — say which. A growing line needs a driver, not
  a percent of revenue, unless that is stated policy.
- **D&A**: cost, residual value, in-service date, useful life, convention; reconcile
  gross-asset and accumulated-depreciation roll-forwards to the prior period.
- **Statements**: retained earnings = opening + net income − dividends; cash-flow ending
  cash = balance-sheet cash. A mismatch is a plug: report it, do not fix it.

Worked unit check, in the cells: $60,000 of salary over 10 paid FTE is $6,000 per FTE;
$6,300 per FTE × 11 is $69,300 against $66,000 at the prior rate — rate and headcount both
moved, so both need a row. Missing pay or zero FTE: implied rate unavailable; never divide
by zero into 0.

## Refreshes and merges

Merge complete periods on the business key (calendar date, master product code). Never append
a partial period as complete; never drop a dimension silently — report unmatched rows.

## Variances and audit

- A variance needs an amount **and** a percent. Zero or missing base: write `n.a.`, not `0%`.
- Check totals: parts sum to the whole, schedules tie to statements, the bridge closes to
  zero; compare to two decimals including `0.00`; a check that passes at 0.01 is failing.
- Failed checks: `#FFC7CE` fill with bold `#9C0006` text; passes stay neutral. Missing or
  untested data is "unavailable", never "PASS".

## Valuation, if it comes up

- A DCF needs drivers, tax, D&A, capex, working capital, unlevered free cash flow, the
  discounting convention, a terminal-value method and the enterprise-to-equity bridge;
  skipping two is a wrong answer, not a shortcut.
- IRR/XIRR need valid signs and dates; with no sign change there is no IRR, and `#NUM!` is
  the answer to report.
- Sensitivities belong in a native what-if data table, not a grid of hand-typed scenarios.

## Doing it live

- Read first: `info` for tabs and objects; `read_range --formulas` over the rows you will
  extend; match existing anchoring (`$C$4` rate, `C$9` period header) and `SUMIFS`
  aggregation.
- One driver row at a time, each with a formula you can point at; verify after each block. A
  200-cell scenario grid written blind is the expensive way to fail.
- Extend the check tab to cover new rows; on a small model with none, add one labelled
  verification row beside the output.
- Never hard-code a total a formula can tie; never "fix" an existing `#REF!` — report it.
