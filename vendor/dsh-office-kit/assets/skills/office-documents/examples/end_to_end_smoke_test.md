# End-to-end smoke test

A short job touching creation, inspection, structural change and verification. Run it after a runtime change, or as a template for "is this environment healthy".

```bash
PY="<python>"; CLI="<cli>"; S="<skill>/scripts"; R="<skill>"; W="/tmp/docx-smoke"
mkdir -p "$W"
```

## 1. Create a document

```bash
cat > "$W/spec.json" <<'JSON'
{
  "title": "Smoke Test",
  "author": "Runtime Check",
  "page_size": "Letter",
  "header": "Smoke test",
  "blocks": [
    { "type": "paragraph", "text": "This file exercises the DOCX path end to end." },
    { "type": "paragraph", "text": "[[TOC]]" },
    { "type": "heading", "level": 1, "text": "Findings" },
    { "type": "paragraph", "text": "Revenue grew 18% year over year." },
    { "type": "bullets", "items": ["Hardware flat", "Services up"] },
    { "type": "table", "headers": ["Region", "Q1", "Q2"], "rows": [["North", "10", "12"], ["South", "8", "9"]], "style": "Table Grid" },
    { "type": "equation", "latex": "E = mc^2" }
  ]
}
JSON
"$PY" "$CLI" docx create --spec "$W/spec.json" --out "$W/base.docx"
```

Expect `ok: true` and non-zero `headings`, `tables`, `equations`.

## 2. Inspect

```bash
"$PY" "$CLI" docx read --input "$W/base.docx"
"$PY" "$S/docx_kit.py" parts "$W/base.docx"
"$PY" "$S/section_audit.py" "$W/base.docx"
"$PY" "$S/style_lint.py" "$W/base.docx"
```

Expect the sections, `word/document.xml` in the parts list, Letter 8.5×11 portrait, and an empty style-lint `counts`.

## 3. Change it structurally

```bash
"$PY" "$S/replace_text.py" --input "$W/base.docx" --out "$W/replaced.docx" \
  --find "Revenue grew 18%" --replace "Revenue climbed 21%" --require-all
"$PY" "$S/captions_and_crossrefs.py" "$W/replaced.docx" "$W/captioned.docx" --tables --figures --bookmarks
"$PY" "$S/insert_toc.py" "$W/captioned.docx" --placeholder "[[TOC]]" --out "$W/with-toc.docx"
```

`replace_text.py` prints `misses: []`; captions report one table caption; the TOC step reports whether the placeholder was found.

## 4. Audit

```bash
"$PY" "$S/heading_audit.py" "$W/with-toc.docx"
"$PY" "$S/a11y_audit.py" "$W/with-toc.docx" --out_json "$W/a11y.json"
"$PY" "$S/fields_report.py" "$W/with-toc.docx"
"$PY" "$S/table_geometry.py" "$W/with-toc.docx"
```

Audits may exit 1 with findings: that is a report, not an environment failure. Every finding should be explainable.

## 5. Verify visually

```bash
"$PY" "$R/render_docx.py" "$W/with-toc.docx" --output_dir "$W/render" --dpi 150
```

Open each PNG with `read_image`. Without the DSH LibreOffice kit the command exits 3 with `no_renderer`: a setup problem, not a document problem, and the rest of the test still stands.

## 6. Deliver

Copy the final file into the user's workspace, `present` it, and state what changed in one sentence. Never present a temp path.

## Teardown

```bash
rm -rf "$W"
```

Nothing under the workspace should be left behind by a smoke test.
