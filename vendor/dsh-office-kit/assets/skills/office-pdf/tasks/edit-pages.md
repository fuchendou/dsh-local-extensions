# Merge, split, reorder, rotate, delete pages

Pages are referenced from a page tree; reordering or removing one changes references, not content. Nothing is re-flowed, so a page moved into a differently sized document keeps its own box and fonts.

## Fast path: `scripts/page_ops.py`

```bash
"<python>" "<skill>/scripts/page_ops.py" --input "<file.pdf>" --out "<file-edited.pdf>" \
  --rotate 90 --pages 0,2 --remove 3 --merge "<other.pdf>" --order 2,0,1
```

- Fixed operation order: merge, then order, then remove, then rotate — a command always means the same thing.
- Indices are zero-based over the combined page list (input pages first, appended pages after).
- `--order` keeps and reorders; unlisted pages are dropped, and a repeated index duplicates it.
- `--remove` drops indices from the list `--order` leaves.
- `--rotate` takes 90, 180, or 270 clockwise and defaults to every remaining page; `--pages` limits it.
- `--out` defaults to `<input>-edited.pdf`; the input is never overwritten.

The script carries content streams over unchanged and reopens the result to report page count, rotation, and page size per page. When one call cannot express the operation, chain two calls into two output files rather than reusing a name.

## Metadata

```bash
"<python>" "<skill>/scripts/metadata.py" --input "<file.pdf>" --set "/Title=Field report" --set "/Author=Ada" --out "<file-edited.pdf>"
```

Keys are the document information fields (`Title`, `Author`, `Subject`, `Keywords`, `Creator`, `Producer`, `CreationDate`, `ModDate`), plain or `/Name`, in any case. The script writes a new file and reopens it; `applied`/`not_applied` show what persisted.

## Split

```bash
"<python>" "<skill>/scripts/split_pages.py" --input "<file.pdf>" --out-dir "<parts>" --ranges "1-2,3,5-"
```

1-based inclusive ranges, or `--every N` for equal chunks; the default is one file per page. The script copies the source metadata, refuses overlapping or out-of-range ranges, and fails when the parts do not add up to the source page count — the check that catches a typo in the range string. `--prefix` sets the filename stem.

## Direct page-tree work

Reorder, duplicate, or delete with pypdf when `page_ops.py` does not fit:

```bash
"<python>" - <<'PY'
from pypdf import PdfReader, PdfWriter
reader = PdfReader("in.pdf")
writer = PdfWriter()
order = [2, 0, 1, 0]            # 0-based; repeat an index to duplicate a page
for index in order:
    writer.add_page(reader.pages[index])
writer.add_metadata({"/Title": "Reordered"})
with open("out.pdf", "wb") as handle:
    writer.write(handle)
print("pages", len(writer.pages))
PY
```

`add_page` copies the page and its resources; annotations pointing across pages (links) can break when their target is removed. After a reorder or deletion, check links and bookmarks on the render, not only the text.

## Rotate

Page `/Rotate` (multiples of 90) is applied by viewers and does not transpose the content stream. `page.rotate(90)` in pypdf, or `page_ops.py --rotate 90 --pages ...`, is enough. A page scanned sideways that also carries a stale `/Rotate` accumulates both — the render shows which one you are looking at, and `scripts/render_pages.py` reports each page's rotation.

## Verify

After any structural edit:

- compare page counts (`pdf read` or the split report) — one missing page is easy to miss in a long render;
- render the first and last page of every part, plus every page you rotated or reordered;
- for merges, confirm appended pages kept their size and orientation, and that page numbers or bates stamps do not collide;
- for deletions of numbered pages, tell the user which numbers were removed, because the remaining page labels shift.

`scripts/render_pages.py --input "<file.pdf>" --region 0,0,1,1 --json-out ...` prints per-page character and drawing counts — a cheap blank-page check before delivery.
