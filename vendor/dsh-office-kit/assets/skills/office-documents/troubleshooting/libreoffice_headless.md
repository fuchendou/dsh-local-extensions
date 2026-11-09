# Rendering setup and failures

## First: does this machine render

```bash
"<python>" "<cli>" status
```

Check `renderers.kit` and `renderers.can_render`. `can_render.docx: false` means `docx render` fails with `the LibreOffice renderer is not available` — a setup problem, not a document problem.

## What renders

Rendering goes through the LibreOffice kit DeepSeek Harness ships (`@deepseek-ai/libreoffice-kit`): the kit's native engine on macOS and Windows, the WASM engine on Linux. A separately installed Microsoft Office, WPS Office or system LibreOffice is **not** used and does not make rendering work.

The plugin records the kit's location when the harness loads it, and the helper reads that record before anything else:

1. `DSH_LIBREOFFICE_KIT_CLI` — an explicit override, also handy for a hand-run helper.
2. `libreofficeKit` in `~/.dsh/office/config.json`. The host half writes it at load, resolving the kit from the harness entry point (`process.argv[1]`, e.g. `<dsh>/node_modules/@deepseek-ai/dsh/lib/bin.js`). This is what makes a profile install work, where the kit lives in the harness tree rather than next to the plugin. Configs that pre-0.5 versions wrote in the OS config directory are still read as fallbacks.
3. Walking up from the plugin directory through `node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js` — covers a checkout or a plugin-local dependency.

`DSH_OFFICE_CONFIG` points the helper at a different config file; `DSH_NODE` overrides the node binary when `node` is not on `PATH`.

## Common failures

| Message | Cause | Fix |
|---|---|---|
| `the LibreOffice renderer is not available` | Kit not found | Load the plugin through the harness (it records the path), or set `DSH_LIBREOFFICE_KIT_CLI` to the kit's `lib/cli.js` |
| `cannot start the LibreOffice kit` / `EEXIST` | Interrupted install, or a stale staging directory | Report the error and ask the operator to inspect the deployment; do not automatically reinstall or delete files |
| `Unsupported LibreOfficeKit host` | Unsupported platform/arch (the kit ships Windows x64/arm64, macOS x64/arm64, Linux via WASM) | Render on a supported host |
| `warning: N font(s) used by this file are not installed` | Font substitution — the render succeeded but that text may reflow or show boxes | Install the font or substitute it deliberately, then re-render |
| Blank pages | Missing font | See the font warning above |
| Text shifted | Font substitution | Compare with a render from the same renderer the user will use |

## Working without a renderer

Structure, text and metadata are verifiable headlessly (`docx read`, the audit scripts, `docx_kit.py parts|text|xml`). Layout is not. In that state:

1. Do the structural verification.
2. Tell the user that page layout was not visually checked, and why.
3. Ask them to fix the kit install, or open the file and say what looks wrong.

Never describe a page you did not render.

## Keep renders disposable

Render into a fresh temp directory each time (`--out-dir`). A stale PNG from an earlier run reads as a pass — the most common false confirmation.
