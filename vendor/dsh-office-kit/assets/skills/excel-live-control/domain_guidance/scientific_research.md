# Scientific research data

The spreadsheet is often the only record of an experiment. Treat observations as
irreplaceable: a cleaned value that overwrote a raw measurement is data loss, and a live edit
is one keystroke away.

## Keep the raw table raw

- One flat table: one row per observation, one variable per column, one unit per column. No
  merged cells, no multi-row headers, no calculation rows inside the data block.
- Never overwrite a measurement. Transformations go in separate columns (headed `log10(x)`,
  `normalised`) or a separate processed block or sheet.
- Record the cleaning: rows excluded and why, values imputed, units converted — in a protocol
  note on or beside the sheet.
- Missing observations stay visibly missing (blank or `n.a.`, per the table's convention);
  never zero-fill silently. Label randomised and simulated values as such — they are not
  observations.

## Presentation tables are a different object

When the sheet reports the data rather than holding it:

- One type of data per column; units in the header (`Concentration (mg/L)`), never in the cell.
- Never encode meaning only in colour or bold — add a labelled value column (`Flag:
  excluded`, `Status: control`). A monochrome printout must still carry the meaning.
- Notes belong in a notes column, not in cell comments a co-author will never see.
- No merged cells in a table anyone will sort or filter.

## Analysis

- A transparent formula beats a clever one; someone must defend the number in review six
  months from now.
- Show the steps: intermediate columns are the evidence; one formula makes the result
  unfalsifiable.
- Circular references and iterative calculation are off-limits unless the user asks and
  documents it. A simulation's random seed and method are part of the result.
- Distinguish measurement, derived value, flag and assumption by label, not by font colour
  alone.
- If the design changes (exclusion added, normalisation changed), say so in the reply. A
  quiet denominator change rewrites the conclusion.

## Doing it live

- Before touching anything: `info`, then `read_range --formulas --display` on the block.
  Raw data and report blocks usually sit on different sheets; confirm which is which.
- Append observations as bottom rows, extend any table object to cover them, leave the header
  row untouched.
- Verify with `read_range --formulas`; the `errors` array catches the `#DIV/0!` and `#VALUE!`
  that appear when text lands in a numeric column.
- Never delete rows from the middle of a data table; a delete shifts every downstream formula
  and chart range.
