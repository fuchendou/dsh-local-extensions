import { ANNOTATION_CURSOR, OFFICE_NS, OFFICE_STYLE_ID } from './constants'

/** One plugin-scoped style tag; the disposer owns removal. */
export function mountOfficeStyles(): () => void {
  if (typeof document === 'undefined')
    return () => {}

  const style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${OFFICE_STYLE_ID}"]`) ?? document.createElement('style')
  style.dataset.plugin = OFFICE_NS
  style.dataset.pluginCss = OFFICE_STYLE_ID
  style.textContent = `
.dsh-office-ref {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: calc(20px + var(--dsh-content-font-delta, 0px));
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  line-height: 1;
  vertical-align: baseline;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-office-ref[data-interactive] { cursor: pointer; }
.dsh-office-ref[data-interactive]:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
  color: var(--dsw-alias-label-primary);
}
.dsh-office-ref[data-interactive]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-office-ref-icon { flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-office-ref[data-interactive]:hover .dsh-office-ref-icon { color: inherit; }
.dsh-office-annotate { display: inline-flex; flex: none; }
.dsh-office-annotate,
.dsh-office-annotation-reference { font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif); }
.dsh-office-annotate *,
.dsh-office-annotation-reference * { box-sizing: border-box; }
.dsh-office-annotate button,
.dsh-office-annotation-reference button {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  padding: 5px 9px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.dsh-office-annotate button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-office-annotate button:hover:not(:disabled),
.dsh-office-annotation-reference button:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }
.dsh-office-annotate button:focus-visible,
.dsh-office-annotation-reference button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh-office-annotate .dsh-office-annotate-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 8px;
  line-height: 1;
}
.dsh-office-annotate .dsh-office-annotate-toggle[aria-pressed="true"],
.dsh-office-annotate .dsh-office-annotate-primary {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-base));
}
.dsh-office-annotate .dsh-office-annotate-surface {
  position: fixed;
  z-index: 40;
  touch-action: none;
  user-select: none;
  outline: none;
  cursor: ${ANNOTATION_CURSOR};
}
.dsh-office-annotate .dsh-office-annotate-highlight {
  position: fixed;
  z-index: 41;
  box-sizing: border-box;
  pointer-events: none;
  border: 1.25px solid var(--dsw-alias-state-business-primary);
  border-radius: 3px;
}
.dsh-office-annotate .dsh-office-annotate-highlight[data-selected="true"] {
  border-style: dashed;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);
}
.dsh-office-annotate .dsh-office-annotate-composer {
  position: fixed;
  z-index: 42;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
}
.dsh-office-annotate .dsh-office-annotate-composer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
}
.dsh-office-annotate .dsh-office-annotate-composer input:focus-visible { outline: none; }
.dsh-office-annotate .dsh-office-annotate-composer input {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 999px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.dsh-office-annotate .dsh-office-annotate-composer button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, var(--dsw-alias-bg-base));
}
.dsh-office-annotate .dsh-office-annotate-composer button svg { width: 14px; height: 14px; }
.dsh-office-annotate .dsh-office-annotate-rail-position {
  position: fixed;
  z-index: 42;
  display: flex;
  justify-content: center;
  padding: 0 8px;
  pointer-events: none;
}
.dsh-office-annotate .dsh-office-annotate-rail {
  position: relative;
  width: max-content;
  max-width: 100%;
  padding: 4px 6px;
  border-radius: 10px;
  background: var(--dsw-alias-toast-bg);
  color: var(--dsw-alias-toast-label);
  font: 500 12px/18px var(--dsw-font-family, system-ui, sans-serif);
  box-shadow: var(--dsw-shadow-lv3);
  pointer-events: auto;
}
.dsh-office-annotate .dsh-office-annotate-rail-actions { display: flex; align-items: center; justify-content: center; gap: 4px; }
.dsh-office-annotate .dsh-office-annotate-rail-actions > button,
.dsh-office-annotate .dsh-office-annotate-summary > button {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
}
.dsh-office-annotate .dsh-office-annotate-summary { padding-right: 4px; border-right: 1px solid color-mix(in srgb, var(--dsw-alias-toast-label) 25%, transparent); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > button:hover:not(:disabled),
.dsh-office-annotate .dsh-office-annotate-summary > button:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-toast-label) 12%, transparent); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > .dsh-office-annotate-primary { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-toast-label); }
.dsh-office-annotate .dsh-office-annotate-rail-actions > .dsh-office-annotate-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 85%, var(--dsw-alias-toast-label)); }
.dsh-office-annotate .dsh-office-annotate-rail p { max-width: min(360px, calc(var(--dsh-office-annotation-width) - 48px)); margin: 0 0 6px; font-size: 12px; overflow-wrap: anywhere; }
.dsh-office-annotate .dsh-office-annotate-popover {
  display: none;
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: min(320px, calc(var(--dsh-office-annotation-width, 100vw) - 16px), calc(100vw - 16px));
  box-sizing: border-box;
  padding-bottom: 8px;
  transform: translateX(-50%);
}
.dsh-office-annotate .dsh-office-annotate-summary:not([data-dismissed="true"]):is(:hover, :focus-within) > .dsh-office-annotate-popover { display: block; }
.dsh-office-annotation-reference { display: inline-block; position: relative; max-width: 100%; vertical-align: baseline; font: inherit; }
.dsh-office-annotation-reference > button {
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-link);
  font: inherit;
  font-family: var(--dsw-font-markdown-code-font-family);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: baseline;
}
.dsh-office-annotation-reference > button:hover {
  background: transparent;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.dsh-office-annotation-reference .dsh-office-annotation-popover {
  display: none;
  position: fixed;
  z-index: 44;
  inset: auto;
  width: min(320px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  box-sizing: border-box;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  overflow: visible;
  text-align: left;
  font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif);
}
.dsh-office-annotation-reference .dsh-office-annotation-popover[data-open="true"] { display: block; }
.dsh-office-annotation-reference .dsh-office-annotation-popover::backdrop { pointer-events: none; }
.dsh-office-annotate .dsh-office-annotate-popover > ul,
.dsh-office-annotation-reference .dsh-office-annotation-list {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: min(340px, 45vh);
  margin: 0;
  padding: 0 8px;
  font: 400 12px/18px var(--dsw-font-family, system-ui, sans-serif);
  text-align: left;
  overflow: auto;
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv2);
}
.dsh-office-annotate .dsh-office-annotate-popover > ul { max-height: min(340px, 45vh, max(40px, calc(var(--dsh-office-annotation-height, 100vh) - 80px))); }
.dsh-office-annotate .dsh-office-annotate-popover li,
.dsh-office-annotation-reference .dsh-office-annotation-item { display: flex; flex: none; flex-direction: column; gap: 3px; min-width: 0; padding: 8px 0; }
.dsh-office-annotate .dsh-office-annotate-popover li > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-office-annotate .dsh-office-annotate-popover .dsh-office-annotation-requirement { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-office-annotate .dsh-office-annotate-popover li + li,
.dsh-office-annotation-reference .dsh-office-annotation-item + .dsh-office-annotation-item { border-top: .5px solid var(--dsw-alias-border-l3); }
.dsh-office-annotate .dsh-office-annotation-source,
.dsh-office-annotation-reference .dsh-office-annotation-source { display: flex; align-items: baseline; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-office-annotation-reference .dsh-office-annotation-source button { padding: 0; border: 0; color: var(--dsw-alias-state-business-primary); text-align: left; }
.dsh-office-annotate .dsh-office-annotation-source > :first-child,
.dsh-office-annotation-reference .dsh-office-annotation-source > :first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-office-annotate .dsh-office-annotation-source > :not(:first-child),
.dsh-office-annotation-reference .dsh-office-annotation-source > :not(:first-child) { flex: none; }
.dsh-office-annotate .dsh-office-annotation-original,
.dsh-office-annotation-reference .dsh-office-annotation-original { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-office-annotate .dsh-office-annotation-requirement,
.dsh-office-annotation-reference .dsh-office-annotation-requirement { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
`
  document.head.appendChild(style)
  return () => style.remove()
}
