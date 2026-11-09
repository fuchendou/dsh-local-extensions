# AcroForm inspection and filling

A form PDF carries `/AcroForm` in the catalog. `/Fields` holds field dictionaries: `/T` name, `/FT` type, `/V` value, `/Ff` flags, `/DA` default appearance, `/AP` appearance stream. Widgets carry `/Rect`, `/P`, `/AS`, and a widget can be a separate object reached through `/Parent`. Full field mechanics: `references/form-fields.md`. Text in a filled field usually lives in the widget's `/AP /N`, not the page content stream, so "value in `/V`" and "page shows the value" are two different facts.

## Inspect first

```bash
"<python>" "<skill>/scripts/forms.py" inspect --input "<file.pdf>"
```

Reports per field: name, type, value, read-only/required, widget count, pages, button states, and whether each widget has `/AP`. Read it all before touching values: duplicate names, missing appearances, and read-only flags are why a fill "does nothing".

## Fill

```bash
"<python>" "<skill>/scripts/forms.py" fill --input "<file.pdf>" --out "<file-filled.pdf>" --values "<values.json>"
```

```json
{ "full_name": "Ada Lovelace", "email": "ada@example.org", "agree": true, "plan": "/basic" }
```

Text fields take strings; checkboxes booleans or the state name; radio groups the state to select; choice fields a string or list. Keys are field names (`/T`, nested names joined with dots). `--flatten` bakes the values in and drops the form. The script exits non-zero on an unknown name (it never skips silently), a value outside the allowed states, or a saved file that fails the verification below.

## The discipline that makes a fill real

pypdf writes `/V` and rebuilds the widget appearance; a writer can do one without the other, so check both after saving.

1. Reopen the saved file.
2. Read `/V` for every field you set and compare it with the requested value.
3. Confirm every widget has a non-empty `/AP /N` stream with a `/BBox`; for radio and checkbox groups, `/AS` must name a state present in `/AP /N`.
4. Render the page and look at the field.

Steps 1–3 catch a stale or missing appearance; step 4 catches a right `/V` over old text. The script does 1–3 and prints `applied`/`not_applied`; `not_applied` is a failure to fix, not a warning.

By hand:

```bash
"<python>" - <<'PY'
from pypdf import PdfReader
reader = PdfReader("filled.pdf")
fields = reader.get_fields() or {}
root = reader.trailer["/Root"].get("/AcroForm")
for name, field in fields.items():
    widgets = field.get("/Kids") or []
    for widget in widgets:
        states = list((widget.get("/AP", {}).get("/N", {}) or {}).keys())
        print(name, field.get("/V"), widget.get("/AS"), states, "bbox" in str(widget.get("/AP")))
PY
```

Radio groups fail most: pypdf updates the group `/V` but leaves the old button's `/AS`, so two look selected. The script resyncs every widget's `/AS` from the group value; do the same by hand.

## Flatten

Flatten when the file must stay uneditable: fill with `flatten=True` (the value is painted into page content), remove every widget annotation (`subtypes="/Widget"`), and drop `/AcroForm` from the catalog. Then confirm no `/Widget` and no `/AcroForm` remain; otherwise readers still treat the file as editable.

## Non-Latin values

pypdf's appearance writer encodes WinAnsi, so a Chinese, Japanese, or Korean value lands in `/V` but the widget paints `?` or falls back to Helvetica. The script detects non-Latin values, registers a system CJK font (YaHei, WenQuanYi, PingFang, Noto) or the `--font-file` you pass, draws the value with reportlab, and replaces `/AP /N` with that form; the field names it repainted are listed as `cjk_appearance_fields`. `--flatten` paints those streams into the page content before stripping the widgets. Verify `/V` plus the render: the subset font has no ToUnicode map, so a text dump of the appearance is not reliable evidence.

```bash
"<python>" "<skill>/scripts/forms.py" fill --input "<form.pdf>" --out "<filled.pdf>" \
  --values '{"full_name": "张伟"}' --font-file "C:/Windows/Fonts/msyh.ttc" --render-dir "<render>"
```

## What cannot be filled, and the fix

- **No appearance stream and a broken `/DA`**: the reader may not show a new value. Render after filling; if invisible, rebuild that widget's appearance with reportlab and merge it over the page.
- **A signature field (`/FT /Sig`)**: needs a certificate and a signer this runtime does not ship, and text on a signed field invalidates the signature. Say it cannot be created here; it needs a certificate plus a signing tool.
- **Values drawn as static text**: not a form. If `page.get_text()` shows the labels and lines and `reader.get_fields()` is empty, treat it as an edit job.
- **A flat, scanned form**: no field tree; draw text at coordinates (a stamp overlay) and let the render decide whether it lines up.

## Verify

Reopen, check `/V`, check `/AP`, then `"<python>" "<cli>" pdf render --input "<file-filled.pdf>" --out-dir "render"` and `read_image`. The value must be visible inside its widget box, not clipped or over the border.
