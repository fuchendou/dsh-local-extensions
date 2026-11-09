# The COM object model behind a live edit

The target is an out-of-process COM server that owns a window. Each property read or write
is a remote call; each object is a proxy that re-reads state. That explains most rules here.

`container_tools/live_excel.py` wraps the common cases. Read this when the CLI has no verb
for the task, a failure is unexplained, or you extend the tool.

## Reaching the running instance

```powershell
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
```

- The only supported way to find a running instance. `New-Object -ComObject
  Excel.Application` creates a new invisible one; never use it for user work.
- Only in Windows PowerShell 5.1 (`powershell.exe`); PowerShell 7 (`pwsh`) removed it,
  which is why the tool shells out to `powershell.exe`.
- Nothing running raises `0x800401E3 (MK_E_UNAVAILABLE)`. Ask the user to open the
  workbook; launch nothing.
- WPS registers `Ket.Application` and `Excel.Application`, so attaching does not prove
  Microsoft Excel. `Application.Name`/`Version` are useless here (WPS reports `Microsoft
  Excel` / `12.0`). Infer the product from `Application.Path`.
- The running-object table is per user session and outlives the creating process. A hidden
  self-test instance stays attachable, invisible until shown, and leaks until
  `Application.Quit()`.

## Addressing

`Application` → `Workbooks` → `Workbook` → `Sheets` → `Worksheet` → `Range`.

- Collections are **1-based**: `$book.Sheets.Item(1)`. `Item(0)` throws.
- `$sheet.Cells` is the whole sheet; `$sheet.UsedRange` is the rectangle holding content or
  formatting. Clearing the last cell does not shrink it: a read hint, never an edit
  boundary.
- A1 strings: `A1`, `B4:D9`, `$B$14`, `Sheet1!A1:C9`, `'Build Detail'!E14` (quote names
  with spaces). `$r.Address(0,0)` gives `A1:C3`; report the absolute form the user can
  paste into the Name Box.
- Sheet-name matching is case-insensitive in .NET but exact for COM:
  `$book.Sheets.Item('Build')` throws on `build`. Use `Worksheet.Name` for spelling.
- Multi-area ranges (`A1:A5,C1:C5`) exist; the tool refuses them for writes because one
  rectangular `Value2` assignment cannot fill them.

## Cells: what you write and what comes back

| Property | Use it for | Reads back |
| --- | --- | --- |
| `Range.Value2` | every value: numbers, text, dates (as serials), booleans, arrays | typed scalars / `Object[,]` |
| `Range.Formula` | formulas in A1 notation; also how to read them back | `String`, e.g. `=SUM(B2:B9)` |
| `Range.FormulaR1C1` | fills where you think in offsets | `String` |
| `Range.Text` | the displayed string, after number format | per-cell only |

- **`Value2` preserves type and ignores locale.** A `Double` stays a number, a `String`
  stays text — unless the app parses it as a date, currency, or `=1+1`. `"2026-01-31"`
  written through `Value2` produced serial `46053` in a date-formatted cell. For literal
  text, store the serial/number and set a number format, or prefix the apostrophe. Never
  rely on the parse.
- **`$null` empties a cell**, the supported way to clear one value inside a written block.
- A multi-cell read returns a 2-D `Object[,]` with **1-based** indices; a single cell
  returns a scalar, so code that always indexes `[1,1]` fails on one-cell ranges.
- **Errors are integers.** `#DIV/0!` is Int32 SCODE `-2146826281`; `#VALUE!` `-2146826273`,
  `#REF!` `-2146826265`, `#NAME?` `-2146826259`, `#NUM!` `-2146826252`, `#N/A`
  `-2146826246`. WPS returns `False` from `WorksheetFunction.IsError` and throws on
  `SpecialCells(16)`, so test "is this an Int32?", then read `Range.Text`,
  `Range.Formula`, `Range.Address(0,0)` for that cell alone.
- `Range.Text` is per-cell; on a multi-cell range WPS returns `DBNull`, so the tool reads
  cell by cell (hence the `--display` cap).
- **One formula assigned to a range fills with relative adjustment**: `A1:A3` = `=B1`
  gives `=B1`, `=B2`, `=B3`. Cheap for a column, and how unintended formulas appear on
  multi-cell targets.
- Dates are serials (`days since 1899-12-30`, 1900 system). `DateSerial(y,m,d)` gives the
  number; `NumberFormat` gives the look.
- Formulas are text. Nothing calculates on write; values update on recalc, which is why
  `recalc` exists.

## Number formats

`Range.NumberFormat` takes codes, not locales: `#,##0`, `#,##0.00`, `0.0%`, `"$"#,##0.00`,
`mmm-yy`, `d-mmm`, `@`. Use invariant ASCII; the dot is always the decimal point inside a
code, whatever `Application.DecimalSeparator` says. WPS returns empty
`DecimalSeparator`/`ThousandsSeparator`: never read locale from the app or build codes from
locale data.

- Format is display only; values keep full precision. Never round data to make it read
  right.
- One format per column; mixing `#,##0` and `#,##0.00` down a column is the commonest
  visual defect.
- Precision belongs in the code: `0.0%` for analytical tables, `0%` for dashboards,
  `0.00%` when differences are small.
- `###` means too narrow, not wrong. Widen with `ColumnWidth` (default ~8.43) or
  `EntireColumn.AutoFit()`, then check with `--display`.

