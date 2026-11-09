---
description: Create, extract, fill forms in, merge, split, redact, stamp, render, and verify PDF files with the bundled Office helper CLI and Python scripts.
---

# PDF

A PDF page is a content stream of text and path operators behind a page box. Every job here reads that stream (PyMuPDF, pdfplumber, pypdf), writes a new one (reportlab), or rasterises it to check the result. Inspect first, make the smallest change that satisfies the request, then prove it on a render.

| User job | Fast path |
| --- | --- |
| Look at a page, crop, or measure geometry | `scripts/render_pages.py`, `pdf render` |
| Extract text, tables, or page images | `scripts/extract_text.py`, `pdf read`, `tasks/read.md` |
| Inspect or fill an AcroForm | `scripts/forms.py`, `tasks/forms.md` |
| Remove a region (redaction) | `scripts/redact_region.py`, `tasks/redact.md` |
| Read or rewrite metadata (info dictionary only, never page content) | `scripts/metadata.py`, `tasks/edit-pages.md` |
| Merge, split, reorder, rotate, delete pages | `scripts/page_ops.py`, `scripts/split_pages.py`, `tasks/edit-pages.md` |
| Stamp a footer, header, or label | `scripts/stamp_overlay.py`, `tasks/stamp.md` |
| Build a new document | `pdf create`, `tasks/create.md` |
| Resolve an `office-annotations` region | `tasks/annotations.md` |
| Decide what a PDF cannot do | `references/limits.md` |

Each task file explains the mechanism before giving the command. `references/geometry.md` covers page boxes and normalised regions, `references/layout-quality.md` is the pre-delivery visual checklist, and `references/form-fields.md` covers field flags, appearance streams, and flattening.

## Before any file work

1. Call the `office_status` tool.
2. Read the runtime block appended to this file at runtime; use its `python`, `cli`, `skill`, and `shared` values verbatim, quoted: `"<python>"`, `"<cli>"`, `"<skill>/scripts/<name>.py"`.
3. If that block reports no working runtime, stop and report the diagnostic and deployment-document remedy. Do not install dependencies automatically or fabricate a PDF result you could not verify.

Scripts under `"<skill>/scripts/"` are standalone argparse CLIs. Run `<python> <script> --help` before using one you have not called in this session.

## Route selection

Decide the route before you type a command. Every route ends in the same render check.

- **No file yet** → create it from a `pdf create` spec, or with reportlab when the layout does not fit the block model (`tasks/create.md`).
- **Existing file to change** → read it first (`pdf read`, plus a render), then mutate it with the script its task file names. The CLI has no edit verb: it creates, reads, renders, and reports status only, so every change is a `scripts/*.py` call.
- **A script covers the job** → run it, then check its JSON report and its rendered pages. A refused overwrite or a failed self-check exits non-zero: that is a hard stop.
- **A read/render verb covers it** → `pdf read`, `pdf render`, or `pdf status`, then verify in the task's own way. Never route a mutation through the CLI.
- **Neither covers it** → run or adapt the snippet in the matching `tasks/*.md` file. Do not invent a CLI verb, and do not call the job impossible because no verb exists.
- **Take the smallest operation**: metadata change before rebuild, page move before re-creation, one-line patch before re-typing the page.

## Failure handling

| Symptom | Meaning | Next step |
| --- | --- | --- |
| `encrypted` in the error | The file needs a password | Ask the user for a decrypted copy. Do not guess passwords or write one into a command. |
| `leftover_chars_in_rect` greater than 0 | The redaction rectangle missed text | Enlarge `--pad` or reconvert the region; re-render before delivering. |
| `not_applied` is not empty | A form value did not persist after save | Treat as a failure: check the field name, its allowed states, and the widget's appearance stream. |
| `chars: 0` on a page that shows text | Scanned page, no text layer | Say so; follow `references/limits.md`. Never return an empty extraction as success. |
| Render shows the change, `pdf read` does not | The edit landed in pixels only | Fix the content stream or note the limitation. A visible-only change is usually a cover-up, not an edit. |

General CLI failures, missing runtimes, and the `the LibreOffice renderer is not available` result are covered by `"<shared>/common-workflow.md"`; `pdf render` never needs LibreOffice.

## Quality rules

- One heading scale, one body size, one margin system per document (`references/layout-quality.md`).
- Prove every structural change on a render of the changed page, not on a text dump.
- Keep page geometry consistent when merging or stamping: use each page's own box.
- Never claim redaction while the words are still extractable.
- Mark deliberate shortcuts (a rebuild instead of a reflow, a stamped patch instead of a content edit) in the reply.

## Delivery

Hand the finished file to the user with the `present` tool, then one sentence on what changed. A bare path is not delivery: the transcript renders `.docx`/`.pptx`/`.xlsx`/`.pdf` links as "二进制文件，无法显示改动", so the user cannot open them.

- Creating a file: write it into the user's workspace, verify it, then `present`.
- Editing an existing file: never overwrite the original. Write `<original>-edited.<ext>` (or a name the user asked for), verify it, `present` it, and state both paths.

## Annotations

An `office-annotations` reply is a change request, not editor state: `[{ page, text, requirement, region: { left, top, width, height } }]`. `region` is normalised 0–1 against the rendered preview page the user drew on; `requirement` is free-form. Locate what the region covers, apply the smallest edit that satisfies `requirement`, re-render, confirm the region looks right, and say what you could not locate rather than guessing.

For PDF, `page` is the 1-based page of the file, and `region × page.rect` is the real rectangle: convert once with PyMuPDF and work in the device rect; `text` wins over the region when they disagree, and `imageName`, when present, is a screenshot of the marked area to open with `read_image`. Full recipe: `tasks/annotations.md`, payload shapes: `"<shared>/annotation-recipes.md"`.

## Verify

Render before you present, and again after every fix:

```bash
"<python>" "<cli>" pdf render --input "<file.pdf>" --out-dir "<render-dir>" --dpi 110
```

Open each PNG with `read_image` and compare it with the pre-change render, working through `references/layout-quality.md`. Then run `"<python>" "<cli>" pdf read --input "<file.pdf>"` and confirm the text, page count, and form fields match your edit. Two or three passes are normal; past three, say what still looks wrong instead of calling it fixed.

## Shared workflow

Follow `"<shared>/common-workflow.md"` for the create-or-edit decision, the failure ladder, and the edit naming rule, and `"<shared>/annotation-recipes.md"` for the payload shapes the client sends.
