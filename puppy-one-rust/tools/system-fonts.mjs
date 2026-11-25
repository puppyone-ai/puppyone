// The native app sets every surface in the platform's own faces and bundles
// none. The product bundles Geist (and the Open Sans and PT Serif of two Sub
// Themes); every importer that copies product CSS or resolved tokens passes
// them through `systemFonts`, which drops those faces' @font-face rules and
// names the system stack of the same kind in their place.

export const SYSTEM_SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"';
export const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono"';
export const SYSTEM_SERIF = 'ui-serif, "New York"';

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
