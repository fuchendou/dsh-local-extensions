# Healthcare

Health organisations run two workbook kinds:

- **Clinical and patient records** — appointments, encounters, observations, results. The
  clinical system is the source of truth; a workbook holds an extract.
- **Administrative and financial work** — budgets, staffing, throughput, cost per case. Money
  follows `financial_models.md`, hospitals included.

Most tasks are the second kind built on the first. Keep extract and analysis visibly apart.

## Handling the raw extract

- Keep raw data untouched on its own sheet or block, as one table; compute beside it or in a
  separate prepared block. Never overwrite a measurement.
- Name descriptively: `Appointments_RawData` beats `Sheet2`; `Clinic KPI Dashboard` beats
  `Sheet5`.
- Keep the source's definitions with the data: period covered, extract date, source system,
  denominator. Length of stay, readmission rate and utilisation are meaningless without them,
  and systems define them differently.
- Preserve identifiers exactly (MRN formats vary); dates as dates, one format down the column.
- Units in the header (`Weight (kg)`, `Temperature (°C)`, `HbA1c (%)`, `Heart rate (bpm)`),
  never cell text — `"72 bpm"` strings cannot be averaged.

## Building on it

- Highlight fields staff must complete (amber fill); no unused placeholders.
- For a threshold-driven flag, name one cell (`BMI_threshold`) and reference it, so the
  cut-off is visible and changeable.
- Flags only from a stated source or protocol threshold, with its severity (normal / elevated
  / high) and a sheet legend. Never invent clinical ranges; never round a borderline value
  into a category.
- Codebook (code → meaning, units, abbreviations) beside coded data; legend for
  abbreviations.
- `Corrected value` column or audit log; never edit the original measurement in place —
  original and correction are both evidence.

## Consequences of getting it wrong

Clinical arithmetic is not clinical judgement. Compute what the source supports; check a
critical calculation (dosing, risk score, threshold classification) against the authoritative
definition, and say when none exists rather than asserting the number. No clinical advice; a
screening flag is not a diagnosis.

## Doing it live

- The extract may be open with the user's formatting. Read first: `info` for sheets and used
  ranges; `read_range --formulas --display` for the block you will extend.
- Add derived columns right of the raw block with a clear header, or in a separate prepared
  area; never insert a column into an extract that formulas or a pivot reference.
- After writing, verify with `read_range --formulas` and check `errors` — a `#DIV/0!` in a
  rate column becomes a misread report.
