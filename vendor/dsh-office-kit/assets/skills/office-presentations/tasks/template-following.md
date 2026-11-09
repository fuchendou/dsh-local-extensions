# Task: follow a supplied template

Use this when the user hands over a `.pptx` and says "use our template" or "match
this deck". The design is decided; put content into its own slides.

## 1. Inspect

```bash
"<python>" "<skill>/template_following_scripts/inspect_template_deck.py" --template brand.pptx --out-dir template-inspect
```

- `template-inspect.ndjson` — one JSON line per slide: layout name, layout
  placeholders, slide placeholders (index, kind, rect in inches, text), shape
  counts, text excerpt, full-bleed background art flag.
- `template-manifest.json` — slide size, aspect ratio, layout names, theme font
  names, `backgroundArtSlides`.

Read `backgroundArtSlides` first: those slides already carry artwork, so a new
opaque panel covers it.

## 2. Plan

Write `frame-map.json`:

```json
{
  "template": "brand.pptx",
  "newPrimitives": { "allowed": false, "justification": "" },
  "outputSlides": [
    {
      "slide": 1,
      "mode": "duplicate-slide",
      "sourceSlide": 1,
      "elements": [
        {
          "elementId": "title",
          "action": "fill-placeholder",
          "target": { "placeholder": "title", "text": "Automation Review" }
        },
        {
          "elementId": "subtitle",
          "action": "fill-placeholder",
          "target": { "placeholder": "subtitle", "text": "Warehouse network · FY2026" }
        }
      ]
    },
    {
      "slide": 2,
      "mode": "duplicate-slide",
      "sourceSlide": 3,
      "elements": [
        {
          "elementId": "title",
          "action": "rewrite",
          "target": { "placeholder": "title", "text": "Throughput rose while touches fell" }
        }
      ]
    }
  ]
}
```

Allowed actions: `rewrite`, `rewrite-and-reposition`, `replace`, `delete`,
`keep`, `fill-placeholder`. `target.zone` is `[x, y, w, h]` in 0–1 slide
fractions, used with `rewrite-and-reposition`. Elements whose `role` is `brand`,
`logo`, `bumper`, `divider`, `section`, `chrome` or `footer` must stay `keep` —
they are the template.

New shapes are opt-in: set `newPrimitives.allowed` and justify it. The validator
rejects additions without that, because "one extra box" is how a branded deck
stops matching brand.

## 3. Validate

```bash
"<python>" "<skill>/template_following_scripts/validate_template_plan.py" --plan frame-map.json
```

Rejects unknown action, edited preserved role, zone outside 0–1, non-sequential
slide numbers, missing justification for new primitives, and duplicate source
slides (a warning: shared artwork — fine for a repeated divider, usually a
copy-paste mistake otherwise).

## 4. Build

```bash
"<python>" "<skill>/template_following_scripts/prepare_template_starter_deck.py" --template brand.pptx --plan frame-map.json --out starter.pptx
```

Keeps only the mapped source slides in plan order and applies the actions. It
refuses duplicate source slides (reuses slides rather than cloning parts). The
report lists applied actions and any empty placeholder. Extend with
`container_tools/add_slides.py` or the recipes when the template has no family
for a slide you need.

## 5. Check fidelity

```bash
"<python>" "<skill>/template_following_scripts/check_template_fidelity.py" --template brand.pptx --final starter.pptx --plan frame-map.json
"<python>" "<skill>/container_tools/template_source_fidelity_gate.py" --template brand.pptx --final starter.pptx --requirements fidelity.json
```

`fidelity.json`:

```json
{
  "reference_slide_indices": [1, 3],
  "mapping": { "1": 1, "2": 3 },
  "minimum_coverage_ratio": 1.0,
  "require_exact_dimensions": true,
  "require_placeholder_geometry": true,
  "require_photographic_background": false,
  "geometry_tolerance_emu": 9144
}
```

Both print `passed`. No requirements → deliberate no-op pass: pass a file or you
have checked nothing.

## 6. Look at it

```bash
"<python>" "<skill>/container_tools/render_slides.py" --input starter.pptx --out-dir starter-preview
```

Compare with the source slides: this catches an overflowed placeholder, a title
in the wrong family, a panel over the corner logo.
