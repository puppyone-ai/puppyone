// Run with: node tools/import-theme-contract.mjs [/path/to/puppyone]
// Copies the product's Sub Theme contract inputs that the native theme service
// reads at runtime: the Themes Folder guide, the Neutral fallback (also the
// base under every installed theme), the Markdown token contract and the
// Markdown defaults that new themes start from. The other built-in sources are
// kept as compiler fixtures.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, 'product-source.json'), 'utf8'));
const product = path.resolve(process.argv[2] ?? process.env.PUPPYONE_PRODUCT_ROOT ?? path.join(root, config.checkout));
const out = path.join(root, 'assets/themes');
await mkdir(path.join(out, 'builtin'), { recursive: true });

await writeFile(path.join(out, 'README.md'), await readFile(path.join(product, 'electron/themes/README.md')));
const contract = JSON.parse(await readFile(path.join(product, 'shared/markdown-theme-contract.json'), 'utf8'));
await writeFile(path.join(out, 'markdown-contract.json'), JSON.stringify({
  tokens: contract.tokens.map(({ name, sizePresets }) => (sizePresets ? { name, sizePresets: true } : { name })),
  integerSizes: contract.integerSizes,
  sizePresets: contract.sizePresets,
}, null, 1) + '\n');
const { DEFAULT_MARKDOWN_THEME_CSS } = await import(path.join(product, 'electron/main/themes/markdown-theme-defaults.generated.mjs'));
await writeFile(path.join(out, 'markdown-defaults.css'), DEFAULT_MARKDOWN_THEME_CSS);
const names = [];
for (const dir of (await readdir(path.join(product, 'sub-themes'))).sort()) {
  await writeFile(path.join(out, 'builtin', `${dir}.css`), await readFile(path.join(product, 'sub-themes', dir, 'theme.css')));
  names.push(dir);
}
console.log(`Theme contract: ${names.join(', ')}`);
