# Merge documents

Concatenating packages by hand fails: style ids collide, `numId` values point at the wrong lists, media parts need new names and relationships, `r:id` values are document-scoped, and Word requires one `sectPr` at the end of the body, so appended content must land before it.

## Append

```bash
"<python>" "<skill>/scripts/merge_docx_append.py" "<base.docx>" "<addition.docx>" --out "<merged.docx"
```

The script carries the body content minus the addition's final `sectPr`, renames media parts under `word/media` with fresh relationships and content types, copies style definitions referenced by the copied content (following `basedOn`/`next`/`link`), rebuilds numbering definitions with fresh ids and rewrites every `w:numId`, and recreates hyperlink relationships as external relationships.

Drawings are refused by default: a floating image or text box carries anchor geometry tied to its original page. Use `--allow_drawings` when the user accepts a possible layout shift, then check that page.

## Into a template

Apply the template first, then append, so content inherits the template's style ids:

```bash
"<python>" "<skill>/scripts/apply_template_styles.py" --template "<house.dotx>" --target "<draft.docx>" --out "<draft-styled.docx"
"<python>" "<skill>/scripts/merge_docx_append.py" "<draft-styled.docx>" "<section2.docx>" --out "<merged.docx"
"<python>" "<skill>/scripts/style_normalize.py" "<merged.docx>" --out "<merged-final.docx" --clear_paragraph_format
```

## Verify

Page count equals the sum of the inputs unless a page break changed. Headers and footers come from the base document — say so if the addition had its own. Render the join to catch a stray page break or a heading that lost its style. `style_lint.py` catches undefined style references imported from the addition.

## Pitfalls

- Footnotes and comments in the addition are not merged (the port is deliberate).
- Bookmark and comment `w:id` values can collide; the merge keeps ids and names.
- A landscape section in the addition is not carried over: section properties are dropped with the `sectPr`.
