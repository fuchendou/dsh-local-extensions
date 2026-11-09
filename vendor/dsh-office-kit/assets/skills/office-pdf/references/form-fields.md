# Form field mechanics

## Field tree

`/AcroForm` in the catalog holds `/Fields`, the root field array. A field dictionary has:

- `/T` — partial name; the full name joins ancestor partial names with dots.
- `/FT` — type, inherited: `Tx` text, `Btn` button, `Ch` choice, `Sig` signature.
- `/V` — current value: a string for text; the selected state name (`/Yes`, `/Off`, `/basic`) for buttons; a string or array for choice fields; a dictionary for signatures.
- `/Ff` — inherited flags bitmask: bit 1 (`1`) read-only, bit 2 (`2`) required, bit 13 (`4096`) multiselect, bits 15–17 (`65536`/`131072`/`262144`) button behaviour (no-toggle, radio, pushbutton).
- `/DA` — default appearance string; font and colour an appearance generator uses.
- `/Kids` — child fields or widgets.
- `/AP` — appearance dictionary: `/N` normal, `/R` rollover, `/D` down. For a button, `/N` maps each state name to a form XObject; for text and choice fields, `/N` is one stream.
- `/Rect`, `/P`, `/AS` — widget geometry, owning page, and the state the widget shows.
- `/NeedAppearances` in `/AcroForm` — asks viewers to regenerate appearances; many ignore it, which is why a file can hold a correct `/V` and show nothing.

## What a fill must satisfy

1. Field `/V` equals the requested value in the field's representation (boolean → state name, radio → that button's on-state, choice → string or list).
2. The widget's `/AP /N` exists as a stream or state map with a `/BBox` and `/Resources`, and its content paints the value.
3. The widget's `/AS` names a state present in `/AP /N`; for a radio group, every widget's `/AS` must be the group's chosen state or `/Off`.
4. The value is visible on the page: rendered inside `/Rect`, not clipped, not hidden behind page content.

Updating `/V` alone satisfies 1 and fails 2–4 — the "filled but blank" failure. Rebuilding the appearance with a stale `/AS` satisfies 1–3 and shows two selected radios. Check 1–3 after saving, then render for 4.

pypdf's `update_page_form_field_values(writer, page, values, flags, auto_regenerate, flatten)` handles 1–3 for common field types when the writer cloned the document properly (and `writer.reattach_fields(page)` was called where needed). Button groups need the extra `/AS` synchronisation in `tasks/forms.md`.

## Flattening

Two destructive meanings:

- `flatten=True` in `update_page_form_field_values` paints each widget's current appearance into the page content and removes the interactive field.
- Post-process: remove `/Widget` annotations with `writer.remove_annotations(subtypes="/Widget")` and pop `/AcroForm` from the catalog. On its own this leaves the appearance, so the page looks unchanged while the fields stop responding.

Do both for a non-editable form. Verify zero `/Widget` annotations, no `/AcroForm` in the catalog, and the values still rendered.

## Appearance streams

An appearance stream is a form XObject:

```
/Type /XObject
/Subtype /Form
/BBox [0 0 200 14]
/Resources << /Font << /Helv 5 0 R >> >>
```

`/BBox` is the drawing area in the widget's own coordinates; the widget's `/Rect` maps it onto the page. A generated stream usually sets the font from `/DA`, positions text at a small inset, and clips to `/BBox`. When a field must look right and its appearance is missing, draw a replacement with reportlab at `/Rect` coordinates and merge it into the page — same visual result, without lying about the field value.

## Signature fields

`/FT /Sig` needs a certificate and a signing implementation. Filling text into a signature field, or editing any page of a signed document, breaks the signature. Say so plainly and offer the unsigned rebuild; never present an edited document as signed.

## Choice fields

`/Opt` lists the allowed options; `/V` is the chosen value or values. Single-select takes a string, multi-select an array. A value outside `/Opt` renders blank — validate against `/Opt`, and report the allowed options when the requested value is missing.
