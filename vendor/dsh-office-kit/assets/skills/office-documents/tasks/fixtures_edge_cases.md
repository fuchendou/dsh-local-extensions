# Fixtures for edge cases

Build a file containing the awkward cases before being asked to handle them: a fix proven on clean prose may still mangle a 1600-word paragraph.

## Build

```bash
"<python>" "<skill>/scripts/make_fixtures.py" --outdir "<work-dir>" --only all
```

Writes:

- `tracked.docx` — a replacement as real `w:del`+`w:ins`, tracking on.
- `watermark.docx` — a DRAFT watermark in the header.
- `comments.docx` — one anchored comment in `word/comments.xml`.
- `edge_cases.docx` — an empty paragraph, an H1→H3 jump, a 1600-word paragraph, an email and a phone number, a 2×10 unstyled table, and an image with no alt text.

`--only tracked|watermark|comments|edge` builds a single file. These are test inputs, not templates: never ship them.

## Cases that break naive edits

- **Long paragraphs.** A replacement that rebuilds the paragraph loses run formatting over thousands of characters. Check with `read_image`, not only a text dump.
- **Nested tables.** Text inside `table > cell > table > cell` is missed by `document.paragraphs`; walk `cell.tables` or use the pack scripts.
- **Header and footer text.** Body find-and-replace never sees it.
- **Tables without a style.** Borders come from the renderer default and change elsewhere: apply `Table Grid` or explicit `#D9D9D9` borders.
- **Images with no alt text.** An accessibility finding and a sign of pasted content.
- **Manual spacing.** Empty paragraphs and spaces render differently; normalize first (`tasks/style_lint_normalize.md`).
- **Mixed page sizes.** A landscape section in a portrait document confuses headers and footers; `section_audit.py` reports it.

## Regression pass

Loop over `"<work-dir>"/*.docx` running `heading_audit.py`, `style_lint.py`, `a11y_audit.py` and `section_audit.py`, each with `|| true`. An audit that now reports nothing where it used to report a real problem is a regression. Keep fixtures under the temp directory, out of the user's workspace.

## Verify

Render whatever the script produced — fixtures exist to be looked at. The long paragraph and the too-wide table fail visually first.
