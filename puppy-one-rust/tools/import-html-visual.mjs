#!/usr/bin/env node
// Bundle the product's HTML visual editor (tools/html-visual-entry.tsx)
// against the product sources into assets/web/html-visual.{js,css}, with a
// provenance receipt (assets/web/html-visual.json). `--check` rebuilds in
// memory and fails when the committed assets or their sources drifted.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, productRoot} from './product-bundle.mjs';

const check = process.argv.includes('--check');
const product = await productRoot(process.argv.slice(2).find(a => !a.startsWith('--')));
const modules = path.join(product, 'node_modules');
const {build} = await import(pathToFileURL(path.join(modules, 'esbuild/lib/main.js')));
const source = p => path.join(product, p);
const alias = {
  'react': path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'),
  // Only the tooltip layer imports the package root, for isTooltipSuppressed;
  // the full barrel would bundle every viewer. A missing export fails the build.
  '@puppyone/shared-ui': source('packages/shared-ui/src/primitives/Tooltip.tsx'),
  '@puppyone/localization/core': source('packages/localization/src/core/index.ts'),
  '@puppyone/localization/react': source('packages/localization/src/react/index.ts'),
  '@puppyone/localization': source('packages/localization/src/index.ts'),
};
// The surface's own styles and the tokens they read. Colours are overlaid by
// the native theme at runtime (src/editor/viewers/html_visual.rs).
const STYLES = [
  'src/styles/fallback-theme.generated.css',
  'src/styles/tokens.css',
  'src/styles/typography/foundations.css',
  'src/styles/typography/locales.css',
  'src/styles/typography/roles.css',
  'packages/shared-ui/src/styles/control-geometry.css',
  'packages/shared-ui/src/styles/loading-mark.css',
  'packages/shared-ui/src/styles/floating-notice.css',
  'packages/shared-ui/src/styles/editor/html-editor.css',
  'src/styles/tooltip.css',
];
const entry = await readFile(path.join(root, 'tools/html-visual-entry.tsx'), 'utf8');
const script = await build({
  absWorkingDir: product, stdin: {contents: entry, resolveDir: product, loader: 'tsx', sourcefile: 'html-visual-entry.tsx'},
  nodePaths: [modules], alias, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  minify: true, legalComments: 'eof', target: 'safari16',
  define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({DEV: false, PROD: true, MODE: 'production'})},
  loader: {'.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty'},
  metafile: true, outfile: 'html-visual.js', logLevel: 'error',
});
const styles = await build({
  absWorkingDir: product, stdin: {contents: STYLES.map(p => `@import ${JSON.stringify('./' + p)};`).join('\n'), resolveDir: product, loader: 'css'},
  bundle: true, write: false, minify: true, metafile: true, outfile: 'html-visual.css', logLevel: 'error',
  loader: {'.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.svg': 'empty', '.png': 'empty'},
  external: ['/fonts/*', '/assets/*'],
});
const inputs = [...new Set([...Object.keys(script.metafile.inputs), ...Object.keys(styles.metafile.inputs)])]
  .filter(p => !p.startsWith('<') && !p.startsWith('(disabled):') && p !== 'html-visual-entry.tsx' && !p.includes('node_modules/')).sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all(inputs.map(async p => [p, hash(await readFile(path.resolve(product, p)))])));
const js = script.outputFiles[0].text;
// Product fonts load from the bundle (`__assets__/fonts/…`), never from the
// document's folder; only Geist Sans ships, the rest fall back.
const FONTS = {'geist/Geist-Variable.woff2': 'public/fonts/geist/Geist-Variable.woff2'};
const css = styles.outputFiles[0].text.replaceAll('url(/fonts/', 'url(fonts/').replaceAll('url("/fonts/', 'url("fonts/');
const fonts = Object.fromEntries(await Promise.all(Object.entries(FONTS).map(async ([name, file]) => [name, await readFile(source(file))])));
for (const file of Object.values(FONTS)) sourceHashes[file] = hash(fonts[Object.keys(FONTS).find(k => FONTS[k] === file)]);
const receipt = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: product, encoding: 'utf8'}).trim(),
  entry: 'tools/html-visual-entry.tsx',
  entryHash: hash(entry),
  outputs: {'html-visual.js': hash(js), 'html-visual.css': hash(css), 'html-visual-geist.woff2': hash(fonts['geist/Geist-Variable.woff2'])},
  sourceHashes,
};
const target = path.join(root, 'assets/web');
if (check) {
  const stale = [];
  for (const [name, text] of [['html-visual.js', js], ['html-visual.css', css]]) {
    const committed = await readFile(path.join(target, name), 'utf8').catch(() => null);
    if (committed !== text) stale.push(name);
  }
  const font = await readFile(path.join(target, 'html-visual-geist.woff2')).catch(() => null);
  if (!font || !font.equals(fonts['geist/Geist-Variable.woff2'])) stale.push('html-visual-geist.woff2');
  const committed = JSON.parse(await readFile(path.join(target, 'html-visual.json'), 'utf8').catch(() => '{}'));
  if (JSON.stringify(committed.sourceHashes) !== JSON.stringify(sourceHashes)) stale.push('html-visual.json');
  if (stale.length) throw new Error(`Stale HTML visual editor assets: ${stale.join(', ')} (run node tools/import-html-visual.mjs)`);
  console.log(`HTML visual editor assets verified (${inputs.length} product sources)`);
} else {
  await mkdir(target, {recursive: true});
  await writeFile(path.join(target, 'html-visual.js'), js);
  await writeFile(path.join(target, 'html-visual.css'), css);
  await writeFile(path.join(target, 'html-visual-geist.woff2'), fonts['geist/Geist-Variable.woff2']);
  await writeFile(path.join(target, 'html-visual.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`HTML visual editor imported: ${(js.length / 1024).toFixed(0)} KiB script, ${(css.length / 1024).toFixed(0)} KiB style, ${inputs.length} product sources`);
}
