# Financial models

Forecasts, budgets, cash-flow plans, and valuation work in any industry.

- Periods run left to right with the scale in the header (Actual, Forecast, Budget). Do not mix a monthly column with a quarterly total in the same row unless a labelled total column sits at the edge.
- Drivers first, results second: volume × price, headcount × cost, days × rate. A revenue row that jumps straight to a number cannot be reviewed.
- State units once and keep them: thousands and millions in the same block is the classic reconciliation failure. Put the unit in the title, not a footnote.
- Three statements or none: if the workbook has a balance sheet and a cash flow, the balance sheet must balance and closing cash must equal the cash-flow ending balance. Make these checks, not comments.
- Working capital moves: receivables from revenue × DSO, payables from cost × DPO, inventory from COGS × days. Hard-coded working-capital changes break when drivers move.
- Scenarios: one selector, one set of case inputs per driver, and an explicit `Case Selected:` on each output. Two switch cells report two answers.
- Never hard-code a total that exists as a sum, and never sum a column that already holds a total — double counting is silent.
- Sensitivity: one or two variables, closed-form or a small grid with the base case marked. A native What-If Data Table is a different object with its own limits; build one only when the user asks and the engine supports it.

## Checks a finance reader looks for first

| Check | Expected |
| --- | --- |
| Balance sheet balances | Assets − Liabilities − Equity = 0 |
| Cash ties | Closing cash on the balance sheet = cash-flow ending balance |
| Sum of segments | Segment revenue = consolidated revenue |
| Period total | Sum of monthly columns = annual total column |
| Case consistency | Every tab shows the same selected case |
| No hard-coded totals | Total cells are formulas |

Put them on a check tab, terminal and read-only. Make a failing check visually obvious without painting passing checks green.
