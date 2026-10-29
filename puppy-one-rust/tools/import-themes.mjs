// Run with: node tools/import-themes.mjs [/path/to/puppyone]
// Projects the built-in Default-interface Sub Themes (sub-themes/default-*/theme.css)
// into concrete light/dark palettes for the native Theme. The cascade matches
// the product: fallback (default-neutral) → pack :root → pack .dark .theme-root.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationBlocks, PALETTE_TOKENS as TOKENS, resolve } from './css-tokens.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, 'product-source.json'), 'utf8'));
const product = path.resolve(process.argv[2] ?? process.env.PUPPYONE_PRODUCT_ROOT ?? path.join(root, config.checkout));


const meta = (css, key) => css.match(new RegExp(`${key}:\\s*([^;]+);`))?.[1].trim();
const neutral = applicationBlocks(await readFile(path.join(product, 'sub-themes/default-neutral/theme.css'), 'utf8'));
const packs = [];
for (const dir of await readdir(path.join(product, 'sub-themes'))) {
  const css = await readFile(path.join(product, 'sub-themes', dir, 'theme.css'), 'utf8');
  if (meta(css, 'compatible-root-themes') !== 'default') continue;
  const own = applicationBlocks(css);
  const light = { ...neutral.light, ...own.light };
  const dark = { ...neutral.light, ...neutral.dark, ...own.light, ...own.dark };
  const project = (vars) => Object.fromEntries(TOKENS.map((name) => [name, resolve(`var(--po-${name})`, vars)]));
  packs.push({
    id: meta(css, 'id'),
    name: meta(css, 'name'),
    order: Number(meta(css, 'builtin-order') ?? 999),
    light: project(light),
    dark: project(dark),
  });
}
packs.sort((a, b) => a.order - b.order);
await writeFile(path.join(root, 'assets/themes.json'), JSON.stringify({ source: 'sub-themes/default-*/theme.css', packs }, null, 1) + '\n');
console.log(`Themes: ${packs.map((p) => p.id).join(', ')}`);
