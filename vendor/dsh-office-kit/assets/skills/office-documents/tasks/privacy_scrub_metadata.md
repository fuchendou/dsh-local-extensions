# Privacy and document metadata

A `.docx` stores more than text: `docProps/core.xml` (author, last modifier, title, keywords, description), `docProps/app.xml` (company, manager, template), `docProps/custom.xml`, `word/comments.xml`, revision data and per-author `w:rsid` stamps.

## Scrub

```bash
"<python>" "<skill>/scripts/privacy_scrub.py" "<file.docx>" --out "<file-clean.docx"
```

Clears creator, last-modified-by, keywords, description, subject, title, category, company, manager and application; resets the revision counter; drops `docProps/custom.xml` with its relationships and content-type override; strips `w:rsid*`, `w:proofErr` and `w:lastRenderedPageBreak` across the Word parts. `--keep_title` preserves a real title.

## Other residue

- Comments and their authors → `comments_strip.py`.
- Tracked changes and reviewer names → `accept_tracked_changes.py --mode accept` (or reject).
- A watermark naming the old client → `watermark_audit_remove.py --mode remove`.
- Emails and phone numbers → `redact_docx.py`.

Order matters: scrub metadata, resolve markup, then redact the surviving text.

## Check before delivery

```bash
"<python>" "<skill>/scripts/docx_kit.py" parts '<file-clean.docx>'
"<python>" "<skill>/scripts/docx_kit.py" xml '<file-clean.docx>' docProps/core.xml
```

`parts` shows whether `custom.xml` and `comments.xml` still exist; `core` shows what a recipient sees under File > Info.

## Verify

Metadata never appears in a render, so use those two commands. Render afterwards to confirm the document still looks right: clearing `w:lastRenderedPageBreak` can change where a viewer breaks a long line.

## Pitfalls

- Author names also appear in comment and revision entries.
- `docProps/app.xml` names the editing application and is regenerated on the next save.
- Removing revision ids does not undo content.
