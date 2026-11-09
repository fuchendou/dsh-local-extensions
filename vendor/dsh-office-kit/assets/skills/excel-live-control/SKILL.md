---
description: 'Drive a workbook that is already open in Excel or WPS Spreadsheets on Windows over COM: read cells, write values and formulas, style ranges, add charts and tables, recalculate, save, and report the exact ranges touched.'
---

# Live spreadsheets (Excel / WPS)

Windows only. Drives an open Excel or WPS Spreadsheets window through COM with Windows
PowerShell 5.1 (`Marshal.GetActiveObject`; PowerShell 7 dropped it). On macOS and Linux
every command exits `3` with `stage: "powershell"` and a remedy; use the file-based `xlsx`
verbs there.

## What "live" means here

The workbook is open and the user is watching. The disk file may lag the window, not exist
yet, or hold unsaved edits. A live call changes the open document; saving is a separate
decision.

- Address the open state, not a path: workbook name, sheet name, A1 range. Never "the
  active sheet" or "the selection".
- Nothing is transactional. A failed call leaves what landed. Read before retrying; never
  replay a half-applied batch.
- What the user sees matters, not the file on disk.

## Live or file editing?

| Situation | Route |
| --- | --- |
| The user says the file is open, or asks for "the sheet I'm looking at" | this skill |
| They want to watch cells change, iterate on a model, or add a chart to the visible sheet | this skill |
| Nothing is running, or the job is bulk/CI work, outlives the session, or is a question about a file | `../office-spreadsheets/SKILL.md` — edit the file, then tell them to reopen it |

Never force the live path. If nothing is running, say the workbook must be open, or switch
to the file route and say so. Do not launch an application.

## Before you touch anything

1. Call `office_status`. The runtime block in `../office-spreadsheets/SKILL.md` holds the
   verified paths: `python` runs these scripts, and its `skill` value is the
   office-spreadsheets directory, so this pack is `<skill>/../excel-live-control`. Quote every path.
2. Run `"<python>" "<skill>/container_tools/live_excel.py" --help` once per session.
3. Attach and look before writing:

   ```
   "<python>" "<skill>/container_tools/live_excel.py" info
   ```

   `info` lists open workbooks, the target workbook, its sheets, and per sheet the used
   range, charts, tables, pivots and protection.
4. Attach failure returns a `remediation` string. Relay it as written: open the workbook in
   Excel or WPS and keep it open, then retry. Never start an application for the user.
5. Several workbooks open: the tool refuses to guess. Pass `--workbook` with a file name
   (`Budget FY26.xlsx`) or an unambiguous path fragment.
6. Attach works but calls fail, or name and vendor disagree: run `--diagnose` for the
   attach mechanism, application, workbooks and sheets, with no mutation.

Attachment tries `Excel.Application` then `Ket.Application` (WPS). WPS registers
`Excel.Application` as an alias, so the app name proves nothing; `engine.vendor` comes from
`Application.Path`. COM object model: `references/office-automation.md`.

## The edit contract

Every mutating call must satisfy these.

- **Touch only what was asked for** — the named sheet and ranges.
- **Read before you write.** `read_range` the target: value, formula or merged fragment,
  and whether user edits are unsaved.
- **Never destroy structure you did not create**: formulas (never flatten to values), named
  ranges, conditional formats, shared formulas, data validation, pivots and sources, chart
  series, filters, hidden rows, freeze panes, protection.
- **Never clear more than you can name.** `write_range --clear` clears an explicit range's
  contents; charts, tables and formats survive. Never clear a used range to "start clean".
- **Batch small writes.** One call per logical block; rectangular only. A 6 × 2 range takes
  6 rows of 2 values.
- **Report exactly what you touched.** Every mutating op returns workbook name and path,
  sheet, address, row/column/cell counts and `warnings`. Quote it — "wrote
  `Assumptions!C4:D8` (10 cells)" — not "updated the assumptions".
