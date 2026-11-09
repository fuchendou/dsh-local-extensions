# Finance decks

The mechanics are the same as any deck; the failure modes are specific.

## What a finance audience checks first

1. Does the total add up? A slide whose numbers do not sum loses the argument
   before it starts. Run the arithmetic gate on every declared total.
2. Is the period stated? "Revenue up 12%" without a base period is not a claim.
3. Is the unit stated? Thousands, millions, currency, gross or net. Put it in the
   header, once.
4. Is the comparison like-for-like? Full quarter against full quarter; do not put
   a 13-week quarter beside a 12-week one without saying so.
5. Does the chart axis start at zero? For bars, always — a truncated bar chart in
   a finance deck reads as manipulation even when it is not.

## The financial slide kit

| Slide | Content | Note |
|---|---|---|
| Headline | One number, one claim, one source | The number the meeting is about |
| Bridge | Waterfall from last period to this one | Native chart; label the middle bars, not the ends |
| Results table | Period rows, metric columns, total row | Totals computed, not typed |
| Variance | Actual vs plan vs prior, and why | The "why" is a sentence, not a column |
| Outlook | Ranges, not points | A single forecast point implies precision you do not have |
| Ask | The decision, the amount, the date | Last slide, one line |

## Numbers on slides

- Two significant figures is usually enough for a headline (`£2.4m`, not
  `£2,384,117`). Keep full precision in the appendix table.
- Percentages: one decimal at most, and say what they are a percentage *of*.
- Round consistently: if the headline says 2.4m, the table should not say 2.38m
  in one row and 2.4m in the next.
- Negative numbers: one minus sign convention (`−12%`), parentheses kept for
  tables where accounting convention is expected.
- A variance is meaningless without its sign and direction; state whether
  favourable is up or down (revenue vs cost).

## Charts that survive a CFO

- Waterfall for a bridge, column for periods, line for a trend, never pie for
  more than three slices.
- Label the axis unit once, in the caption: "£m, FY2026 actuals".
- One series per chart unless the comparison *is* the point.
- Do not chart a table of six numbers; the table is more honest and faster to
  read.
- Forecast periods are visually distinct (lighter fill, dashed line) and named in
  the caption.

## Provenance

Every non-obvious number gets a note with: source file or system, extraction
date, period covered, any adjustment made. The speaker notes are the right place;
a footnote-heavy slide is a slide nobody reads.

## Check before delivery

```bash
"<python>" "<skill>/container_tools/native_table_arithmetic_gate.py" --input deck.pptx --contracts totals.json
"<python>" "<skill>/container_tools/native_quantitative_chart_gate.py" --input deck.pptx --all-slides
"<python>" "<skill>/container_tools/inspect_presentation_layout_geometry.py" --input deck.pptx
```

Then read the slides as a sceptic: which number would you challenge first, and
does the deck already answer it?
