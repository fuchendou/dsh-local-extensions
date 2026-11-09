# Connectors

## Mechanics

A connector is a line with two attachment sites. `add_connector` takes begin and
end shapes *plus* connection indices, which is what makes the line follow the
boxes when they move. Pass coordinates instead and you get a floating line: right
in the file you made, wrong the first time a box is nudged.

- `MSO_CONNECTOR.STRAIGHT | ELBOW | CURVE`
- `connector.begin_connect(shape, idx)` / `end_connect(shape, idx)`; `idx` is
  the site index on the shape's outline (0 = top, 1 = left, 2 = bottom,
  3 = right for a rectangle).
- Arrowheads are line properties: `line.end_arrowhead = MSO_ARROWHEAD.TRIANGLE`.

## Recipe

```python
"<python>" - <<'PY'
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
slide = prs.slides.add_slide(prs.slide_layouts[6])

def box(left, top, text, width=2.6, height=1.1):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.text_frame.text = text
    shape.text_frame.paragraphs[0].font.size = Pt(14)
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor(0xF2, 0xF5, 0xF9)
    shape.line.color.rgb = RGBColor(0xC8, 0xD2, 0xDF)
    return shape

order = box(0.9, 2.2, "Order booked")
pick = box(4.4, 2.2, "Picked")
ship = box(7.9, 2.2, "Shipped")

for start, end in ((order, pick), (pick, ship)):
    connector = slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, 0, 0, Inches(0.1), Inches(0.1)
    )
    connector.begin_connect(start, 3)   # right edge
    connector.end_connect(end, 1)       # left edge
    connector.line.width = Pt(2)
    connector.line.color.rgb = RGBColor(0x5F, 0x6B, 0x7A)
    connector.line.end_arrowhead = 3    # triangle

prs.save("connectors.pptx")
from pptx.oxml.ns import qn
print("connectors:", sum(1 for s in slide.shapes if s._element.tag == qn("p:cxnSp")))
PY
```

## Rules

1. Connect facing sides: right → left for a row, bottom → top for a column. A
   line crossing its own boxes reads as an error.
2. Elbow connectors for orthogonal flows, straight for a single hop, curve almost
   never.
3. Two crossing connectors in one diagram makes it a picture of a diagram; split
   it.
4. Label the connector ("12 min", "auto") with a small textbox near its middle,
   not with arrow direction alone.

## Pitfalls this avoids

- `add_connector` with free coordinates: the line is positioned but unattached,
  and later edits break it silently.
- Arrowhead index confusion: arrowhead values are a bitmask enum, not a boolean.
- Connectors behind filled shapes because they were added before the boxes.

## CLI fast path

There is no connector verb in `pptx create`; this recipe is the route. After
building, `container_tools/inspect_presentation_layout_geometry.py` flags
`connector_over_text` when a line crosses a text shape — the failure mode you
cannot see in a thumbnail.
