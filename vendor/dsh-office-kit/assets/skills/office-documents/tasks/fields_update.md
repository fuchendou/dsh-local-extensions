# Update or freeze fields

A field is an instruction Word evaluates: `SEQ` numbers captions, `REF` repeats a bookmark, `PAGE`/`NUMPAGES` count pages, `TOC` builds contents, `DATE` prints today. The reader sees a cached result until something recalculates.

## Inspect

```bash
"<python>" "<skill>/scripts/fields_report.py" "<file.docx>" --max-examples 5
```

The report gives each instruction, whether the field is simple (`w:fldSimple`, one attribute) or complex (begin/separate/end runs), and the cached result. To read the raw runs yourself, dump `docx_kit.py xml` for `word/document.xml` and filter `instrText`:

```bash
"<python>" "<skill>/scripts/docx_kit.py" xml '<file.docx>' word/document.xml | grep -o 'instrText[^<]*' | head
```

## Freeze

```bash
"<python>" "<skill>/scripts/fields_materialize.py" "<file.docx>" --out "<file-static.docx>" --only SEQ REF
"<python>" "<skill>/scripts/flatten_ref_fields.py" "<file.docx>" --out "<file-static.docx"
```

Materialising replaces the field span with one run holding the cached text and keeps the run formatting. `flatten_ref_fields.py` is the narrower tool for `REF`/`PAGEREF` only.

Freeze when a reader must see exactly this number, when the target bookmark is about to be deleted, or when a downstream tool mangles fields. Keep fields live when the document will be edited again: a frozen caption number stops following its table.

## Keep fields live

Set `w:updateFields val="true"` in `word/settings.xml`; `insert_toc.py` does it for a new TOC, and you add the element yourself otherwise — the first open then prompts the user. LibreOffice and the renderer also refresh fields, so a stale cached value usually means the document was never recalculated, not that fields are broken.

`insert_ref_fields.py` converts `[[REF:bookmark]]` placeholders into real REF fields — the reliable way to build cross-references after a restructure.

## Verify

Run `fields_report.py` again: frozen fields disappear from the report, live ones keep their instruction. Then render or read the page.

## Pitfalls

- A field split across paragraphs is invalid; keep begin/separate/end together.
- Both `w:fldSimple` and complex fields appear in the report; handle both.
- Copying a field copies the instruction but not its bookmark.
