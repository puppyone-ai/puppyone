// Run with: node tools/import-document-defaults.mjs [--check]
// The product CSS's own declarations of the tokens the Markdown and CSV
// viewers resolve (assets/editor/{markdown,csv}-theme.json) that no Sub Theme
// block declares: tokens.css aliases, the editable-table contract, the
// viewers' host rules. A Sub Theme's blocks cascade over these, so derived
// tokens (`--po-csv-surface-background: var(--po-editor-bg)`) follow a pack
// the way the browser's cascade does. Writes assets/editor/document-defaults.json.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { productRoot } from './product-source.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'assets/editor/document-defaults.json');
const check = process.argv.includes('--check');
const modules = process.env.PUPPYONE_NODE_MODULES ?? path.join(productRoot, 'node_modules');
const { default: postcss } = await import(pathToFileURL(path.join(modules, 'postcss/lib/postcss.js')));

// Cascade order: the base tokens, then the editor styles by name.
const editorDir = 'src/shared-ui/styles/editor';
const files = ['src/styles/tokens.css', ...(await readdir(path.join(productRoot, editorDir)))
  .filter((name) => name.endsWith('.css')).sort().map((name) => `${editorDir}/${name}`)];

const HOSTS = {
  markdown: { file: 'markdown-theme.json', host: /^(\.markdown-codemirror-editor|\.markdown-codemirror-editor \.cm-md-table-widget-wrap|\.cm-md-table-widget-wrap)$/ },
  csv: { file: 'csv-theme.json', host: /^\.csv-table-editor$/ },
};
// A rule that sets a token for the whole viewer: its root, the theme root
// or the host itself, never a state, a mode or a descendant part.
const ROOT = /^(:root|\.theme-root|html)$/;

function scopes(selector, host) {
  const parts = selector.replace(/^:(where|is)\((.*)\)$/s, '$2').split(',').map((s) => s.trim());
  const found = new Set();
  for (const part of parts) {
    const dark = /(^|\s)\.dark(\s|$)|\.dark\s/.test(part);
    const bare = part.replace(/(^|\s)\.dark\s+/g, ' ').trim();
    if (ROOT.test(bare)) found.add(`root:${dark}`);
    else if (host.test(bare)) found.add(`host:${dark}`);
  }
  return found;
}

const result = {};
for (const [name, { file, host }] of Object.entries(HOSTS)) {
  const variants = JSON.parse(await readFile(path.join(root, 'assets/editor', file), 'utf8')).variants;
  const wanted = new Set(Object.keys(variants['light/medium'].tokens));
  // Later wins within a scope. The root's sit under a Sub Theme's
  // Application declarations; the host's rules over them (they apply to the
  // viewer element itself).
  const picked = { root: {}, host: {}, dark: { root: {}, host: {} } };
  for (const relative of files) {
    const css = await readFile(path.join(productRoot, relative), 'utf8');
    postcss.parse(css).walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && !/^layer$/i.test(rule.parent.name)) return;
      const found = scopes(rule.selector, host);
      if (found.size === 0) return;
      rule.each((node) => {
        if (node.type !== 'decl' || !wanted.has(node.prop)) return;
        const value = node.value.replace(/\s+/g, ' ').trim();
        for (const scope of found) {
          const [kind, dark] = scope.split(':');
          (dark === 'true' ? picked.dark : picked)[kind][node.prop] = value;
        }
      });
    });
  }
  result[name] = picked;
}

const text = JSON.stringify({ source: 'product CSS custom properties (tools/import-document-defaults.mjs)', ...result }, null, 1) + '\n';
if (check) {
  const current = await readFile(out, 'utf8').catch(() => '');
  if (current !== text) throw new Error('Stale assets/editor/document-defaults.json: run node tools/import-document-defaults.mjs');
  console.log('Document defaults verified');
} else {
  await writeFile(out, text);
  const count = (h) => `${Object.keys(result[h].root).length} root + ${Object.keys(result[h].host).length} host`;
  console.log(`Wrote ${path.relative(root, out)}: markdown ${count('markdown')}, csv ${count('csv')}`);
}
