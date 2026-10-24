// Shared CSS custom-property resolution for the native asset importers.
// Resolves var() (with fallbacks) and color-mix(in srgb, …) using premultiplied
// alpha, exactly as the browser does for the product themes.

export function blockFrom(text, selector) {
  const start = text.indexOf(selector);
  if (start < 0) return '';
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  throw new Error(`unterminated ${selector}`);
}

export const declarations = (text) => Object.fromEntries(
  [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

/** The `@puppyone application` light and dark declaration blocks of a sub-theme. */
export function applicationBlocks(css) {
  const app = blockFrom(css, '@puppyone application');
  return { light: declarations(blockFrom(app, ':root')), dark: declarations(blockFrom(app, '.dark .theme-root')) };
}

/** tokens.css semantic aliases that feature CSS reads instead of primitives. */
export const SEMANTIC_ALIASES = {
  '--po-panel': 'var(--po-surface-panel)',
  '--po-panel-raised': 'var(--po-surface-panel-raised)',
  '--po-overlay': 'var(--po-surface-overlay)',
  '--po-inset': 'var(--po-surface-inset)',
  '--po-chrome': 'var(--po-surface-chrome)',
  '--po-font-sans': 'Geist, sans-serif',
  '--po-type-ui-micro': '11px',
};

const parseColor = (value) => {
  value = value.trim();
  if (value === 'transparent') return [0, 0, 0, 0];
  let m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = value.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = value.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  return null;
};
export const formatColor = ([r, g, b, a]) => a >= 0.999
  ? `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
  : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(4)})`;

export function resolve(value, vars, depth = 0) {
  if (depth > 24) throw new Error(`cyclic ${value}`);
  for (;;) {
    const m = value.match(/var\((--[a-z0-9-]+)(?:\s*,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/);
    if (!m) break;
    const v = vars[m[1]] ?? SEMANTIC_ALIASES[m[1]] ?? m[2];
    if (v === undefined) throw new Error(`unresolved ${m[1]}`);
    value = value.replace(m[0], resolve(v, vars, depth + 1));
  }
  for (;;) {
    const m = value.match(/color-mix\(in srgb,\s*([^,()]+(?:\([^()]*\))?[^,()]*),\s*([^,()]+(?:\([^()]*\))?[^,()]*)\)/);
    if (!m) break;
    const split = (arg) => {
      const p = arg.trim().match(/^(.*?)(?:\s+([\d.]+)%)?$/);
      return [parseColor(p[1]), p[2] ? parseFloat(p[2]) / 100 : null];
    };
    const [a, pa] = split(m[1]); const [b, pb] = split(m[2]);
    if (!a || !b) throw new Error(`cannot mix ${m[0]}`);
    let wa = pa;
    let wb = pb;
    if (wa === null && wb === null) { wa = 0.5; wb = 0.5; }
    if (wa === null) wa = 1 - wb;
    if (wb === null) wb = 1 - wa;
    const alpha = a[3] * wa + b[3] * wb;
    const mixed = alpha === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (a[i] * a[3] * wa + b[i] * b[3] * wb) / alpha).concat(alpha);
    value = value.replace(m[0], formatColor(mixed));
  }
  return value;
}
