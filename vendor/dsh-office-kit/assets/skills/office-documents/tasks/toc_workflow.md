# Table of contents

A TOC is a `TOC` field: Word fills it on recalculation and the file stores the last result. A hand-typed list looks identical, then goes wrong on the first edit.

Insert:

```bash
"<python>" "<skill>/scripts/insert_toc.py" "<file.docx>" --out "<file-toc.docx>" --levels 1-3
```

The script fills a placeholder paragraph containing `[[TOC]]` (override with `--placeholder`); with no placeholder it inserts the field at the start of the body. It writes `TOC \o "1-3" \h \z \u`, sets `w:updateFields`, and leaves a short cached hint so the page is not blank before recalculation.

Every heading you want listed must use a heading style. `heading_audit.py` finds hand-formatted headings that the TOC silently skips.

## Rebuild after edits

The cached list goes stale after a structural edit. Ask the user to update the field in Word (right-click → Update Field), or delete the field paragraphs and re-run `insert_toc.py`. Do not freeze a TOC with `fields_materialize.py`.

For a fixed PDF export or a hand-built template contents page, generate a static list with `internal_nav.py` instead:

```bash
"<python>" "<skill>/scripts/internal_nav.py" "<file.docx>" --out "<file-nav.docx>" --levels 1 2
```

See `tasks/navigation_internal_links.md`.

## Verify

Render the first pages. A line of grey hint text means the renderer never recalculated the field; old headings mean it rendered before the update. Say which happened instead of claiming the contents are correct.

## Pitfalls

- TOC entries come from outline levels, not from text that looks like a heading.
- A TOC in a header or text box does not work — body only.
- Level 4 and deeper are excluded unless you widen `--levels`.
