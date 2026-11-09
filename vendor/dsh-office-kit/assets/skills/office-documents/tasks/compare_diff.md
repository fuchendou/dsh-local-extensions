# Compare two versions

Two comparisons answer different questions: text-level (which words changed) and page-level (what the reader sees). A style-definition change can leave every word identical and move every paragraph.

## Page-level

```bash
"<python>" "<skill>/scripts/render_and_diff.py" "<before.docx>" "<after.docx>" --outdir "<render-dir>" --dpi 120
```

Renders both files through the helper CLI, pairs pages, writes `diff-NN.png` coloured by pixel difference, and reports changed pages, the fraction of differing pixels and the page-count delta. Exit code 3 means no renderer: render another way, or compare text only and say which comparison you could not run.

## Text-level

```bash
"<python>" "<skill>/scripts/docx_kit.py" text '<before.docx>' > before.json
"<python>" "<skill>/scripts/docx_kit.py" text '<after.docx>'  > after.json
```

Then diff the paragraph dumps with any diff tool or a few lines of Python. This is the reliable way to separate content from layout changes.

## Review mode versus diff mode

If the document should carry the changes, use tracked changes (`tasks/clean_tracked_changes.md`): a diff is evidence for a conversation, tracked changes are the artefact. For a version that arrived with markup, `accept_tracked_changes.py --mode report` is the change list with reviewer names and positions.

## Verify

Open the diff PNGs with `read_image`. A coloured block on a page that should not change usually means font substitution or a margin change — cross-check the text diff before concluding.

## Pitfalls

- Different renderers paginate differently; compare with the same renderer and settings.
- Metadata and revision ids differ between saves and never appear on a page, so a raw `word/document.xml` diff is mostly noise.
- An image replaced in place keeps its relationship and position — only a pixel comparison notices.
