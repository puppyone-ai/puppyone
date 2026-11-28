// The native app's fonts live in one file, assets/typography/fonts.json.
// The product bundles Geist (and the Open Sans and PT Serif of two Sub
// Themes); every importer that copies product CSS or resolved tokens passes
// them through `systemFonts`, which drops those faces' @font-face rules and
// names the configured stack of the same kind in their place. After editing
// fonts.json, re-run: import-theme-contract.mjs, import-html-visual.mjs,
// import-app-preview.mjs, import-office-viewer.mjs,
// import-structured-viewers.mjs, import-render-service.mjs and
// `electron tools/import-editor-theme.mjs [--csv]` (each `--check` fails
// until then). Web views do not load files fonts.json bundles; they draw the
// next family of the stack.
import {readFileSync} from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../assets/typography/fonts.json', import.meta.url), 'utf8'));
const css = (stack) => stack.map((name) => (name.includes(' ') ? `"${name}"` : name)).join(', ');

export const SYSTEM_SANS = css(config.faces.sans.stack);
export const SYSTEM_MONO = css(config.faces.mono.stack);
export const SYSTEM_SERIF = css(config.faces.serif.stack);

const FACES = [
  ['Geist Sans', SYSTEM_SANS],
  ['Geist Mono', SYSTEM_MONO],
  ['PuppyOne Open Sans', SYSTEM_SANS],
  ['PuppyOne PT Serif', SYSTEM_SERIF],
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `css` (a stylesheet or a resolved `font-family` value) without the bundled faces. */
export function systemFonts(css) {
  let out = css;
  for (const [face, stack] of FACES) {
    const name = escape(face);
    out = out
      .replace(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*(["']?)${name}\\1\\s*;[^}]*\\}\\s*`, 'g'), '')
      .replace(new RegExp(`(["'])${name}\\1`, 'g'), stack);
  }
  return out;
}

/** Every string inside `value` (resolved token JSON) through [`systemFonts`]. */
export function systemFontsDeep(value) {
  if (typeof value === 'string') return systemFonts(value);
  if (Array.isArray(value)) return value.map(systemFontsDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, systemFontsDeep(item)]));
  }
  return value;
}
