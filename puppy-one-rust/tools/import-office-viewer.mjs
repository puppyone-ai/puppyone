#!/usr/bin/env node
// Bundle the product's Office preview (tools/office-viewer-entry.tsx) against
// the product sources into assets/web/office-viewer.{js,css} and its three
// workers (office-*.worker.js), with a provenance receipt
// (assets/web/office-viewer.json). `--check` rebuilds in memory and fails
// when the committed assets or their sources drifted.
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
  '@puppyone/shared-ui': source('src/shared-ui/primitives/Tooltip.tsx'),
  '@puppyone/localization/core': source('src/lib/localization/core/index.ts'),
  '@puppyone/localization/react': source('src/lib/localization/react/index.ts'),
  '@puppyone/localization': source('src/lib/localization/index.ts'),
};
// `createWorker`: the WebView serves each worker as a classic script beside
// the page (`__assets__/…`), so Vite's module-worker URLs are rewritten.
const WORKERS = {
  'office-validation.worker.js': 'src/shared-ui/editor/security/officePackageValidation.worker.ts',
  'office-spreadsheet.worker.js': 'src/shared-ui/editor/viewers/office/spreadsheetPreview.worker.ts',
  'office-text.worker.js': 'src/shared-ui/editor/viewers/office/officeTextFallback.worker.ts',
};
const workerHost = {
  name: 'office-worker-host',
  setup(build) {
    build.onLoad({filter: /BrowserEditorWorkerHost\.ts$/}, async args => {
      let contents = await readFile(args.path, 'utf8');
      for (const [asset, file] of Object.entries(WORKERS)) {
        const pattern = new RegExp(`new Worker\\(new URL\\("[^"]*${path.basename(file).replaceAll('.', '\\.')}", import\\.meta\\.url\\), \\{ type: "module", (name: "[^"]+") \\}\\)`);
        if (!pattern.test(contents)) throw new Error(`createWorker no longer constructs ${path.basename(file)} as expected`);
        contents = contents.replace(pattern, `new Worker(new URL("__assets__/${asset}", document.baseURI), { $1 })`);
      }
      return {contents, loader: 'ts'};
    });
  },
};
// Where WebKit differs from the product's Chromium, the bundle adapts the
// engine, never the product code:
// - TextDecoder rejects views of resizable ArrayBuffers, which the bounded
//   loader (officeResourceLoader.ts) returns; it decodes a copy instead.
// - DOMParser refuses XML that starts with a byte-order mark (OOXML parts
//   such as [Content_Types].xml may), which Chromium skips.
const WEBKIT_COMPAT = `(()=>{const d=TextDecoder.prototype.decode;const r=v=>v&&(v.resizable||(v.buffer&&v.buffer.resizable));TextDecoder.prototype.decode=function(i,o){if(r(i))i=ArrayBuffer.isView(i)?new Uint8Array(i.buffer,i.byteOffset,i.byteLength).slice():i.slice(0);return d.call(this,i,o)};if(typeof DOMParser!=="undefined"){const p=DOMParser.prototype.parseFromString;DOMParser.prototype.parseFromString=function(s,t){if(typeof s==="string"&&s.charCodeAt(0)===65279&&t!=="text/html")s=s.slice(1);return p.call(this,s,t)}}})();`;
const common = {
  absWorkingDir: product, nodePaths: [modules], alias, bundle: true, write: false, format: 'iife', platform: 'browser',
  jsx: 'automatic', minify: true, legalComments: 'eof', target: 'safari16', logLevel: 'error', metafile: true,
  banner: {js: WEBKIT_COMPAT},
  define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({DEV: false, PROD: true, MODE: 'production'})},
  loader: {'.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty'},
};
// The surface's own styles and the tokens they read. Colours are overlaid by
// the native theme at runtime (src/editor/viewers/office.rs).
const STYLES = [
  'src/styles/fallback-theme.generated.css',
  'src/styles/tokens.css',
  'src/styles/typography/foundations.css',
  'src/styles/typography/locales.css',
  'src/styles/typography/roles.css',
  'src/shared-ui/styles/control-geometry.css',
  'src/shared-ui/styles/loading-mark.css',
  'src/shared-ui/styles/loading-placeholder.css',
  'src/shared-ui/styles/floating-notice.css',
  'src/shared-ui/styles/editor/preview-surfaces.css',
  'src/shared-ui/styles/editor/media-office-preview.css',
  'src/styles/tooltip.css',
];
const entry = await readFile(path.join(root, 'tools/office-viewer-entry.tsx'), 'utf8');
const script = await build({...common, plugins: [workerHost],
  stdin: {contents: entry, resolveDir: product, loader: 'tsx', sourcefile: 'office-viewer-entry.tsx'}, outfile: 'office-viewer.js'});
