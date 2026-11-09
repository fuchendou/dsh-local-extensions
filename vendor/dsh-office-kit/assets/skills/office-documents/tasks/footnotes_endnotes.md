# Footnotes and endnotes

Notes live outside the text flow: `word/footnotes.xml` (or `word/endnotes.xml`) holds the note text, a `w:footnoteReference w:id="N"` run in the body points at it, and the part needs the separator notes (ids -1 and 0) or Word repairs the file.

## Insert

Put a marker where the reference belongs, then run:

```bash
"<python>" "<skill>/scripts/insert_note.py" "<file.docx>" --kind footnote --text "Source: ledger extract, June." --out "<file-notes.docx"
```

The marker defaults to `[[NOTE]]` (`--marker`). The script creates the notes part with separator and continuation-separator entries when they are missing, allocates the next free id, splits the surrounding run so only the marker is replaced, and styles the note text `FootnoteText` and the reference `FootnoteReference`. `--kind endnote` writes the endnotes part instead.

## Report

```bash
"<python>" "<skill>/scripts/footnotes_report.py" "<file.docx>"
```

Lists each note's text and reference count, dangling references (note deleted, marker kept) and orphaned notes (no reference — usually copied content).

## Renumbering

Ids are numbers, but Word displays notes sequentially by position, so inserting in the middle renumbers automatically. Keep ids unique, not in display order.

## Verify

Render the page with the note. The marker sits immediately after the word it annotates, with no space before it, and the note text matches. Check the last page too: an endnote section after the signature block is a layout defect.

## Pitfalls

- A footnote reference is allowed in a table cell, not in a header.
- Copying a paragraph with python-docx copies the reference but not the note body.
- Deleting note text without its reference leaves a repair prompt.
- Field instructions are not allowed in the note separator; leave the built-in separators untouched.
