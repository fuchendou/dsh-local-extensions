# Eliciting a template

A user who says "use our house style" has a file somewhere. One question gets it; guessing produces a document that has to be redone.

## Ask for the artefact, not the description

A description ("blue headings, maybe 11pt") produces a different document every time. The artefact (`house-template.dotx`, an old `.docx` of the same kind, a PDF of the last report) carries the actual styles, margins and fonts.

> Is there an existing document in this style I should match? Send the file (`.dotx`, or any `.docx` in that style) and I will follow it exactly.

With no file, ask for two or three specifics that cannot be guessed and take the rest from `SKILL.md` defaults:

- page size and margins, if the organisation is not US Letter,
- heading and body typeface and sizes,
- anything required by policy (logo in the header, classification mark in the footer).

## Read the template before using it

```bash
"<python>" "<cli>" docx read --input "<template.docx>"
"<python>" "<skill>/scripts/docx_kit.py" xml '<template.docx>' word/styles.xml
"<python>" "<skill>/scripts/section_audit.py" "<template.docx>"
```

From `styles.xml`, note the `styleId` of what will be used: `Heading1`..`Heading3`, `Title`, `Caption`, `Quote`, `ListParagraph`. From the section audit, record page size, margins, header and footer text, and whether the first page is different.

## Apply it

```bash
"<python>" "<skill>/scripts/apply_template_styles.py" --template "<template.docx>" --target "<draft.docx>" --out "<styled.docx>"
```

Merges style definitions (and numbering) by id; the body content is untouched, so anything written with direct formatting keeps it. Then:

```bash
"<python>" "<skill>/scripts/style_normalize.py" "<styled.docx>" --out "<styled-final.docx" --clear_paragraph_format --enforce_heading_spacing
```

The text now picks up the template's look instead of the draft's.

## When the template is a PDF or an image

Extract structure, not styles: heading hierarchy, section order, table layout, caption convention, margin proportions. Reproduce them with named styles in a generated document. Say which parts were matched approximately — a PDF does not reveal a heading's font size, only how it looks.

## When there is no template and no details

Fall back to the `SKILL.md` defaults (Letter, 1in margins, 11–12pt body, black headings, `#D9D9D9` table borders) and state the assumption in one line with the delivered file. Do not stall on a question the user may not care about.
