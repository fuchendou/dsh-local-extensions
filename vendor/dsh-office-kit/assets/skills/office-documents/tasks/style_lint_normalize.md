# Style lint and normalisation

A paragraph carries `pStyle`; a run carries `rStyle` plus direct formatting (`w:b`, `w:i`, `w:sz`, `w:color`). Direct formatting wins over the style, which is why "make all body text 11pt" fails on hand-formatted runs.

## Lint

```bash
"<python>" "<skill>/scripts/style_lint.py" "<file.docx>" --json "<report.json"
```

Findings: undefined style references, headings carrying their own paragraph or run formatting, empty runs, manual bullets (`•` typed instead of a list style), double spaces, trailing spaces, body sizes appearing once or twice against the dominant size, tables without a style. Exit 1 means findings; the JSON holds counts and examples.

## Normalise

```bash
"<python>" "<skill>/scripts/style_normalize.py" "<file.docx>" --out "<file-clean.docx" --clear_paragraph_format --enforce_heading_spacing
```

- `--clear_paragraph_format` strips everything from each run's `rPr` except `rStyle`, `rtl` and `lang`, and drops the paragraph-mark run properties, so the style controls the look.
- `--enforce_heading_spacing` sets space-before and space-after per heading level plus `keepNext`.

Run it before applying a template: a template cannot win against direct formatting (`tasks/templates_style_packs.md`).

## Correct look

- Body text 11–12pt from `Normal`.
- Headings from `Heading 1`–`Heading 3`, with no direct bold or size.
- Bold for in-sentence emphasis via a character style or one `w:b` run, never for whole paragraphs that are really headings.
- Lists from `List Bullet` / `List Number`, never typed bullets.
- One table style per document, usually `Table Grid`.

## Verify

Re-run `style_lint.py` and watch the counts drop, then render. Clearing direct formatting can change the hierarchy when a document faked emphasis with size; compare against the original before claiming the change was neutral.

## Pitfalls

- Clearing `rPr` also removes field-result formatting; re-run the field scripts if a number must stay bold.
- A style that is referenced but not defined falls back to `Normal` silently — the lint is the only warning.
- `w:rsid` and proofing attributes are noise, removed by `privacy_scrub.py` when the file leaves (`tasks/privacy_scrub_metadata.md`).
