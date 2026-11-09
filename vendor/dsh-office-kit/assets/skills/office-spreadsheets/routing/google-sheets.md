# Google Sheets

This runtime works on local files with openpyxl. There are no Google credentials, no Drive API, and no live link to a browser sheet, so "update my Google Sheet" cannot be done directly.

## What to do instead

1. Say plainly what is possible: the work is done on a local `.xlsx` file the user opens in Sheets, or the user exports the sheet and shares the file.
2. Ask for an export when the source lives in Sheets: `File > Download > Microsoft Excel (.xlsx)`. A single-sheet CSV loses formulas and formats, so ask for `.xlsx` unless the sheet is truly one flat table.
3. Do the work on the exported file with this skill, then hand back the `.xlsx`. The user re-uploads or imports it. State that formulas recalculate when Sheets opens the file.
4. Do not promise a round trip that keeps Sheets-specific features. Named functions, Apps Script, and connected sheets do not survive export.

## Formulas for a file that goes back to Sheets

- Keep to functions both engines share: `SUMIFS`, `INDEX/MATCH`, `XLOOKUP`, `IFERROR`, `EDATE`, `TEXT`.
- Newer functions that Excel stores with an `_xlfn.` prefix are a common source of `#NAME?` after a round trip. If a function is genuinely new, say so.
- Array formulas and dynamic spills behave differently in the two engines. Avoid them in shared files.
- Number formats, conditional-formatting rules, and charts mostly survive an export; images and pivot tables often do not. Check them after the round trip with `container_tools/inspect_workbook.py`.

## Links

A sheet shared by URL is not a workbook on this machine. Do not fetch a Google Sheets URL and pretend it is a file: without a published CSV or an export, there is nothing to read.