const workers = {};
const workerInputs = [];
for (const [asset, file] of Object.entries(WORKERS)) {
  const built = await build({...common, entryPoints: [source(file)], outfile: asset});
  workers[asset] = built.outputFiles[0].text;
  workerInputs.push(...Object.keys(built.metafile.inputs));
}
const styles = await build({
  absWorkingDir: product, stdin: {contents: STYLES.map(p => `@import ${JSON.stringify('./' + p)};`).join('\n'), resolveDir: product, loader: 'css'},
  bundle: true, write: false, minify: true, metafile: true, outfile: 'office-viewer.css', logLevel: 'error',
  loader: {'.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.svg': 'empty', '.png': 'empty'},
  external: ['/fonts/*', '/assets/*'],
});
const inputs = [...new Set([...Object.keys(script.metafile.inputs), ...workerInputs, ...Object.keys(styles.metafile.inputs)])]
  .filter(p => !p.startsWith('<') && !p.startsWith('(disabled):') && p !== 'office-viewer-entry.tsx' && !p.includes('node_modules/')).sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries(await Promise.all(inputs.map(async p => [p, hash(await readFile(path.resolve(product, p)))])));
const js = script.outputFiles[0].text;
// Product fonts are not shipped to this page; the bundled CSS keeps no
// absolute font URLs that the WebView would resolve against the document.
const css = styles.outputFiles[0].text.replaceAll('url(/fonts/', 'url(fonts/').replaceAll('url("/fonts/', 'url("fonts/');
const files = {'office-viewer.js': js, 'office-viewer.css': css, ...workers};
const receipt = {
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: product, encoding: 'utf8'}).trim(),
  entry: 'tools/office-viewer-entry.tsx',
  entryHash: hash(entry),
  outputs: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, hash(text)])),
  sourceHashes,
};
const target = path.join(root, 'assets/web');
if (check) {
  const stale = [];
  for (const [name, text] of Object.entries(files)) {
    const committed = await readFile(path.join(target, name), 'utf8').catch(() => null);
    if (committed !== text) stale.push(name);
  }
  const committed = JSON.parse(await readFile(path.join(target, 'office-viewer.json'), 'utf8').catch(() => '{}'));
  if (JSON.stringify(committed.sourceHashes) !== JSON.stringify(sourceHashes)) stale.push('office-viewer.json');
  if (stale.length) throw new Error(`Stale Office viewer assets: ${stale.join(', ')} (run node tools/import-office-viewer.mjs)`);
  console.log(`Office viewer assets verified (${inputs.length} product sources)`);
} else {
  await mkdir(target, {recursive: true});
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(target, name), text);
  await writeFile(path.join(target, 'office-viewer.json'), JSON.stringify(receipt, null, 2) + '\n');
  const size = Object.values(files).reduce((sum, text) => sum + text.length, 0);
  console.log(`Office viewer imported: ${(size / 1024).toFixed(0)} KiB across ${Object.keys(files).length} files, ${inputs.length} product sources`);
}
