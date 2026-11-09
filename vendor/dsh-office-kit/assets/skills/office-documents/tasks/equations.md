# Equations

Word stores native equations as OMML inside `m:oMathPara`/`m:oMath`. The CLI converts LaTeX to OMML on creation. A picture of an equation cannot be edited and scales badly.

## Create

`docx create --spec` block:

```json
{ "type": "equation", "latex": "\\frac{a^2+b^2}{c^2}" }
```

Supported: fractions, superscripts, subscripts, roots, sums, Greek letters and common operators. The command reports `equations` and `equation_fallbacks`. A non-zero `equation_fallbacks` means the expression was emitted as italic text: check the counter, then simplify the LaTeX.

Displayed equations belong in their own paragraph. Inline maths is ordinary runs plus OMML, harder to place and easy to break.

## Check the contents

```bash
"<python>" "<cli>" docx read --input "<file.docx>"
"<python>" "<skill>/scripts/docx_kit.py" xml '<file.docx>' word/document.xml | grep -c "oMath"
```

`oMath` in the XML is the honest test; lookalike italic Times text is not an equation.

## When the converter cannot express it

- Build the OMML by hand for that construct.
- Split the expression: a matrix or piecewise definition is often clearer as a small table.
- Otherwise render it as an image with a caption and tell the user it is no longer editable.

The runtime ships `latex2mathml` and `mathml2omml`, so a custom snippet can produce OMML:

```python
from latex2mathml.converter import convert
from mathml2omml import convert as to_omml
print(convert(r"\sum_{i=1}^{n} x_i")[:200])
```

## Verify

Render: fractions stacked, limits above and below, Greek glyphs instead of boxes, nothing clipped at the right margin. A fallback shows as italic Latin text.

## Pitfalls

- An equation in a table cell or caption is legal but usually wrong.
- Copying OMML between documents is safe; copying a picture is not.
- Numeric labels belong in the text (`(3)` right-aligned) if the user will renumber.
