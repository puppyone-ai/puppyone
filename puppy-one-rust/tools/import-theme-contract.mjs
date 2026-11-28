// Run with: node tools/import-theme-contract.mjs [/path/to/puppyone] [--check]
// Copies the product's Sub Theme contract inputs that the native theme service
// reads at runtime: the Themes Folder guide, the Neutral fallback (also the
// base under every installed theme), the Markdown token contract and the
// Markdown defaults that new themes start from. The other built-in sources are
// kept as compiler fixtures. Every copy names the system faces in place of
// the product's bundled ones (`system-fonts.mjs`). `--check` fails when a
// copy is stale or the built-in packages differ from the product's.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProductRoot } from './product-source.mjs';
import { systemFonts } from './system-fonts.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const check = process.argv.includes('--check');
const product = resolveProductRoot(process.argv.slice(2).find((arg) => !arg.startsWith('--')));
const out = path.join(root, 'assets/themes');
const stale = [];
async function output(file, bytes) {
  const target = path.join(out, file);
  if (check) {
    const current = await readFile(target).catch(() => null);
    if (!current || !current.equals(Buffer.from(bytes))) stale.push(file);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

await output('README.md', systemFonts(await readFile(path.join(product, 'electron/themes/README.md'), 'utf8')));
const contract = JSON.parse(await readFile(path.join(product, 'shared/markdown-theme-contract.json'), 'utf8'));
await output('markdown-contract.json', JSON.stringify({
  tokens: contract.tokens.map(({ name, sizePresets }) => (sizePresets ? { name, sizePresets: true } : { name })),
  integerSizes: contract.integerSizes,
  sizePresets: contract.sizePresets,
}, null, 1) + '\n');
const { DEFAULT_MARKDOWN_THEME_CSS } = await import(path.join(product, 'electron/main/themes/markdown-theme-defaults.generated.mjs'));
await output('markdown-defaults.css', systemFonts(DEFAULT_MARKDOWN_THEME_CSS));
const names = [];
for (const dir of (await readdir(path.join(product, 'src/features/themes/builtin'))).sort()) {
  await output(path.join('builtin', `${dir}.css`), systemFonts(await readFile(path.join(product, 'src/features/themes/builtin', dir, 'theme.css'), 'utf8')));
  names.push(dir);
}
if (check) {
  const shipped = (await readdir(path.join(out, 'builtin'))).sort();
  const expected = names.map((name) => `${name}.css`);
  if (JSON.stringify(shipped) !== JSON.stringify(expected)) stale.push(`builtin/ (${shipped.join(', ')})`);
  if (stale.length) throw new Error(`Stale theme contract: ${stale.join(', ')}; run node tools/import-theme-contract.mjs`);
}
console.log(`Theme contract ${check ? 'verified' : 'imported'}: ${names.join(', ')}`);
