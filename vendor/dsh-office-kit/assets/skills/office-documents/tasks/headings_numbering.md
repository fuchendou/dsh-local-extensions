# Headings and numbering

A heading level comes from the paragraph style (`Heading 1` … `Heading 9`, `Title` = outline level 0), not from size or weight.

## Audit

```bash
"<python>" "<skill>/scripts/heading_audit.py" "<file.docx>" --max_findings 20
```

Findings:

- `skipped_level` — L3 directly under L1: insert the missing level or promote the heading.
- `empty_heading` — a blank line in the TOC.
- `manual_formatting` — a real heading carrying direct bold or a large size, which fights restyling.
- `heading_not_styled` — bold 13pt+ text in `Normal`: the TOC and every later style change miss it.

## Fix

Prefer real styles. To strip direct run formatting and set standard heading spacing:

```bash
"<python>" "<skill>/scripts/style_normalize.py" "<file.docx>" --out "<file-fixed.docx" --clear_paragraph_format --enforce_heading_spacing
```

To promote bold text to a real heading:

```python
d = Document("<file.docx>")
for p in d.paragraphs:
    if p.text.strip() == "<exact heading text>":
        p.style = d.styles["Heading 1"]
d.save("<file-fixed.docx")
```

## Numbered headings

Numbering is a definition attached to the heading style, not text such as `1.2`: a typed number lies after the next insert. A numbered outline needs `numPr` on the style, with an `abstractNum` whose level text is `%1.%2`. Restore the style's `numPr` instead of typing numbers.

Lists are the same machinery at body level. `List Number` restarts only when the numbering definition says so, which is why two separate lists sometimes continue each other.

## Verify

`heading_audit.py` exits 0 on a clean file. Render, then check that no heading is orphaned at the bottom of a page (`keepNext`) and that headings of one level share their spacing.

## Pitfalls

- Changing a heading's style leaves its text alone but can change size and colour: re-render.
- A heading inside a table cell still counts for the outline, which is rarely wanted — use a bold paragraph.
- Copying a heading brings a direct-formatting payload, so run the audit afterwards.
