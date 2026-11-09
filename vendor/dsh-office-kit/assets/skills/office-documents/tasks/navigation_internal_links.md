# Navigation and internal links

An internal link is `w:hyperlink w:anchor="bookmark"`; the target is a `w:bookmarkStart`/`w:bookmarkEnd` pair. Both live in the body, so PDF export keeps the links.

## Build navigation

```bash
"<python>" "<skill>/scripts/internal_nav.py" "<file.docx>" --out "<file-nav.docx>" --levels 1 2 --toc_title "Contents"
```

The script:

- bookmarks every heading `nav_h1`, `nav_h2`, … by outline level;
- inserts a `Contents` heading and a quick-link bar at the top;
- indents contents entries 360 twips per level;
- appends a `Back to contents` link after each heading;
- bookmarks the top, the contents and the bottom as `nav_top`, `nav_toc`, `nav_bottom`.

Flags: `--no_quicklinks`, `--no_back_to_toc`, `--no_top_bottom`.

It reports `missing` when a target could not be created. Read that list: a dead link looks fine in a render.

## Static versus field

`internal_nav.py` writes literal entries: rebuild when headings change, and every renderer shows the same result. `insert_toc.py` writes a live `TOC` field: self-updating, but it needs recalculation. A repeatedly edited document wants the field; a PDF export wants the static list.

## Verify

Render and click through: entry indentation, the contents heading styled as a heading, and `Back to contents` not pushing a paragraph onto a new page. Dead anchors do not show in a screenshot — when the script reports a miss, check `bookmarkStart` names against the `w:anchor` values.

## Pitfalls

- Bookmarks must be unique per document. Re-running on its own output duplicates `nav_h1`, so start from the original.
- Hyperlink anchors are case-sensitive.
- Link styling comes from the `Hyperlink` character style.
