# Chart choice and audit

A chart earns its place when it makes a comparison, a trend, a distribution, or a relationship easier to see than a table would. If the reader only needs the figures, a compact table or a KPI tile is better — and cheaper to check.

| Question | Default | Notes |
| --- | --- | --- |
| Compare and rank categories | Column or bar, sorted by value | Horizontal bar for long labels |
| Change over time | Line, chronological left to right | Area only when the volume under the line means something |
| Distribution of values | Histogram (formula bins + bar) | Box-and-whisker when median and spread matter and the engine supports it |
| Relationship between two numbers | Scatter | Never a line chart over unordered pairs |
| Share of a whole | Sorted bar, or a table | Pie/doughnut only for two or three slices, rough share |
| Exact values | Table | A chart cannot carry precision |
| One metric with context | KPI tile plus a small line | Sparkline-style bars only if the sheet is dense |

## Honesty

- Series must read from cells, not typed arrays, and derived values must be formulas. A chart of pasted numbers drifts the moment the table updates.
- Include zero on bar, column, and area axes. Narrowing a line or scatter axis is acceptable when the limits are stated; a truncated bar axis turns a 5% change into a dramatic cliff.
- No 3-D, no shadows, no gradients. They occlude data and date the workbook.
- One period, one baseline, one unit across comparable charts. Disclose omitted periods and missing values; do not let a blank read as zero.
- Sort categories deliberately (by value, or by the natural order of time), and keep the same order across charts that will be compared.

## Formatting rules that catch reviewers' eyes

- Title states subject and unit: `Profit by category ($m)`, `Monthly revenue (USD)`. No placeholder titles, no legend standing in for a title.
- Units in the title or on the axis: `($K)`, `($M)`, `(USD thousands)`. Never `($000)`.
- Axis number formats are set on the chart. Source cell formats do not carry over, and a `0.0%` column can still produce `0.06, 0.08` ticks.
- Few series: direct labels. More series: legend above the plot area, consistent colours per series across the workbook.
- Single series: no legend, one colour. A reference or target line is neutral or dashed so it does not read as another data series.
- Selective data labels only — the last point, the maximum, the one the user asked about. Ten labels on a twelve-point line is a table with extra steps.
- Line strokes are set explicitly; a fill alone may not colour an exported line.

## Placement

Charts sit next to the data they describe, aligned to a column edge, over empty cells, and never over the data, the controls, or a note. Size them to their content; a chart stretched across the page with two bars looks unfinished.

## Verifying a chart

1. Read the object back: type, anchor, series count, category source.
2. Render and look at the image: are there categories, is anything clipped, is the legend empty, do the bars reach the values in the table?
3. Compare the visual against the sheet's numbers at one or two points.
4. Re-open in the app the user will use if the colours matter — an authoring preview is not proof that a filled series exports as a visible line.

If the chart cannot be delivered as asked (the engine has no box plot, the data cannot be rearranged), say so and use the closest clear alternative. Never claim a requirement was met by a chart that does not show it.
