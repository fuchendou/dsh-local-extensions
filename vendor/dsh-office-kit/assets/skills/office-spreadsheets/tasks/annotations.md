# Resolve an `office-annotations` region to cells

The user drags a box on the rendered workbook and types a requirement. The payload for spreadsheets is:

```json
{
  "target": "book.xlsx",
  "fileName": "book.xlsx",
  "text": "",
  "requirement": "make this column currency",
  "region": { "left": 0.42, "top": 0.51, "width": 0.18, "height": 0.30 },
  "imageName": "book-page-1.png",
  "unmapped": true
}
```

There is no `page`, no `sheet`, and no `range`: the preview client cannot turn a pixel rectangle into a cell address and will not fake one. Read it as "look at this area of this sheet and do this", not as a cell reference.

## Procedure

1. `read_image` the attachment named `imageName`. It is the screenshot of the area the user marked: read the visible headers, row labels, and the numbers around the box.
2. `"<python>" "<cli>" xlsx read --input "<book.xlsx>" --json-out "<dump>.json"`, then match the visible values to sheets and A1 addresses. Values repeat across sheets more often than you expect — match on a combination (a row label plus two numbers), not on one number.
3. When the numbers are ambiguous, `container_tools/inspect_workbook.py` adds formulas, merges, tables, and names; formats often disambiguate ("the only column with a `%` format").
4. State what you resolved, in the user's terms: "`Pipeline!D2:D13`, the Amount column — 12 rows of whole dollars". Ask only if two sheets or two columns match equally well.
5. Apply the smallest change that satisfies `requirement` with the mutation tools (`tasks/edit-workbook.md`), re-render, and confirm the region now looks right.

## What not to do

- Do not compute a cell from the rectangle's coordinates. Header width, frozen panes, hidden columns, and zoom all move cells under the same pixel.
- Do not edit the first sheet because it was the default. The visible page may be the fourth sheet.
- Do not re-style the whole sheet to make the marked area consistent. Match the surrounding convention and change the cells the requirement names.
- If the region covers a chart or a picture, the change is to the object, not the cells behind it — check `charts`/`images` in the inspect output first.
- If nothing on the page carries the values in the screenshot, say which image you looked at and what you could not locate. Do not guess a sheet.
