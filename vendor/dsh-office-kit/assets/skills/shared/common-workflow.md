# Shared workflow

Every format pack follows this loop. The helper CLI is an accelerator, not the
boundary: the format router adds spec keys and commands; the order, checks, and
failure handling below are the same.

## 0. Read the runtime block first

Call `office_status`, then read the `## Office runtime` section appended to the
active `SKILL.md`. It is a fenced JSON block:

```json
{ "python": "...\\python.exe", "cli": "...\\python\\office_cli.py", "skill": "...\\assets\\skills\\office-documents", "shared": "...\\assets\\skills\\shared", "version": "3.13.12" }
```

- `python` and `cli` are verified absolute paths. Use them verbatim and quote
  them. Never call a bare `python`, `py`, or `pdftoppm`.
- `skill` is the format pack; its scripts live under `<skill>/scripts/`,
  `container_tools/` (pptx, xlsx), or the pack root.
- `shared` is this directory (cross-format workflow, recipes, shared scripts).
- A missing block plus *No working Python runtime is available* means stop: run
  no helper command and fabricate no document.

`office_status` reports `runtime.state`, `python`, `cli`, `packages`, and the
kit `renderers` facts (`available`, `backend`, `remedy`). Use it when a command
fails. `<cli> status` additionally reports `can_render` per format.

## 1. Decide: create or edit

- No existing file → create, in the user's workspace unless they name a location.
- Existing file → edit. **Never write over the original.** Write
  `<original>-edited.<ext>` beside it (or the name the user asked for):
  `report.docx` → `report-edited.docx`.
- "Improve this document" means read it first (`read` verb) and edit the real
  content; do not rebuild it and drop its formatting.
- Never delete the original or "clean up" a temp copy over it. State both paths
  in the final summary, original first.

## 2. Read, choose a route, change

Read the file first (`read` verb), then take the cheapest route that works:

1. **CLI verb** — the common case. Spec-driven; prints one JSON object on stdout.
   Failures print `{ "ok": false, "error": "..." }` on stderr and exit non-zero.

   ```bash
   "<python>" "<cli>" docx|pptx|xlsx|pdf create --spec "<spec.json>" --out "<file>"
   "<python>" "<cli>" docx|pptx|xlsx|pdf read   --input "<file>"
   "<python>" "<cli>" docx|pptx|xlsx|pdf render --input "<file>" --out-dir "<render-dir>"
   "<python>" "<cli>" xlsx recalc --input "<file>" --out "<file>"
   ```

   There is no `edit` verb: mutation belongs to a pack script or a snippet.
   Write the spec as a JSON file in the workspace; quote absolute paths.
   `xlsx read` accepts `--data-only`; `create` (except `pdf`), `read`, `render`,
   and `xlsx recalc` accept `--json-out <path>`.

2. **Pack script** — a specialised job the CLI has no verb for. Use the script
   named by the format router (`<skill>/scripts/`, `container_tools/` for
   pptx/xlsx, or the pack root). Scripts are argparse-based, support `--help`,
   take absolute paths, and run with the same `"<python>"`.

3. **Library snippet** — the long tail. When neither covers the change, write a
   small runnable script in the workspace with the installed libraries
   (`python-docx`, `openpyxl`, `python-pptx`, `pypdf`, `PyMuPDF`, `reportlab`,
   `pdfplumber`), run it with `"<python>"`, then verify through the render step.
   Keep it small; keep the original untouched.

Never say "the CLI does not support this, so it cannot be done". A missing verb
is a missing shortcut, not a missing capability: use the script or library
route, run it, and verify the result.

`check_runtime.py` validates the interpreter: it imports every package in
`python/requirements.txt` and runs `<cli> status`. Non-zero means a broken
environment, not a bad spec.

## 3. Render and look

```bash
"<python>" "<cli>" docx render --input "<file>" --out-dir "<render-dir>"
```

Output is `<render-dir>/page-1.png`, `page-2.png`, ... at `--dpi` (default 110).
For docx/pptx/xlsx, add `--pdf` to also keep `<render-dir>/<stem>.pdf`; use that
PDF for annotation geometry. `pdf render` uses PyMuPDF and needs no external
renderer.

Open every page with `read_image`. Check for: text overflowing or clipped at
margins, overlapping shapes, unexplained blank pages, tables spilling past the
page, fonts replaced by boxes, missing chart/table content, numbers that do not
match the request.

Present only after the pages look right.

## 4. Fix, re-render, present

Change the spec or script, re-run the same command, re-render, look again. Two
or three passes is normal. If a problem survives three passes, say what still
looks wrong instead of pretending it is fixed.

Then call `present` with the final file and reply with one sentence about what
changed. For an edit, give the original path and the edited path.

## Rasterizing art

Documents, decks, and workbooks embed raster images only. Convert an SVG or one
PDF page to PNG first; the same call downscales an oversized raster.

```bash
"<python>" "<shared>/scripts/ensure_raster_image.py" --input "<art.svg>" --dpi 300 --out "<art.png>"
"<python>" "<shared>/scripts/ensure_raster_image.py" --input "<deck.pdf>" --page 2 --width 1600 --out "<slide-2.png>"
```

It prints one JSON object with the PNG `width`/`height` and never overwrites the
input. Open the PNG with `read_image` before embedding: a blank, clipped, or
miscoloured raster is invisible inside the host file.

## Failure ladder

| Symptom | Meaning | What you do and say |
| --- | --- | --- |
| No `## Office runtime` JSON; skill says *No working Python runtime is available* | No usable or installable interpreter | Do not run helper commands or write a document by hand. Give the user the remedy command from the skill body, ask them to run it, then call `office_status` again. |
| `office_status` shows `cli.exists: false`, or the `python`/`cli` path is missing | The bundled helper or its install is incomplete | Report the missing path. Do not substitute another tool that writes a different file. |
| `render` fails: `the LibreOffice renderer is not available` | The DSH LibreOffice kit was not found. create/read/scripts still work; docx/pptx/xlsx cannot rasterise | Do not claim you inspected it. Say the file was built and validated structurally, but could not be checked visually. The kit ships with DeepSeek Harness and the plugin records its path in `config.json`; a missing kit or a bad `DSH_LIBREOFFICE_KIT_CLI` causes this. A standalone LibreOffice/Office/WPS install does not help. `pdf render` still works. Offer a rebuild from spec or an unverified file labelled as such. |
| Region lands on nothing, or the payload says `unmapped: true` | The region cannot be tied to an object in the file | Do not shift the region or guess a cell/shape. Say what you identified and what you could not, then ask for the text or cell. |
| `{"ok": false, "error": "..."}` plus non-zero exit | The spec was rejected (unknown key, bad type, missing file) | Read the error, fix the named spec key, re-run. Never delete a failing block to make the command pass — that silently deletes user content. |
| `xlsx recalc` fails: kit missing | openpyxl cannot evaluate formulas; the kit is the only calculation engine | Report formula cells as uncalculated; never invent computed values. Fix the renderer and re-run. |
| No verb for the requirement | The common path is short, not the capability | Take the pack-script or library route, run it, `read` the file back, and render. Never refuse a job because a verb is missing. |
| `read` returns an empty structure for a supplied file | Unsupported or corrupt input | Say what failed and stop. Never overwrite the user's file with an empty one. |