- **Saving is separate and announced.** See Delivery.
- **No decorative edits without a request.** No restyling, whole-column autofit, or
  unrequested header row.

If a call fails partway, `read_range` the block and continue from what landed; retrying
the identical call duplicates rows and reverses edits.

## The tool

`"<skill>/container_tools/live_excel.py"` runs one command per operation, prints one JSON
object, and exits non-zero on failure. It shells out to `powershell.exe`; pywin32, comtypes
and Excel interop assemblies are neither used nor needed.

| Op | Does | Key options |
| --- | --- | --- |
| `info` | workbooks, target, sheet inventory | `--workbook` |
| `read_range` | typed values; optional formulas, display text | `--sheet --range`, `--formulas`, `--display`, `--max-cells` |
| `write_range` | a rectangular block of values | `--sheet --range --data`/`--data-file`, `--clear` |
| `set_formula` | one formula filled across a range, or a cell→formula map | `--range --formula`, or `--cells '{"C1":"=A1+B1"}'`/`--cells-file`, `--r1c1` |
| `style_range` | font, fill, number format, alignment, borders, width, merge | `--style` JSON or `--style-file`, `--merge` |
| `add_table` | native table (ListObject) over a range | `--name`, `--style TableStyleMedium2`, `--no-headers` |
| `add_chart` | embedded chart at an anchor, over a source range | `--type`, `--data`, `--anchor`, `--title`, `--width`, `--height` |
| `recalc` | `CalculateFull` on every open workbook | — |
| `save` | in place, or `SaveAs` a copy | `--path` |
| `close` | close the workbook, optionally quit the app | `--save`, `--discard`, `--quit-app` |

Global options on every op: `--workbook NAME|PATH`, `--timeout SECONDS` (default 180) and
`--launch-hidden` (**self-tests only** — a hidden app is wrong for user edits).

Style keys: `font_name`, `font_size`, `bold`, `italic`, `color`, `fill` (hex RGB, e.g.
`#FFF2CC`), `number_format`, `h_align` (`left|center|right|general|justify`), `v_align`
(`top|center|bottom`), `indent`, `wrap`, `column_width`, `border` (`outline|all|none`).
Unknown keys are rejected with the allowed list rather than silently dropped.

Chart types: `column`, `column-stacked`, `bar`, `bar-stacked`, `line`, `line-markers`,
`area`, `area-stacked`, `pie`, `doughnut`, `scatter`, `scatter-lines`.

Typical first calls:

```
"<python>" "<skill>/container_tools/live_excel.py" info
"<python>" "<skill>/container_tools/live_excel.py" read_range --sheet Build --range D5:D9 --formulas
"<python>" "<skill>/container_tools/live_excel.py" write_range --sheet Assumptions --range C4:D8 --data-file assumptions.json
"<python>" "<skill>/container_tools/live_excel.py" set_formula --sheet Build --range E5:E9 --formula "=D5*Assumptions!$C$4"
"<python>" "<skill>/container_tools/live_excel.py" style_range --sheet Assumptions --range C4:D8 --style '{"number_format":"#,##0","fill":"#FFF2CC"}'
```

Failures print `{"ok": false, "stage": "...", "error": "...", "remediation": "..."}` and
exit `1` (operation failure), `2` (usage) or `3` (PowerShell unavailable, timed out, or
non-Windows). Stages: `attach` (nothing running), `com` (application refused the call),
`timeout` (dialog or oversized batch), `powershell` (no usable PowerShell), `usage` (bad
arguments). Read the message before changing approach.

The CLI is the fast path, not the ceiling. For a COM call it does not wrap (a sheet tab,
freeze panes, a pivot, data validation, shape geometry), extend the script or drive the app
from a short PowerShell snippet, keeping the reporting and verification rules. Object
model: `references/office-automation.md`.

The tool does not create, rename, delete or reorder sheets; delete ranges or objects; run
macros; or open a file. Such a job asks the user for it, or uses the file route in
`../office-spreadsheets/SKILL.md`.

