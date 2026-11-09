# Visual verification

See the pages before the user does. A document that parses and a document that looks right are different claims.

```bash
"<python>" "<cli>" docx render --input "<file.docx>" --out-dir "<render-dir>"
```

Writes one PNG per page and prints the paths plus the renderer it used (`libreoffice-kit`); add `--pdf` to keep a PDF as well. For a JSON report and page list use `render_docx.py`:

```bash
"<python>" "<skill>/render_docx.py" "<file.docx>" --output_dir "<render-dir>" --dpi 150
```

Open every PNG with `read_image` and check, in this order:

1. **Hierarchy** — does the page show the structure the user asked for, at a glance?
2. **Fit** — nothing past the right margin, no clipped table column, no text over a watermark.
3. **Breaks** — no heading alone at the bottom, no orphaned caption, no half-empty page before a section break.
4. **Text** — the intended words changed, and nothing else moved.
5. **Glyphs** — dashes, quotes, CJK, currency symbols and maths render, not as boxes.
6. **Header and footer** — present, correct, and not repeated on a first page that should not have one.

Re-render after any script edit. Package-valid is not page-valid: a caption placed before the paragraph it describes, a table grown past the margin, a style merge that changed heading sizes — all are invisible in the XML and obvious in the image. To compare two revisions, `render_and_diff.py` writes a heatmapped difference page; read the diff images yourself, because a ratio is not a conclusion.

## When no renderer exists

`office_status` reports `renderers.available: false` (with a `remedy`) because the DSH LibreOffice kit was not found. `render` then exits non-zero with a JSON error naming the missing renderer, and `render_docx.py` exits 3 with `reason: no_renderer`.

- Verify structure with `docx read`, `docx_kit.py parts|text|xml` and the audit scripts.
- Say plainly that layout was not visually verified, and that the fix is a harness install shipping the kit (the plugin records its path in `config.json` when it loads), not installing Word or LibreOffice.
- Never claim a file "looks good" from XML evidence alone.

## Pitfalls

- Different renderers paginate differently. Compare like with like, and do not promise Word-perfect pagination from a LibreOffice render.
- A missing font turns into a blank page: that is a finding, not a rendering bug. `missing_fonts` / `glyph_fallback` in the render JSON shows substitution happened.
- Render into a fresh directory: stale PNGs from an earlier run are the classic false pass.
