# Redaction and anonymisation

Text lives in `w:t` (plus `w:delText` for deletions and `w:instrText` for field instructions). A redaction that only rewrites paragraphs through python-docx misses headers, footers, footnotes and comments.

## Redact

```bash
"<python>" "<skill>/scripts/redact_docx.py" "<file.docx>" "<file-redacted.docx>" --emails --phones
```

```bash
"<python>" "<skill>/scripts/redact_docx.py" "<file.docx>" "<file-redacted.docx>" --pattern "ACCT-\d{6}" --replacement "<account>"
```

`--pattern` is repeatable — use it for account numbers, case ids and postcodes. It applies to the body, every header and footer, footnotes and endnotes.

| Flag | Effect |
|---|---|
| `--mask_char *` | masks the shape of the value instead of replacing it (`***@***.com`) |
| `--replacement` | swap in a token instead of masking |
| `--no_preserve_length` | stop padding the result to the original length |
| `--include_comments` | also rewrite `word/comments.xml`; without it comments keep the original text |

Matching happens per text run, because merging runs destroys formatting, so a value split across runs is not found. That is acceptable only if you check the result; when formatting is mixed inside the sensitive value, flatten that paragraph first (`tasks/style_lint_normalize.md`).

Redaction removes a value; anonymisation replaces it consistently. If the same account number appears four times and the argument depends on it matching, replace all occurrences with the same token rather than `[redacted]` every time — per-pattern `--replacement "<account-A>"` does that.

## Check the whole file

```bash
"<python>" "<skill>/scripts/docx_kit.py" text '<file-redacted.docx>' --part word/footnotes.xml
"<python>" "<skill>/scripts/docx_kit.py" xml '<file-redacted.docx>' word/document.xml | grep -c "example.com"
```

Grepping the dumped XML for each sensitive term across document, header, footer, footnote and comment parts is the honest check. Then render and read the pages the data appeared on: check line-length shifts, and remember an intact `<w:t>` shows in the grep, not on the page.

## Pitfalls

- Field results and field instructions can both hold data; the script rewrites `w:t` / `w:delText` only.
- Images are not scanned. Say so plainly instead of implying the file is clean.
- Charts store category labels in `word/charts/*.xml`; inspect them when a chart carried the data.
