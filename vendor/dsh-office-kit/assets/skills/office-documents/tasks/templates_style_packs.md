# Templates and style packs

A `.dotx` is a `.docx` whose package is a template: `styles.xml` defines the look, `numbering.xml` defines lists, the body is empty. What you need is the styles part, the numbering definitions they reference, and the theme. Copying the body imports placeholder text.

## Ask before guessing

Never invent a house style. Get heading fonts and sizes, body font and size, accent colour, margins, table style, and any logo or cover requirement. `references/template-elicitation.md` holds the question set.

## Apply

```bash
"<python>" "<skill>/scripts/apply_template_styles.py" --template "<house.dotx>" --target "<draft.docx>" --out "<draft-styled.docx"
```

Merges style definitions by `styleId` (replacing same-id, appending missing, taking the template's `docDefaults`) and copies `numbering.xml` with its relationship and content-type override. The target's body is untouched.

Then normalise so direct formatting does not override the imported styles:

```bash
"<python>" "<skill>/scripts/style_normalize.py" "<draft-styled.docx>" --out "<draft-final.docx" --clear_paragraph_format
```

## Restyle without a template

Set values on styles, not on runs:

```python
from docx import Document
from docx.shared import Pt, RGBColor

d = Document(r"<draft.docx>")
d.styles["Normal"].font.name = "Calibri"
d.styles["Normal"].font.size = Pt(11)
for level, size in ((1, 18), (2, 14), (3, 12)):
    style = d.styles[f"Heading {level}"]
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
d.save(r"<draft-restyled.docx>")
```

## Verify

Render and compare page by page with the template's own preview: heading sizes, body leading, margins, table borders. A style that looks right in the pane but wrong on the page usually has a leftover direct-formatting run — run the lint (`tasks/style_lint_normalize.md`).

## Pitfalls

- A template applied over content that references missing styles produces the fallback look, not an error; run `style_lint.py`.
- Themes (`word/theme/theme1.xml`) carry fonts and accent colours, so theme-font styles change with the theme.
- Keeping the template's `numbering.xml` without its abstractNum ids makes lists share one counter.
