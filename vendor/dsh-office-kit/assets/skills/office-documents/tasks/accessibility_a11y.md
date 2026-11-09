# Accessibility

Accessibility comes from structure, not appearance: bold announces as bold, `Heading 1` announces as a heading and appears in the navigation pane. Alt text lives in `wp:docPr @descr`.

## Audit

```bash
"<python>" "<skill>/scripts/a11y_audit.py" "<file.docx>" --out_json "<report.json>"
```

Checks images without description or title, tables without a repeating header row, heading levels that jump, empty headings, link text that is only "click here", "here" or "link", and a missing core title. Exit 1 means at least one finding.

## Mechanical fixes

```bash
"<python>" "<skill>/scripts/a11y_audit.py" "<file.docx>" --fix_image_alt from_filename --fix_table_headers first_row --out "<file-a11y.docx"
```

These are honest placeholders, not substitutes for real text.

## Judgement fixes

- **Alt text** describes what the reader loses, e.g. "Bar chart: revenue by region, EMEA 4.1M ahead of APAC 3.2M". Decorative rules and dividers get an empty description.
- **Link text** names the destination: "Download the Q2 ledger", not "click here".
- **Reading order:** decorative text boxes and floating images land awkwardly; convert them to inline.
- **Colour alone** (red = bad) fails colour-blind readers; add a word.
- **Layout tables** announce as data tables; restructure them as paragraphs.

Longer documents also want a TOC (`tasks/toc_workflow.md`) and language tags.

## Verify

Re-run the audit to zero findings and render. Heading hierarchy is visible; alt text is metadata and stays invisible; the header row must be distinct. With a screen reader available, navigate by heading.

## Pitfalls

- Alt text on a decorative image is worse than none: use an empty description plus `title` to mark it decorative.
- A header row is `w:tblHeader` on the row, not a bold first row.
- Images inside table cells still need descriptions.
