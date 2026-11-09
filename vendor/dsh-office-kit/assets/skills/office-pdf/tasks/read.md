# Read text, tables, and page images

Extraction reads the page content stream; glyph runs carry position and font, which a library groups into words and lines. A page without text operators (a scan, a photo export) yields nothing, whatever the extractor — a property of the file, not of the tool.

## Fast path: plain text and structure

```bash
"<python>" "<cli>" pdf read --input "<file.pdf>" --json-out "<read.json>"
```

Returns `page_count`, `word_count`, document metadata, per-page text (with character counts), and AcroForm field identifiers. `scripts/render_pages.py --input "<file.pdf>"` adds geometry: page size, rotation, drawings, annotations, widgets, and the characters inside an optional crop.

## Tables and layout with pdfplumber

```bash
"<python>" "<skill>/scripts/extract_text.py" --input "<file.pdf>" --json-out "<tables.json>"
```

Detection uses the page's ruling lines and word spacing, so a borderless table often comes back as running text; `--layout` keeps the original line spacing for a manual look.

When the detection looks wrong, inspect rather than guess:

```bash
"<python>" - <<'PY'
import pdfplumber
with pdfplumber.open("in.pdf") as pdf:
    page = pdf.pages[0]
    print("chars", len(page.chars), "lines", len(page.lines), "rects", len(page.rects))
    for table in page.find_tables():
        print(table.bbox, table.extract()[:3])
    print(page.extract_text()[:400])
PY
```

`chars`, `lines`, and `rects` tell you whether the table has rules at all. With no lines, read it from `extract_text` with `--layout`, where column gaps survive as spaces.

## Page images

A page may embed rasters that text extraction does not show. List them with PyMuPDF:

```bash
"<python>" - <<'PY'
import pymupdf
doc = pymupdf.open("in.pdf")
for number, page in enumerate(doc, 1):
    for image in page.get_images(full=True):
        print(number, image[0], image[2], "x", image[3])
PY
```

Extract one with `page.get_pixmap(clip=...)` or `doc.extract_image(xref)` when the user needs the picture itself. To *see* it, render the page at 150–200 dpi and crop with `read_image`.

## What fails and how to resolve it

- **Scanned page, no text**: no text layer exists; say so, with resolutions from `references/limits.md`. Never claim extraction succeeded on an empty result.
- **Empty string from a page that shows text**: broken ToUnicode map, or text drawn as vector outlines. Check the render; outlines cannot be recovered by extraction.
- **Wrong reading order in multi-column layouts**: extraction follows operator order. Crop each column with a rect and extract per column; `get_textbox(rect)` on a PyMuPDF page is the simplest split.
- **Ligatures and soft hyphens**: extraction may glue or split words; quote extracted text only after reading the same passage on the render.

## Verify

The render is the check: the characters you return must be visible in it. Before building on extracted text, check for a page whose text is suspiciously short (missing text layer), duplicated (headers repeated per page), or full of replacement glyphs (broken encoding).
