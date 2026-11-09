# Style guidelines

Precedence: the user's request, then the workbook or template being edited, then a domain convention, then these defaults. Defaults apply to new sheets, or to restyling the user asked for — never to a sheet you were not asked to touch.

## Page furniture

- One blank row at the top, then a short unfilled title, left aligned, in a size clearly larger than the body. No full-width filled banner.
- A thin rule under the title separates it from the table; nothing else.
- Notes sit in ordinary cells to the right of the data, at least one blank column away from the last header fill, with wrap off.
- No footer blocks, no "Prepared by" furniture, no date stamps nobody asked for.
- Gridlines off on new sheets. Do not change gridlines on a sheet you are editing for another reason.

## Structure

- Freeze the header row of any table that scrolls, plus the identifying column(s) when horizontal scrolling hides them. Freeze the smallest useful area and never move content to make freezing convenient.
- Header row: bold, centred horizontally and vertically, dark fill with white text or a light grey band, thin white separators between header cells.
- Section bands: one continuous fill with a single outline around the block; no internal borders inside the band, no full-cell grid.
- Spacer columns are genuinely empty (no values, no borders), not narrow columns of spaces.
- Keep working titles, headers, and input areas unmerged. Center Across Selection gives the look of a merge without breaking sorting, filtering, and references.

## Numbers, inputs, calcs

- Typed values with explicit number formats — see `recipes/number-formats.md`.
- Left-align text, right-align numbers, centre headers, middle-align vertically; top-align long wrapped descriptions.
- Distinguish inputs from calculations consistently: inputs get a light fill or a colour cue the sheet already uses, calculations stay white. Yellow/amber marks an input that still needs updating; keep that cue separate from calculated warnings.
- When cases exist, show `Case Selected:` plus the linked value near the top of each output and build tab, in a restrained dashed outline, and highlight the active row in the driver table.
- Technical helper rows above a model are italic and grouped/collapsed.

## Conditional formatting as a cue

- Bound the rule to the data, and use it for status, risk, variance, and exceptions — not decoration.
- Critical errors: light red fill, bold dark red text. Valid checks stay neutral; no static green "PASS" paint over a range.
- Reuse the sheet's existing rule style before inventing a new colour. Two similar reds in one workbook look like two different severities.

## Typography

- One family across the workbook: Helvetica Neue, Helvetica, Arial, then Aptos.
- Two sizes at most (three counting the title). Largest size no more than six points above body. A 10pt body with an 11pt header and a 14pt title is enough.
- Bold for headers and totals, italic for short context notes — never both on the same line, never on every row.
- Tighten row heights after content fits; do not shrink the font to win an argument with a column width.

## Tab colours

Use colour only to help navigation: a darker brand tone on output tabs, one level lighter on assumptions, a distinct muted tone on a ReadMe, a divider tab coloured while its children stay plain. Financial Actuals tabs are traditionally light tan. Never recolour tabs during an unrelated edit.
