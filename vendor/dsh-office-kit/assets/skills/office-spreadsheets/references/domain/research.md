# Scientific and research data

The spreadsheet is usually a working copy of measurements, not the record of truth. Keep it that way: never edit raw measurements in place, and never let a formatted view replace the values behind it.

- Raw data on its own sheet, untouched, in columns whose headers carry the unit (`time (s)`, `temp (C)`, `conc (mg/L)`). Derived columns live on a build sheet and reference the raw cells.
- One row per observation, one column per variable. Do not encode a variable in a colour, a note, or a header font.
- Replicates are separate rows with a replicate id and a group id; mean and standard deviation are formulas over those rows, never typed.
- Keep the precision the instrument gives you and let the format hide extra decimals. Rounding stored values destroys the ability to recompute a mean.
- State uncertainty, detection limits, and excluded points in labelled cells. An excluded point stays in the data with a reason column — deleting it hides the decision.
- Smoothing, binning, and unit conversion are formulas with visible inputs, or they do not exist. A trend line drawn over noisy points is not an analysis.
- Distribution, trend, and relationship: choose the chart by the question, and check that axis ranges and bins are stated (`references/charts.md`).
