# Relationships and content types

A `.docx` is a zip of parts, and every relationship between parts is declared twice: once as a relationship entry, once as a content type. Miss either and the file loses the feature or refuses to open.

## The two registries

```
[Content_Types].xml          # what kind of file each part is
_rels/.rels                  # package -> document, core props
word/_rels/document.xml.rels # document -> styles, numbering, media, header, footer, comments, hyperlinks
```

`[Content_Types].xml` uses `<Default Extension="xml" ContentType="..."/>` for extension defaults and `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` for parts that do not follow an extension rule.

A relationship:

```xml
<Relationship Id="rId5"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
  Target="comments.xml"/>
```

`Id` is scoped to the part that owns the `.rels` file, so `rId5` in the document and `rId5` in a header are unrelated. `Target` is relative to the owner directory unless absolute (`/word/media/image1.png`) or external (`TargetMode="External"`, used for hyperlinks).

## What breaks

| Symptom | Cause |
|---|---|
| Word: "unreadable content" | A part exists but has no content-type override |
| Feature silently ignored | Part and override exist, but no relationship points at it |
| Duplicate header text | Two header relationships, only one referenced by `sectPr` |
| Broken link | Relationship removed but `r:id` left in the body |
| Lost image | Media copied without a new relationship id |

Ids are unique within a `.rels` part. Read the existing ids and take `max+1`; reusing an id silently rewires an unrelated reference.

## The parts that exist only when used

`word/comments.xml`, `word/footnotes.xml`, `word/endnotes.xml`, `word/headerN.xml`, `word/footerN.xml`, `word/numbering.xml`, `docProps/custom.xml` — none are required, and each needs three pieces when added: part, override, relationship. Removing one means removing all three, or Word reports corruption.

Headers and footers are referenced from the section properties, not the document root:

```xml
<w:sectPr>
  <w:headerReference w:type="default" r:id="rId8"/>
  <w:footerReference w:type="default" r:id="rId9"/>
</w:sectPr>
```

## Inspecting

```bash
"<python>" "<skill>/scripts/docx_kit.py" parts '<file.docx>'
"<python>" "<skill>/scripts/docx_kit.py" xml   '<file.docx>' word/_rels/document.xml.rels
"<python>" "<skill>/scripts/docx_kit.py" xml   '<file.docx>' '[Content_Types].xml'
```

`parts` lists what is actually in the package — the fastest way to see whether a feature exists at all. Read the `.rels` part before editing relationships by hand.

## Rebuild rather than regenerate

When a package is broken, unzip it, fix the two registries and rezip with `[Content_Types].xml` first (stored, not deflated). The kit writes that order on save for this reason.