## Colour is BGR

`Interior.Color` and `Font.Color` are OLE longs `0xBBGGRR`; specs are `#RRGGBB`:

```
ole = red + green * 256 + blue * 65536        # #RRGGBB -> BGR long
```

`#C00000` becomes `192`; pure blue fill is `16711680`. `ColorIndex = -4142` removes a fill
(`Interior.Color` then reads `16777215`). Theme colours and tints are not addressable;
reuse existing workbook colours.

## Font, borders, alignment, layout

- `Range.Font`: `Name`, `Size`, `Bold`, `Italic`, `Color`, `Underline`, `Strikethrough`.
  One family per sheet: Helvetica Neue → Helvetica → Arial → Aptos, whichever the workbook
  uses.
- `Range.Borders.Item(index)`: 7 left, 8 top, 9 bottom, 10 right; `LineStyle` (1
  continuous), `Weight` (2 thin), `Color`. `BorderAround(1, 2)` draws a thin outline in one
  call.
- `HorizontalAlignment` takes `xlHAlign*` (`-4131` left, `-4108` center, `-4152` right);
  `VerticalAlignment` takes `xlVAlign*` (`-4160` top, `-4108` center, `-4104` bottom). The
  tool maps readable names.
- Also: `Merge()`, `UnMerge()`, `WrapText`, `IndentLevel`, `EntireColumn.ColumnWidth`,
  `Tab.Color`, `Rows.Hidden`.
- `FreezePanes` lives on `Window` and did not stick on a hidden WPS instance. No freeze
  verb: tell the user, or do it visibly.
- Whole-sheet `AutoFit` and `Select`/`Activate` change the user's view, can take seconds,
  and `ScreenUpdating` does not hide the flicker.

## Objects beside the cells

- **Tables**: `$sheet.ListObjects.Add(1, $range, [Type]::Missing, $has_headers)`.
  PowerShell cannot reproduce VBA's empty argument positions, so pass `[Type]::Missing` for
  `Destination`. Tables get localized default names (`表1`); name them. `has_headers = 0`
  makes the app generate a header row above the data, shifting values down and making the
  table one row taller than the range. Extend with `ListObject.Resize`, never a second
  table.
- **Charts**: `$sheet.ChartObjects().Add(left, top, width, height)` → `.Chart` →
  `.SetSourceData($range)` + `.ChartType`; `HasTitle`/`ChartTitle.Text` set the title.
  Types: column 51, stacked column 52, bar 57, stacked bar 58, line 4, line with markers
  65, area 1, stacked area 76, pie 5, doughnut -4120, scatter -4169, scatter with lines 74.
  A chart over an empty range renders blank; check the source cells.
- **Shapes**: `Shapes.AddShape(...)`, `AddTextbox`, `AddPicture`. They float over cells, sit
  outside the used range, and need `TopLeftCell` anchoring to move with data.
- **Pivots**: `PivotTables`, `PivotFields`. Read and report; never rebuild through COM
  unless asked — a failed attempt loses the layout.
- **Names**: `$workbook.Names`, `Range.Name`. Deleting their cells breaks names (`#REF!`),
  so a rename or row delete is a contract change.
- **Conditional formats**: `Range.FormatConditions`. Appending to a range with an existing
  condition edits that set; read first, keep the range bounded.
- **Validation**: `Range.Validation`; read the existing rule before writing.

## Calculation and freshness

- `Application.Calculation`: `-4105` automatic, `-4135` manual. Manual mode shows stale
  numbers after an edit; `recalc` runs `CalculateFull` on every open workbook and reports
  the mode.
- `CalculateFull` recalculates dependencies, not just the active sheet.
  `CalculateFullRebuild` rebuilds the tree; use it only when a value looks impossible — it
  is slow on large models.
- Iteration (`Application.Iteration`) is off by default. Circular references that "worked"
  mean it was on; do not enable it to make an edit succeed.

## Latency, failures, retries

- Every property access is an RPC. `info` plus three reads took 1.2–1.5 s here; formatting
  100 cells one at a time can take tens of seconds. **Batch**: one `write_range` per block,
  one `style_range` per range, one `set_formula` per column. Never loop per cell.
- Default timeout is 180 s. Raising it is fine for a big paste; below 1 s fails on a busy
  app.
- Failures you meet:
  - `0x800401E3` — nothing running. Ask the user to open the workbook.
  - `0x8001010A` (RPC_E_SERVERCALL_RETRYLATER) — app busy (dialog, recalculation, dragged
    window). Read again; if it persists, tell the user a dialog is blocking it.
  - "Object required" / stale proxy — usually the workbook was closed. Re-attach by name;
    never reuse the old object.
  - An Excel method raising "does not contain a method named …" in WPS: the WPS model is a
    subset. Fall back to a simpler route (formatting via `Value2`/`NumberFormat`).
- **Nothing is transactional.** A half-failing call leaves written cells. Retry:
  `read_range` the block, compare with intent, write only what is missing or wrong.
  Replaying a batch duplicates rows.

## The one rule that outranks the rest

A live edit mutates a document the user is looking at, possibly with unsaved changes.
**Read and diff before writing.** `read_range` the target with `--formulas`; note
`saved: false` from `info`; then make the smallest write that satisfies the request. If the
diff shows unexpected values, stop and ask — unsaved user work outranks finishing the task.