## Verification

After every batch, in order, before reporting done:

1. **Read it back.** `read_range` every range you wrote, `--formulas` when you wrote
   formulas; compare cell by cell.
2. **No error cells.** `errors` lists every live error cell (`#DIV/0!`, `#VALUE!`, `#REF!`,
   `#NAME?`, `#N/A`, …) with formula and address. An edit that leaves an error is
   unfinished. Report a pre-existing error; do not silently fix it.
3. **Numbers.** `recalc` after formula changes, then re-read. An uncalculated formula tells
   you nothing.
4. **Objects.** After adding a table or chart, `info` confirms it in the sheet inventory;
   `add_chart`'s `source` confirms the source range.
5. **Appearance.** You cannot screenshot the user's window. `--display` shows up to 500
   cells of rendered text and catches `###`, applied number formats and stray `#`; use it
   when formatting matters. Otherwise the visual check is the user's — ask them to confirm.
6. **Structure.** `info` after the edit proves pre-existing tables, pivots and charts
   survive.
7. **Report.** Workbook, sheet, every range, cell counts.

## Delivery

The workbook is the user's document; state what you did and its state. Never save quietly.

- **Default: modified and unsaved.** Say so, and that Ctrl+S keeps it. Never overwrite a
  file they were editing by hand.
- **They asked to save**: `save` with no `--path` overwrites the workbook's file. Say
  "saved `Budget FY26.xlsx`" with the full path from the reply.
- **Unsaved workbook, or an artifact is wanted**: `save --path <copy>.xlsx` writes a copy
  and leaves the original dirty. `present` that copy.
- **`.xlsx` in chat**: a path alone is not delivery. `present` a saved file; state both
  paths when original and copy differ.
- **Never** save over the user's file "to make sure" without telling them, and never close
  their workbook. `close --quit-app` is for self-test cleanup, not the user's desktop.
- If the edit failed partway, say exactly which ranges landed and offer to finish them or
  close without saving.

## What good content looks like

- **Structure by role, not tab count.** Inputs, assumptions, calculations, outputs. Outputs
  at the left of the tab strip, builds in the middle, inputs on the right; a terminal
  check/audit tab if the model needs one. Do not restructure a workbook the user already
  organised — `workflows/edit_workflows.md`.
- **Formulas a reviewer can audit.** Anchored references (`$B$3`, `C$4`, `$A8`),
  `SUMIFS`/`COUNTIFS`/`AVERAGEIFS` over hand-rolled sums, short `IF`, no blanket
  `IFERROR(...,0)` (`#VALUE!` is information), no `LET`/`LAMBDA`/spill arrays.
  `workflows/create_workflows.md` and `references/office-automation.md` explain what COM
  stores when you write these.
- **Typed values.** Numbers as numbers, dates as dates, one number format per column.
  Invariant format codes (`#,##0`, `0.0%`, `"$"#,##0.00`) — never swap `.` and `,`.
- **Reading someone else's workbook is read-only.** `references/read_only_qna.md`.
- **Domain conventions** — finance, healthcare, marketing, scientific data — read the
  matching `domain_guidance/` file before modelling.
- **Visual defaults** (headers, input fills, borders, tab colours, one font family):
  `style_guidelines.md`.
- **Citations** for external data go next to the input table they support, not in a tab of
  their own.

## Files in this skill

| File | Use it when |
| --- | --- |
| `references/office-automation.md` | COM object model: addressing, `Value2` vs `Formula`, colour, locale, latency |
| `references/read_only_qna.md` | answering a question without changing the workbook |
| `style_guidelines.md` | the request involves how the sheet looks |
| `workflows/create_workflows.md` | building a new sheet or workbook live |
| `workflows/edit_workflows.md` | changing cells in a workbook the user already built |
| `domain_guidance/*.md` | the model is financial, clinical, marketing, or research data |
