# Native charts

## Mechanics

A chart added with `slide.shapes.add_chart` is a real chart part
(`ppt/charts/chartN.xml`) with an embedded workbook
(`ppt/embeddings/*.xlsx`). That matters:

- The audience can edit the numbers in PowerPoint; a picture of a chart cannot.
- The data is in the file, so a gate can check it. A screenshot cannot be
  checked, and nobody notices a wrong screenshot.
- The chart inherits the slide's theme for colour and type, so charts match the
  deck without per-chart styling.

`CategoryChartData` holds the numbers; `chart.plots[0]` holds the geometry of the
marks. Category order is the series' own order — sort before you pass it, because
a chart does not sort.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from pptx.util import Inches, Pt

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

data = CategoryChartData()
data.categories = ["Q1", "Q2", "Q3", "Q4"]
data.add_series("Orders fulfilled", (100, 128, 154, 171))
data.add_series("Touches", (410, 402, 386, 371))

frame = slide.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.9), Inches(1.6), Inches(11.5), Inches(5.1), data
)
chart = frame.chart
chart.has_title = True
chart.chart_title.text_frame.text = "Orders fulfilled per quarter"
chart.chart_title.text_frame.paragraphs[0].font.size = Pt(14)
chart.has_legend = True
chart.legend.position = XL_LEGEND_POSITION.BOTTOM
chart.legend.include_in_layout = False

plot = chart.plots[0]
plot.has_data_labels = True
plot.data_labels.number_format = "0"
plot.data_labels.number_format_is_linked = False
plot.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
plot.gap_width = 60

chart.value_axis.has_major_gridlines = True
chart.value_axis.tick_labels.font.size = Pt(11)
chart.category_axis.tick_labels.font.size = Pt(11)
prs.save("chart.pptx")
print("saved chart with", len(chart.series), "series")
PY
```

## Rules for charted numbers

1. One idea per chart. Two series is fine; six is a table.
2. No chart title repeating the slide title — the slide title says what the chart
   *means* ("Throughput rose while touches fell"), the chart shows the numbers.
3. Start the value axis at zero for bars, and say so in the notes if you do not.
4. Data labels beat a value axis grid; pick one, not both.
5. Never leave the default "Chart Title" text in a shipped deck.

## Pitfalls this avoids

- `number_format` without `number_format_is_linked = False` reverts to the
  workbook's format the next time PowerPoint refreshes the chart.
- `legend.include_in_layout = False` stops the legend stealing plot height and
  squashing the bars.
- Deleting the embedded workbook (by zipping/unzipping carelessly) turns the
  chart into an uneditable picture in every downstream viewer.

## CLI fast path

`pptx create` accepts
`{"chart": {"type": "column", "title": "...", "categories": [...], "series":
[{"name": "...", "values": [...]}], "left": 0.9, "top": 1.45, "width": 11.5,
"height": 5.1}}`. The recipe above is the route when you need axis, label or
legend control.
