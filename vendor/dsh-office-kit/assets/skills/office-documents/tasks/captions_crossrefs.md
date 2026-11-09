# Captions and numbered cross-references

A caption is a paragraph with a `SEQ` field (`SEQ Table \* ARABIC`) plus a bookmark; the prose reaches that bookmark with a `REF` field. Without the bookmark a `REF` has no target.

## Add captions

```bash
"<python>" "<skill>/scripts/captions_and_crossrefs.py" "<file.docx>" "<file-captioned.docx>" --tables --figures --bookmarks --caption_text "Source: finance ledger"
```

- `--tables` adds `Table N` under each table; `--figures` adds `Figure N` under each picture.
- Neither flag runs both.
- `--bookmarks` names them `tbl1`, `tbl2`, `fig1`, … — the `tblN`/`figN` pattern `insert_ref_fields.py` expects.
- `--materialize` writes literal numbers: for a frozen PDF export, not for a document that will change.
- `--caption_text` appends a fixed note.

Captions use the `Caption` style and stay in the same visual block as the object, so a page break cannot orphan them.

## Cross-reference

Write `[[REF:tbl1]]` placeholders in the prose, then:

```bash
"<python>" "<skill>/scripts/insert_ref_fields.py" "<file.docx>" "<file-refs.docx"
```

That produces a `REF tbl1 \h` field, so the number follows the table. `--pattern` accepts your own regex with the named group `bookmark`; `--prefix` prepends text such as `Table `.

If a reference should read "Table 2" rather than "2", set the REF field's `\n` behaviour off and put the label in the prose: a field cannot know whether it points at a table or a figure.

## Order

1. Add or restructure the tables and figures.
2. Run `captions_and_crossrefs.py`.
3. Run `insert_ref_fields.py`.
4. Re-render.

## Verify

Run `fields_report.py`: one SEQ per caption, one REF per reference, and no REF with an empty result. Then render. The usual defects are a caption above its table, or a caption separated from it by a page break.

## Pitfalls

- Numbering changes on field update, so two captions can claim `Table 2` until Word recalculates.
- A hand-typed caption number never renumbers.
- Bookmarks must be unique: copying a caption copies its bookmark name and breaks the reference.
