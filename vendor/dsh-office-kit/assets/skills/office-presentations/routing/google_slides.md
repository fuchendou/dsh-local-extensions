# Handing a deck to Google Slides

Google Slides imports `.pptx` and mostly survives it. What it does not survive
is worth designing around.

## What converts cleanly

- Text frames, bullet levels, speaker notes, slide size and order.
- Native tables and native charts (data comes across with the chart).
- Pictures, shapes, solid fills and theme colours.

## What converts badly

| Feature | What happens | Do instead |
|---|---|---|
| Custom `buChar` glyphs and `marL/indent` | Indent shifts, glyphs fall back | Use plain paragraph levels; check the bullet indent after import |
| Elbow/curved connectors | Re-anchored or detached | Straight connectors between facing sides |
| Font not on the reader's machine | Substituted, wider, text reflows | Stick to fonts both environments have, and re-check overflow after import |
| Text-to-fit-shape autosize | Keeps the shrunk size | Fixed frames with measured text |
| Animations and transitions | Partially dropped | Do not rely on them for meaning |
| Embedded workbook charts | Data retained, formatting re-derived | Re-apply axis/label settings in Slides if they matter |
| Master-level chrome via spTree surgery | Usually kept, occasionally duplicated | Prefer layout-level placeholders |

## The workflow

1. Build the deck as a normal `.pptx` — nothing Slides-specific is needed.
2. Render and inspect the PNGs locally first; fix overflow before importing.
3. Upload to Drive, open with Google Slides, and check in this order: title
   wrapping, bullet indentation, connector attachment, chart axes, notes.
4. If others will edit the deck in Slides, keep shapes distinct and named
   (right-click → rename) so comments and edits are unambiguous.

## Sharing

- "Anyone with the link" plus a view-only role is the default for a deck that
  should not be edited in place.
- Export back to `.pptx` when the user needs a file; Slides' export does not
  preserve everything either, so state which version is authoritative.
- Comments and suggestions do not travel in the `.pptx` round trip.

## When the user asks for a Slides-native link

Deliver the `.pptx` (that is what this pack produces), state the upload path,
and list the three things to check after import: font substitution, bullet
indent, chart axes. Claiming a clean conversion without those checks is a guess.
