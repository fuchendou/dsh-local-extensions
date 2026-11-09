# Read and review a file

## Read

```bash
"<python>" "<cli>" docx read --input "<file.docx>"
"<python>" "<skill>/scripts/docx_kit.py" parts '<file.docx>'    # every package part and its size
"<python>" "<skill>/scripts/docx_kit.py" text '<file.docx>'     # paragraphs with style and outline level
"<python>" "<skill>/scripts/docx_kit.py" xml '<file.docx>' word/document.xml
```

`docx read` gives the title, author, styled paragraphs, headings, table/image/equation counts and page dimensions — the first look, including for files produced earlier in the session. `parts` shows which features exist at all: no `comments.xml`, no comments, whatever the user says. `text` is faster than raw XML when you only need the words and their heading levels.

## Audit

| Question | Command |
|---|---|
| Are headings consistent and styled? | `heading_audit.py` |
| Is the prose styled directly instead of by style? | `style_lint.py` |
| Are images described, sized sensibly? | `images_audit.py` |
| Is the page setup sane? | `section_audit.py` |
| Are there fields, TOC entries, cross-references? | `fields_report.py` |
| Are there footnotes or endnotes? | `footnotes_report.py` |
| What comments exist, and on what text? | `comments_extract.py` |

Each audit prints JSON and exits non-zero when it found something: the exit code says whether the document needs attention, the `findings` array says why.

## Review for the user

1. Read the text, not just the audits. Address the argument, not only the formatting.
2. Separate defects (broken table, skipped heading level, missing alt text) from style preferences.
3. Cite locations by section heading and paragraph text: Word has no stable page numbers.
4. Offer the fix as a concrete next action, with the command that performs it.

## Pitfalls

- `docx read` shows the body only; headers, footers, footnotes and comments need `docx_kit.py xml` or the report scripts.
- Tracked changes read as plain text; `accept_tracked_changes.py --mode report` shows what is proposed.
- A field's displayed text is a cached result; `fields_report.py` shows the instruction, which is the truth.
