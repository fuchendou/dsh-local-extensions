# Content controls (form fields)

A content control is a `w:sdt` with a `w:sdtPr` (tag, alias, id, type) and a `w:sdtContent`. The tag is the machine name; the alias is what Word shows in the properties panel.

## List

```bash
"<python>" "<skill>/scripts/content_controls.py" list "<file.docx>"
```

Reports part, tag, alias, id, type and current text across the body, headers and footers. `--no_headers_footers` limits the scan to the body.

## Create

```bash
"<python>" "<skill>/scripts/content_controls.py" create "<file.docx>" --placeholder "Client name" --tag client_name --alias "Client name" --out "<file-form.docx"
```

Wraps the paragraph containing the placeholder text (or appends one) in a `w:sdt`, so the field is a drop-in replacement for a typed placeholder line. `--json` prints the created control.

## Fill

```bash
"<python>" "<skill>/scripts/content_controls.py" set "<file-form.docx>" --set client_name="Northwind" --set period="Q2 FY26" --out "<file-filled.docx"
```

`--set TAG=VALUE` matches on the tag. It exits 1 and lists `missing_tags` when a tag is absent — the check for a scripted fill.

## Design

- One control per value, not one per table.
- Tag `snake_case`, alias in the user's words.
- A choice control lists options in `w:sdtPr`; a date control has `w:date` with a format; plain text is the default and safest.
- Leave surrounding labels in body text: the alias is visible only in Word's properties panel.

## Verify

`content_controls.py` `list` after filling (tags present with the expected text), then render. A control is ordinary text on the page, so check that nothing shifted and the filled value fits its line.

## Pitfalls

- Deleting the `sdt` wrapper to clear a field deletes value and structure; set the text instead.
- Two controls with the same tag make `--set` ambiguous: it updates the first and reports the rest.
- A control cannot span two paragraphs unless `w:sdtContent` holds both, so generate one value per paragraph.
