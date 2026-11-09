# Creating content in a live workbook

The user sees every step. Plan on paper first, then write in a few batches.

## 1. Decide what is being created

Answer these before writing a cell:

- **Who reads it, and what decision does it support?** A committee summary and an analyst's
  working model are different sheets.
- **What are the outputs?** Name each one: a number with a label, a period and a unit.
- **What are the inputs?** Name them with their sources. Inputs nobody updates are
  decoration.
- **What is calculated in between?** A reviewer audits these steps; if you cannot name them,
  the model is not designed yet.
- **What would make it wrong?** At least one check: totals tie, parts sum to the whole, cash
  ends at the right balance.

If two are still open, ask one short question — a live edit is expensive to unpick.

## 2. Where it goes

- Organise by role, not tab count: inputs, assumptions, calculations, outputs. Small sheets
  merge roles; large models separate them.
- Outputs left of the tab strip, workings middle, inputs right; a check/audit tab last if
  warranted.
- No separate Checks tab on a simple sheet — a labelled verification row is enough.
- Keep inputs beside their calculations; use a dedicated input sheet once several sheets
  consume them.
- Calculate once, link everywhere else. Two cells computing the same number is a future
  disagreement.
- Put insights next to the result they explain, never in a separate area.

**This skill cannot add a tab** — it writes into existing sheets. Ask the user to insert one
(right-click a tab → Insert), or use the file route in `../../office-spreadsheets/SKILL.md`
and tell them to reopen. Never repurpose a sheet as scratch space.

## 3. Write it

```
info                                             # confirm workbook, sheet, used range
write_range --sheet "Inputs" --range B4:C9 --data-file inputs.json
set_formula --sheet "Inputs" --range D4:D9 --formula "=B4*C4"   # fills down with relative rows
style_range --sheet "Inputs" --range B3:D3 --style '{"bold":true,"border":"outline"}'
recalc
read_range --sheet "Inputs" --range B3:D9 --formulas
```

- One `write_range` per block, in its real shape (rows × columns). No empty-string padding;
  use `null` for an empty cell.
- Write labels and units with the numbers. Bare numbers are not done.
- Apply `number_format` in one `style_range` over the block, not cell by cell.
- Formulas start with `=`: absolute where fixed (`$C$4`), relative where the fill walks
  (`D5`). Test one cell before filling.
- If the sheet has content, check the used range and write beside it, not over it.

## 4. Check it, then say what you did

- `read_range --formulas` over everything written; `errors` must be empty.
- `recalc`, then re-read the outputs — an uncalculated formula proves nothing.
- `info` after adding tables or charts, to confirm the target sheet.
- Report the ranges and document state (unsaved, or saved where). See Delivery in
  `../SKILL.md`.

## 5. Sizing and layout

- Set widths after content, sized to the widest formatted value; check `###` with
  `--display`.
- Wrap long labels instead of widening a column to half the screen.
- Give helper calculations their own labelled block or sheet, never a row buried between
  outputs.
