# Images and figures

An inline picture is a `w:drawing` containing `wp:inline` (`wp:anchor` for floating), the picture relationship in `a:blip r:embed`, the display size in `wp:extent` (EMU), and the alt text in `wp:docPr @descr`.

## Audit

```bash
"<python>" "<skill>/scripts/images_audit.py" "<file.docx>" --max_rows 20
```

Reports each picture's part, name, media file, size in inches and alt text, plus `missing_alt` and `oversized` (wider than the text block). The real test is whether the alt text describes what a reader loses without the picture.

## Fix alt text

```bash
"<python>" "<skill>/scripts/a11y_audit.py" "<file.docx>" --fix_image_alt from_filename --out "<file-fixed.docx"
```

A file name is better than nothing but not as good as a real description. For real text, patch `wp:docPr` directly:

```python
sys.path.insert(0, r"<skill>/scripts")
import docx_kit as kit
d = kit.Docx(r"<file.docx>")
for doc_pr in d.xml("word/document.xml").iter(kit.q("docPr", kit.WP)):
    if doc_pr.get("name") == "Picture 3":
        doc_pr.set("descr", "Bar chart: revenue by region, EMEA ahead of APAC.")
d.save("<file.docx>")
```

Decorative images get an empty description plus a `title`; informative images get a sentence.

## Insert

`docx create --spec` block:

```json
{ "type": "image", "path": "<absolute.png>", "width": 5.5 }
```

Width is in inches and height follows the aspect ratio. A picture wider than the text block is clipped or shrinks unpredictably; 5.5in is a safe full-width figure on Letter with 1in margins.

Figures get captions with `captions_and_crossrefs.py --figures` (`tasks/captions_crossrefs.md`), which adds `Figure N` with a `SEQ` field and a `figN` bookmark. Keep the caption in the same block so picture and caption do not separate.

## Verify

Render: not stretched, not blurry beyond the source resolution, not clipped at the margin, caption underneath. Alt text is a separate check the render cannot show.

## Pitfalls

- Cropping changes the displayed extent; alt text and size checks still apply.
- A floating `wp:anchor` image can overlap text at any zoom — prefer inline for documents that will be edited.
- Replacing a file in `word/media` keeps the relationship but not the dimensions: the extent is stored separately.
