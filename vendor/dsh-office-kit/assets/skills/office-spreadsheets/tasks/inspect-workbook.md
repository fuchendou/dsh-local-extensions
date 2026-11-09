# Inspect a workbook

Two readers, different jobs:

- `"<python>" "<cli>" xlsx read --input "<book.xlsx>" [--data-only]` — cell values per sheet, as arrays without coordinates. `--data-only` returns cached results instead of formula text.
- `"<python>" "<skill>/container_tools/inspect_workbook.py" --input "<book.xlsx>"` — the structure around the cells: the formats that govern how they read, the objects beside them, and whether the formulas were ever computed.

Run both before editing, and again after to prove nothing was lost.

## What the inspector reports

| Field | Reading it |
| --- | --- |
| `workbook.sheets`, `active_sheet` | Tab order and what opens first; order carries meaning (outputs lead) |
| `workbook.defined_names` | `name`, `refers_to`, `scope` (`workbook` or a sheet), `hidden`. A broken `refers_to` (`#REF!`) breaks every formula using the name |
| `workbook.calc_mode`, `full_calc_on_load`, `date_system` | `manual` calc mode means saved values can be stale; `1904` date system shifts every date by four years |
| `container.*` | Counts of tables, pivot tables/caches, charts, drawings, images, comment parts, external links, VBA, shared strings — the objects a rewrite can silently drop |
| `sheets[].dimensions`, `max_row`, `max_column` | The used range: what the file *thinks* has content, including formatting far from the data |
| `sheets[].print_area`, `freeze_panes`, `gridlines` | Layout choices a render will honour |
| `sheets[].merged` | Merged ranges; a value lives in the top-left cell only |
| `sheets[].tables` | Excel Table names and refs; rows appended below a `ref` land outside the table |
| `sheets[].charts[].anchor`, `.kind`, `.series` | Where a chart sits and what it plots; an `anchor` outside `print_area` is cut off when printed |
| `sheets[].conditional_formats[].rules` | `type` (`cellIs`, `colorScale`, `dataBar`, `expression`), `operator`, `formula`, `priority`. A rule whose range stops short of new rows silently stops applying |
| `sheets[].data_validations` | Dropdowns and constraints an edit must preserve |
| `sheets[].hidden_rows`, `hidden_columns` | Content the user deliberately folded away |
| `sheets[].formulas.shared`, `.array`, `.data_tables` | Non-trivial formula storage; re-saving can materialise or drop these |
| `sheets[].values.cached`, `.missing`, `.errors` | How many formula cells carry a cached result, carry none, or carry an error value |

`--no-values` skips the second load that reads cached results (faster on big files, blind to whether formulas ever computed). `--sample N` sets how many formula samples per sheet are printed (default 5).

## How to read it

- `values.missing` equal to `formulas.count` means nothing has ever calculated this file. Do not quote any formula result; recalculate first (`tasks/recalc-and-check.md`).
- `values.errors` non-empty is pre-existing damage (or a deliberate `#N/A` sentinel). Report it; do not fix it unasked.
- `container.pivot_tables > 0` or `has_vba_project: true` means a plain openpyxl rewrite is risky: back up, change the fewest cells possible, re-inspect after saving.
- `formulas.shared > 0` means a spreadsheet app wrote the file; copy an existing formula down rather than inventing a new pattern.
- A huge `dimensions` with few real cells is a formatting artefact (fill applied to whole columns). Do not "clean" it; note it if the user asks why the file is slow.
- `print_area` and chart `anchor` explain most render surprises: charts clipped at the page edge, or whole data blocks missing from a PDF because they fall outside the print range.
