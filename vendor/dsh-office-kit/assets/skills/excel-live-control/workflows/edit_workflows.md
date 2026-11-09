# Editing a workbook the user already built

The existing workbook is the reference. Keep its structure, formula style, formats, labels
and navigation; make one change that looks native.

## Read the ground first

Cheap, and nothing below works without it:

1. `info` — workbook name/path, `saved` flag (unsaved work!), sheets, used ranges, tables,
   charts, pivots, protection.
2. `read_range --formulas` over the target block **and its neighbours**. Know the formula
   pattern before extending it.
3. `read_range --display` when changing formatting: it shows the format's effect, not the
   stored value.
4. Read the surrounding labels: period, unit, actual/forecast. Match the convention.

If the block holds values you cannot explain from the request, stop and ask.

## Rules of the edit

- **Change the cells the request names and the formulas those cells feed.** A changed input
  propagates; do not hand-edit downstream totals.
- **Do not add, remove, rename, reorder or split sheets** unless requested, or the change
  cannot otherwise be expressed (a new output with no home).
- **Preserve everything you did not create**: other sheets, formulas, named ranges,
  comments, protection, hidden/grouped rows, user freeze panes, native tables and their
  structured references, pivot sources, shared formulas, filters, external links,
  `INDIRECT` routing, calculation settings.
- **Never flatten formulas to values** — not to "simplify", not to "fix" a display problem.
- **Extend, do not replace.** A row or column added under a table, conditional format or
  chart extends that object (`ListObject.Resize`, `SetSourceData`), never a parallel one.
- **Keep visual fixes local.** Widen the one clipped column. No sheet-wide autofit, no
  restyle because it is not your default.
- **Match formula conventions**: anchoring style, `SUMIFS` vs `SUMPRODUCT`, rounding, error
  handling. A "better" formula that reads differently costs maintenance.
- **Pre-existing errors are not yours to fix.** Report the cell, its formula and ask;
  silently repairing `#REF!` can change a number the user relies on.

## Doing it

```
read_range --sheet "Build" --range D5:F12 --formulas     # understand the pattern
write_range --sheet "Build" --range D13:F13 --data '[...]'   # the new row only
set_formula --sheet "Build" --range G5:G13 --formula "=SUM(D5:F5)"
style_range  --sheet "Build" --range D13:F13 --style '{"number_format":"#,##0"}'
recalc
read_range --sheet "Build" --range D5:G13 --formulas     # prove it
```

- Keep writes to the named rectangle. `--clear` only a range whose contents you have read
  and can restore.
- Copy style codes from the neighbouring block: read a matching cell, mirror its
  `number_format`, apply to the new cells. Do not invent a format for one row.
- A formula that must differ from the pattern (different anchor, one-off): say why in the
  reply.

## When you are done

- `read_range --formulas` over every changed cell and its neighbours.
- `recalc` after formulas, then re-read dependents.
- `info` if tables, charts or pivots were extended, to confirm coverage of the new cells.
- Report sheet, exact ranges, cell counts and saved state. If the formula graph changed,
  name the affected outputs.
