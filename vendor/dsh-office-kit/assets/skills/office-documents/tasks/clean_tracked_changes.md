# Proposed and tracked changes

A tracked edit is markup: an insertion wraps runs in `w:ins`, a deletion wraps `w:delText` in `w:del`, a move is `w:moveFrom`/`w:moveTo` paired by `w:name`, and a formatting change is `w:rPrChange`/`w:pPrChange`. `w:trackRevisions` in `word/settings.xml` makes Word record new edits.

## Propose

```bash
"<python>" "<skill>/scripts/add_tracked_replacements.py" "<file.docx>" --out "<file-tracked.docx>" --author "Review" --replace "18%=21%" --replace "flat=steady"
```

Each `--replace` is `OLD=NEW`. The script splits runs at the match so only the changed characters are marked, keeps the surrounding formatting, and turns on `trackRevisions`. Quote the `--author` the reviewer should see.

Limit: one replacement per pattern per paragraph. A match split across runs is still found because the split is computed on paragraph text; reword if a paragraph repeats the phrase.

## Inspect

```bash
"<python>" "<skill>/scripts/accept_tracked_changes.py" "<file.docx>" --mode report
"<python>" "<skill>/scripts/docx_kit.py" xml "<file.docx>" word/document.xml
```

The report counts insertions, deletions, move pairs and format changes.

## Accept or reject

```bash
"<python>" "<skill>/scripts/accept_tracked_changes.py" "<file.docx>" --mode accept --out "<file-accepted.docx"
"<python>" "<skill>/scripts/accept_tracked_changes.py" "<file.docx>" --mode reject --out "<file-rejected.docx"
```

Accept keeps inserted text and drops deleted text; reject reverses that and restores `w:delText` as ordinary text. Format-only changes are discarded either way. `--keep_tracking_on` leaves `trackRevisions` enabled.

Before delivery: rendered pages contain no markup, so a file can look finished while carrying redlines. Always run `--mode report` on a file about to be sent, then accept or reject explicitly.

## Verify

After accepting, `docx_kit.py text` shows the new wording and `word/document.xml` contains no `w:ins`/`w:del`. Render the affected page.

## Pitfalls

- `w:del` contains `w:delText`, not `w:t`; extraction that reads only `w:t` loses deletions.
- Tables, headers and footnotes can each carry tracked changes. The script covers every text part; a hand edit can miss one.
- Accepting a move pair as two unrelated edits duplicates content. The script treats them as a pair.
- Comments are not tracked changes; see `comments_manage.md`.
