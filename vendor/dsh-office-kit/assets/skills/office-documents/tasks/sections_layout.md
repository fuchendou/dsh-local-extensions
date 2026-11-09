# Sections, page setup, headers

Page setup lives in `w:sectPr`. The last one sits at the end of the body; earlier ones sit inside the last paragraph of the section they end (`w:pPr/w:sectPr`). A landscape page therefore needs a section break before and after it, not one global setting.

## Audit

```bash
"<python>" "<skill>/scripts/section_audit.py" "<file.docx>"
```

Reports per section: width and height in inches, orientation derived from them, every margin, column count, section start type, header and footer parts referenced, `titlePg`, explicit page-number start. Findings: `mixed_page_sizes`, `narrow_text_column` (left and right margin eat most of the width), `portrait_wider_than_letter`.

## Common changes

- New-document defaults: `docx create` spec keys `page_size`, `orientation`, `top_margin` / `bottom_margin` / `left_margin` / `right_margin` (inches).
- A landscape page inside a portrait document: two section breaks with the landscape section between them.
- A different first-page header: set `titlePg` and fill `first_page_header`.
- A continuous change such as narrower margins: `w:type val="continuous"`.

Landscape and columns are section properties, so a snippet is often faster than a script:

```python
from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION

d = Document(r"<file.docx>")
s = d.add_section(WD_SECTION.NEW_PAGE)
s.orientation = WD_ORIENT.LANDSCAPE
s.page_width, s.page_height = s.page_height, s.page_width
d.save(r"<file-edited.docx>")
```

Setting the orientation alone does not swap the two size values.

## Headers and footers

`word/headerN.xml` is referenced from `w:headerReference`. A header inherits from the previous section unless the section sets its own reference. Page numbers in the footer are a `PAGE` field; counts are `NUMPAGES`; `docx_ooxml_patch.py --add-page-numbers` writes one.

## Verify

Render and flip through every page, including the pages after a section break: header content, page numbers, orientation, margins. The classic defect is a section break that leaves an empty page — look for a stray empty paragraph carrying it.

## Pitfalls

- `w:pgSz` holds width then height; a "landscape" 11×8.5 still marked portrait means only the size values changed.
- `titlePg` without a filled first-page header leaves page one blank instead of showing the normal header.
- Deleting a section break merges two sections and keeps the earlier settings.
