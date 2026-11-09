# Splitting a long job

A twenty-section document is not one command. Bounded steps keep each change verifiable and stop one failure hiding inside a large edit.

## One step per structural change

1. **Plan** — the outline (headings and what each section must establish), written down before any file work.
2. **Skeleton** — the file with the outline only: heading blocks, no body text.
3. **Content, in batches** — one batch per top-level section, appended with `append_blocks.py`.
4. **Numbers** — captions, cross-references and TOC once the structure is final, never while sections are still moving.
5. **Verify** — render, inspect, fix.

## Why this order

- Captions and TOC are fields over structure; running them after every batch means renumbering noise and a TOC pointing at deleted headings.
- A one-section batch is small enough to redo when the layout is wrong.
- The skeleton proves the hierarchy before the text makes changing it expensive.

## Batch boundaries

- One section per file — `section-01.docx`, `section-02.docx` — then `merge_docx_append.py`. This is the only sane way to draft in parallel or across sessions.
- Keep a `manifest.json` listing the section files in order, so merging is mechanical and the order is not remembered from chat.
- Merge before numbering, not after.

## When a batch fails

Do not patch a large edit inside a large document. Discard the failed batch's output, fix the batch, re-apply it to the previous good file, and keep that good file until the batch is verified.

## Context hygiene

- Long sessions lose the document design. Keep the plan and the design defaults (page size, font sizes, table borders) in a workspace file and re-read it instead of trusting recollection.
- When the user changes a decision mid-job (page size, heading style), record it where they said it and apply it to batches already written.

## Smoke test after the join

`examples/end_to_end_smoke_test.md` is the checklist to run on the merged file before it becomes a deliverable.
