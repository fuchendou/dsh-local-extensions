# Watermarks and background marks

A text watermark is a shape inside a header part, behind the body text: Word writes legacy VML (`v:shape` with `v:textpath`), while `watermark_add.py` writes DrawingML (`wps:wsp`) because VML is routinely dropped by non-Word renderers. That is why a watermark disappears when the header is replaced and can differ per section.

## Add

```bash
"<python>" "<skill>/scripts/watermark_add.py" "<file.docx>" --out "<file-draft.docx>" --text "DRAFT"
```

Writes the shape into the default header: light grey, centred on the page, tagged with `descr="DSH Office watermark"`. Word rotates it -45°; renderers that ignore the rotation still show a horizontal mark, so it is always visible. The script refuses to add a second watermark when it finds one, so remove the old one first. For a mark on every page across sections, each section's header needs the shape — loop over the sections.

## Find and remove

```bash
"<python>" "<skill>/scripts/watermark_audit_remove.py" "<file.docx>" --mode report
"<python>" "<skill>/scripts/watermark_audit_remove.py" "<file.docx>" --mode remove --out "<file-clean.docx"
```

The report lists every DrawingML watermark and every legacy VML text path, with the part it lives in, and exits 1 when any watermark exists. `--contains` narrows it to a substring, for the "template says Company Confidential" case. Remove deletes the enclosing paragraph from the header.

## Verify

Render and read the pages: the mark sits behind the text, inside the page, on every expected page. A light grey drawing that covers a line of body text is still a defect; a mark missing on page two means that section has a different header.

## Pitfalls

- A watermark in a "different first page" header shows only on page one.
- Removing the header paragraph can leave an empty header that adds vertical space — check the top margin.
- An image watermark is `v:imagedata`, not a text shape, so the report will not name it; inspect the header XML.
- A watermark is not security (`tasks/protection_restrict_editing.md`).
