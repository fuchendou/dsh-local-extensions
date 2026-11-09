# Comments

Add, read, reply to, resolve or remove review comments. A comment is not text: each is a `w:comment` in `word/comments.xml`, anchored by a `w:commentRangeStart` / `w:commentRangeEnd` pair plus a `w:commentReference` run. Editing the anchor without the comments part, or the reverse, leaves a file Word reports as corrupt.

## Add

```bash
"<python>" "<skill>/scripts/comments_add.py" "<file.docx>" --out "<file-commented.docx>" \
  --author "Review" --add "Renewals=Check the source of this claim" --add "42 new accounts=Who verified this?"
```

Each `--add` is `NEEDLE=COMMENT`, matched inside a paragraph; the anchored range covers exactly the matched text, so pick a distinctive phrase. `--ignore_case` relaxes matching; `--require_all` writes nothing and exits 1 if any needle is missing — for comment sets that must be complete.

## Extract

```bash
"<python>" "<skill>/scripts/comments_extract.py" "<file.docx>" --out "<comments.json>"
```

Returns `id`, `author`, `initials`, `date`, `text`, `anchored_text`, `part` and `resolved`. An empty array means the file has no comments; do not assume they exist because the user mentioned them.

## Patch or resolve

```bash
"<python>" "<skill>/scripts/comments_apply_patch.py" "<file.docx>" "<patch.json>" --out "<file-patched.docx>"
```

```json
{
  "ops": [
    { "id": 1, "append": "Confirmed against the ledger." },
    { "id": 2, "replace": "Resolved: revenue restated in Q3." },
    { "id": 1, "resolved": true }
  ]
}
```

`replace` rewrites the comment's first paragraph, `append` adds a paragraph, `resolved` sets the `w15:done` flag. The command exits 1 and names the ids it could not find.

## Remove

```bash
"<python>" "<skill>/scripts/comments_strip.py" "<file.docx>" --out "<file-clean.docx>"
```

Removes every anchor and drops `word/comments.xml` with its relationship and content-type override. Required before sharing a file with a customer; see also `privacy_scrub_metadata.md`.

## Verify

`comments_extract.py` on the output (count and anchors), then render the page the comment sat on: a stripped anchor that leaves an empty run can show as a stray space.

## Pitfalls

- A comment anchored to a paragraph mark rather than to text shows no `anchored_text` — normal for "comment on the whole paragraph".
- Two comments cannot share an id; `comments_add.py` continues from the highest existing id.
- The body is ordinary paragraphs, so a long comment can hold several; `comments_extract.py` joins them with newlines.
- Threaded replies need Word's `commentsExtended` part; anchoring a new comment on the same phrase is the portable equivalent.
