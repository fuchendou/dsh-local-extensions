# Workbook structure

Tab roles describe what a sheet *does*, not what tabs a workbook must have. A simple workbook can carry several roles as labelled blocks on one sheet; a large one separates them because the readers, the refresh cadence, or the audit trail differ.

| Role | Holds | Feeds |
| --- | --- | --- |
| Input / Sources | Pasted exports, system extracts, unchanged source tables | Builds |
| Assumptions | Rates, drivers, the case selector, global inputs | Builds |
| Build | The visible calculation steps between inputs and outputs | Outputs |
| Output / Summary | Consolidated results, the numbers a reader came for | Nothing downstream |
| Check / Audit | Diagnostics that compare what should reconcile | Nothing — terminal and read-only |
| Cover / ReadMe | A short front page, or an explanation of method and joins | Nothing |

Rules that keep a workbook readable a year later:

- Inputs flow forward: source → build → output. A source tab never reads a downstream result back in; when it seems to, the value belongs on a build tab.
- Builds show the steps: quantity × rate, capacity used ÷ capacity available, opening + movements = closing. One dense formula that jumps from input to final number cannot be reviewed and will be wrong the first time an input changes.
- Outputs consolidate and roll up. They reference the calculation on the build tab; they do not repeat it.
- Checks are terminal. Nothing depends on a check tab, and a passing check stays neutral — a wall of green PASS fills trains the reader to ignore the one red cell that matters.
- Combine roles when the workbook is small. Three assumption cells do not need a Settings tab; a short labelled block beside the calculation is easier to audit.
- Add a tab when the reader differs, the data grain differs, the refresh boundary differs, or the user asks. Not because a template had one.

## Physical order

For multi-tab workbooks, left to right: outputs, the assumption control panel (usually just after the primary output so a reader sees the switch), builds, then inputs and sources, with a divider tab such as `Internal >>` guarding the tail. The reader gets the answer first; the machinery lives to the right.

Separate schedules when inputs, grain, or owners differ (revenue vs cost bases, monthly vs weekly). A single mega-sheet that mixes both grains is where double-counting starts.

## Names

Short, descriptive, and about the content: `Pipeline`, `Revenue build`, `Monthly forecast`. Not `Sheet3`, not `Data2`, not a sentence. A forecast review tab is `Forecast review`, `Forecast variance`, or `Sensitivity`; never `Movement`, which says nothing about what moved.

Divider tabs are labels, not data: `Inputs >>` with its children uncoloured reads as a section marker; a coloured tab on every sheet reads as noise.

## The case selector

When a workbook has cases, there is exactly one editable selector, on the cover or assumptions tab, with its current value shown as `Case Selected:` near the top of every output and build tab. Two selectors, or a selector plus hard-coded per-tab values, is how a model ends up reporting two different cases.
