# Evidence on slides: charts, tables, notes

"Evidence" is anything on a slide that claims a fact: a number, a chart, a table,
a quotation. These rules keep it checkable.

## Native or it did not happen

| Claim | Correct form | Wrong form |
|---|---|---|
| Trend over time | Native chart with categories and series | Screenshot of a chart |
| Exact figures | Native table | Image of a spreadsheet |
| A single number | A bold run in a sentence | A one-bar chart |
| A process | Shapes plus connectors | Image of a flowchart |

The wrong column is unreadable at projector size and unverifiable. Native charts
and tables keep their numbers in the package, which is what lets the
quantitative-chart and table-arithmetic gates check them
([inspect-and-verify](../tasks/inspect-and-verify.md)).

## Charts

- The chart title says what the chart means. The slide title says the conclusion.
  If they are the same sentence, drop the chart title (`chart.has_title = False`)
  rather than repeat it.
- Bars start at zero. Lines may start elsewhere only if the axis is labelled.
- Categories in the order the audience thinks in (Q1..Q4, not alphabetised).
- Label the few numbers that matter, not every point; ten data labels is a table
  with rounded corners.
- One axis. Two y-axes imply a correlation that may not exist.
- Source and window in the caption: "Driver logs, FY2026, 12 sites".

## Tables

- Column order follows the reader's question: what, then how much, then change.
- Header row bold and distinct; total row bold and separated.
- Numbers right-aligned, one decimal convention per column.
- A total is arithmetic the reader can check. Fill it from the data, never by
  eye, and let the table arithmetic gate confirm it.
- No units in every cell; units in the header.
- A table over about 7 rows belongs in an appendix, with the slide stating the
  conclusion.

## Speaker notes as provenance

Notes hold "where did this number come from", so the presenter can answer without
turning the slide into a footnote.

- One note per non-obvious number: source, date range, any caveat.
- The sentence you will actually say, in spoken words.
- No bullet-stacking in notes; notes are prose.
- Notes are invisible to the render loop — verify them from the file, not the
  PNGs. `container_tools/inspect_presentation_package_integrity.py` counts
  `notesSlides`, and the package dump shows their text.
