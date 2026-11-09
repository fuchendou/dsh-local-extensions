# Style guidelines for a live sheet

Style is subordinate to content and the user's file. Precedence, strongest first:

1. What the user asked for in this conversation.
2. The workbook's existing conventions — fonts, colours, borders, tab colours, number
   formats. Match them; do not impose a house style on someone else's document.
3. The domain guidance for the model (`domain_guidance/`).
4. The defaults below.

Look before you paint: `info` for tab colours and structure, `read_range` for neighbouring
formats. Restyling because your defaults are tidier is a defect, not a service.

## Defaults that are safe anywhere

- **Font**: one family per workbook. If it has none, Helvetica Neue → Helvetica → Arial →
  Aptos. Two sizes: 10 pt body, 14 pt title, 16 pt ceiling. Never a third family or a
  decorative size.
- **Alignment**: text left, numbers right, headers centred horizontally and middle
  vertically. Never centre numbers — they lose decimal alignment.
- **Headers**: bold, one rule under the last header row (`border: "outline"` on the header
  block, or a bottom border on the row). No merged cells in working headers; merge only a
  single spanning title, preferring Center Across Selection.
- **Inputs vs calculations**: cells the user types into get a light fill (`#FFF2CC` amber)
  and thin border; calculated cells stay plain. If the whole block is inputs, one header
  note beats painting every cell.
- **Gridlines**: a clean output or dashboard hides them
  (`ActiveWindow.DisplayGridlines = $false`, a view setting, not a cell format) and uses
  thin structural borders; a working sheet keeps them.
- **Borders**: outline a block, hairline between header and body. No box around every cell,
  no double or thick decorative frames.
- **Column widths**: once per block (`column_width` in `style_range`), not per cell; widen
  for the formatted value, then check `###` with `read_range --display`.
- **Conditional formatting**: bounded to the data range, one or two rules; never a whole
  column, never paint a user input cell.
- **Freeze panes** are a view setting, not styling. The tool cannot set them on a hidden
  window; if scrolling is the complaint, say so and let the user freeze the row.

## Model layouts

- Summary above detail, outputs before workings, assumptions grouped in one block. The
  top-left should explain the sheet.
- New output sheet: one blank row at the top, title in an unfilled left cell, thin rule
  under it. No logo, merged banner or slogan.
- Commentary goes right of the numbers, separated by one blank column; never between a
  label and its value.
- Helper rows: italic, grouped under their block, collapsed if the workbook already groups.
  Helper columns outside the print range or on a separate helper sheet.
- Scenario selector: a visible label plus a validated cell (`Case Selected:` and the value);
  never hidden in a defined name.
- Section bands: one outline around the whole section, not per row.
- Dark header fill with white text, or plain with a rule — one per workbook.

## Finance conventions

- **Colour = provenance**: blue font for hard-coded inputs, black for same-sheet formulas,
  green for links to another sheet, red for links to an external workbook. Output views
  stay black or brand dark.
- **Number formats**: `#,##0` amounts, `#,##0.00` per-share/price, `0.0%` rates,
  `#,##0;(#,##0);"-"` for accounting (parentheses for negatives, dash for zero). Currency
  symbol on the first monetary row and on totals, not every row.
- **Indent formats** (`  @` for text labels, `_(`-style spacing) map hierarchy without empty
  columns.
- **Totals** flush left in the label column, bold, rule above. A hard-number total instead
  of a formula is a finding.
- **Period labels** follow `mmm-yy`, `d-mmm`, `yyyy`, `Q#:YY`, `FY:YY` as the workbook does;
  one date format down a column.
- **Actuals vs forecast**: a visible change of basis (divide, fill, label), never colour
  alone.
- A needed gutter between row labels and numbers gets columns A:B reserved; do not retrofit
  one onto a sheet that lacks it.

## Warning colour, used sparingly

- Input that must be refreshed: amber fill (`#FFF2CC`), normal font.
- Critical error or failed check: light red fill (`#FFC7CE`) plus bold red text (`#9C0006`).
- Passing checks: neutral. A green wash over every PASS hides the one red row.
- Never encode meaning in colour alone; put the flag in a cell so a monochrome printout or
  colour-vision deficiency still reads it.
