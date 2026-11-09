# Working from a supplied template

A template already answers branding, type scale, slide families and chrome. Put
the user's content into the template's own slides and leave the design alone;
rebuilding the look from a screenshot produces a near-miss that reads as "someone
remade our deck in a hurry".

## Order of operations

Commands, JSON shapes and gate flags: [tasks/template-following.md](../tasks/template-following.md).
This file is the reasoning behind that procedure.

1. **Inspect** with `inspect_template_deck.py`. It writes
   `template-inspect.ndjson` (per slide: layout, placeholders with index, kind,
   rect and text, background art) and `template-manifest.json` (slide size,
   aspect, layout names, theme fonts, which slides carry full-bleed art).
2. **Choose the families** you need — cover, section, content, table, chart,
   closing. Take the *fewest* source slides that cover those roles.
3. **Write the frame map**: a JSON plan naming, per output slide, the source
   slide it duplicates and what happens to each element (`rewrite`,
   `rewrite-and-reposition`, `fill-placeholder`, `replace`, `delete`, `keep`).
4. **Validate** with `validate_template_plan.py`: it rejects unknown actions,
   out-of-range zones, new primitives without an explicit justification, and any
   attempt to edit a brand or chrome element.
5. **Build** the starter deck with `prepare_template_starter_deck.py`: only the
   slides you kept, in your order, with placeholders filled. Extend it with
   `container_tools/add_slides.py` and the recipes.
6. **Check fidelity** with `check_template_fidelity.py` and
   `template_source_fidelity_gate.py`. Leftover placeholders, drifted layout rects
   and opaque panels covering inherited artwork are failures, not style opinions.

## Reading a template's own geometry

`container_tools/inspect_presentation_layout_geometry.py --input brand.pptx`
prints every shape's rect in inches — what you address when a placeholder needs a
value that fits its frame.

## Rules

- Placeholders keep their index; fill by index rather than adding a textbox on
  top of a placeholder.
- Never restyle the master to match a screenshot. If the brand colours are wrong,
  ask; guessing produces a deck the brand team rejects.
- If the template has no suitable family for a slide (say, a two-column
  comparison), say which family you added and why rather than silently inventing
  a look.
- Keep the template's slide size. Changing it invalidates every inherited rect.
