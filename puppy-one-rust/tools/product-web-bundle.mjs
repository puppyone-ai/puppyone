// Bundle a product page for a native WebView: an entry module (tools/*.tsx)
// against the pinned product sources, its workers and its styles, with a
// source-hash receipt. Used by the viewer importers; `--check` rebuilds in
// memory and fails when committed assets or their sources drifted.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, productRoot} from './product-bundle.mjs';

// Where WebKit differs from the product's Chromium, bundles adapt the
// engine, never the product code:
// - TextDecoder rejects views of resizable ArrayBuffers, which the bounded
//   Office loader (officeResourceLoader.ts) returns; it decodes a copy.
// - DOMParser refuses XML that starts with a byte-order mark (OOXML parts
//   such as [Content_Types].xml may), which Chromium skips.
const WEBKIT_COMPAT = `(()=>{const d=TextDecoder.prototype.decode;const r=v=>v&&(v.resizable||(v.buffer&&v.buffer.resizable));TextDecoder.prototype.decode=function(i,o){if(r(i))i=ArrayBuffer.isView(i)?new Uint8Array(i.buffer,i.byteOffset,i.byteLength).slice():i.slice(0);return d.call(this,i,o)};if(typeof DOMParser!=="undefined"){const p=DOMParser.prototype.parseFromString;DOMParser.prototype.parseFromString=function(s,t){if(typeof s==="string"&&s.charCodeAt(0)===65279&&t!=="text/html")s=s.slice(1);return p.call(this,s,t)}}})();`;

/**
 * name: output stem (`<name>.js`, `<name>.css`, `<name>.json`);
 * entry: the tools/ entry module; styles: product CSS files, in order
 * (a `node_modules/` path names a package's own stylesheet);
 * workers: { asset: product worker source } served as `__assets__/<asset>`;
 * baseUrl: `import.meta.env.BASE_URL` for public assets;
 * conditions: package export conditions (`production` builds);
 * plugins: esbuild plugins that adapt third-party code as the product's
 * Vite plugins do; packages: dependencies whose versions the receipt pins;
 * cssExternal / cssRewrite: stylesheet URLs left for the page to load
 * (a package's own fonts) and how the built sheet names them.
 */
export async function bundleProductPage({name, entry, styles, workers = {}, baseUrl = './',
  conditions = [], plugins = [], packages = [], cssExternal = [], cssRewrite = text => text}) {
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
  // the page, so Vite's module-worker URLs are rewritten.
  const workerHost = {
    name: 'worker-host',
    setup(build) {
      build.onLoad({filter: /BrowserEditorWorkerHost\.ts$/}, async args => {
        let contents = await readFile(args.path, 'utf8');
        for (const [asset, file] of Object.entries(workers)) {
          const pattern = new RegExp(`new Worker\\(new URL\\("[^"]*${path.basename(file).replaceAll('.', '\\.')}", import\\.meta\\.url\\), \\{ type: "module", (name: "[^"]+") \\}\\)`);
          if (!pattern.test(contents)) throw new Error(`createWorker no longer constructs ${path.basename(file)} as expected`);
          contents = contents.replace(pattern, `new Worker(new URL("__assets__/${asset}", document.baseURI), { $1 })`);
        }
        return {contents, loader: 'ts'};
      });
    },
  };
  const common = {
    absWorkingDir: product, nodePaths: [modules], alias, conditions, bundle: true, write: false, format: 'iife', platform: 'browser',
    jsx: 'automatic', minify: true, legalComments: 'eof', target: 'safari16', logLevel: 'error', metafile: true,
    banner: {js: WEBKIT_COMPAT},
    define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({DEV: false, PROD: true, MODE: 'production', BASE_URL: baseUrl})},
    loader: {'.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty'},
  };
  const entrySource = await readFile(path.join(root, entry), 'utf8');
  const script = await build({...common, plugins: [workerHost, ...plugins],
    stdin: {contents: entrySource, resolveDir: product, loader: 'tsx', sourcefile: path.basename(entry)}, outfile: `${name}.js`});
  const files = {[`${name}.js`]: script.outputFiles[0].text};
  const inputs = Object.keys(script.metafile.inputs);
  for (const [asset, file] of Object.entries(workers)) {
    const built = await build({...common, entryPoints: [source(file)], outfile: asset});
    files[asset] = built.outputFiles[0].text;
    inputs.push(...Object.keys(built.metafile.inputs));
  }
  // Styles the modules import themselves (dropped from the script) follow
  // the listed ones.
  const imported = inputs.filter(p => p.endsWith('.css') && !p.includes('node_modules/'));
  const sheet = [...new Set([...styles, ...imported])];
  const css = await build({
    absWorkingDir: product, stdin: {contents: sheet.map(p => `@import ${JSON.stringify('./' + p)};`).join('\n'), resolveDir: product, loader: 'css'},
    bundle: true, write: false, minify: true, metafile: true, outfile: `${name}.css`, logLevel: 'error',
    loader: {'.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty', '.svg': 'empty', '.png': 'empty'},
    external: ['/fonts/*', '/assets/*', ...cssExternal],
  });
  files[`${name}.css`] = cssRewrite(css.outputFiles[0].text).replaceAll('url(/fonts/', 'url(fonts/').replaceAll('url("/fonts/', 'url("fonts/');
  inputs.push(...Object.keys(css.metafile.inputs));
  const sources = [...new Set(inputs)]
    .filter(p => !p.startsWith('<') && !p.startsWith('(disabled):') && p !== path.basename(entry) && !p.includes('node_modules/')).sort();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async p => [p, hash(await readFile(path.resolve(product, p)))])));
  const versions = Object.fromEntries(await Promise.all(packages.map(async p =>
    [p, JSON.parse(await readFile(path.join(modules, p, 'package.json'), 'utf8')).version])));
  const receipt = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: product, encoding: 'utf8'}).trim(),
    entry,
    entryHash: hash(entrySource),
    ...(packages.length ? {packages: versions} : {}),
    outputs: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, hash(text)])),
    sourceHashes,
  };
  const target = path.join(root, 'assets/web');
  if (check) {
    const stale = [];
    for (const [file, text] of Object.entries(files)) {
      const committed = await readFile(path.join(target, file), 'utf8').catch(() => null);
      if (committed !== text) stale.push(file);
    }
    const committed = JSON.parse(await readFile(path.join(target, `${name}.json`), 'utf8').catch(() => '{}'));
    if (JSON.stringify(committed.sourceHashes) !== JSON.stringify(sourceHashes)
      || JSON.stringify(committed.packages) !== JSON.stringify(receipt.packages)) stale.push(`${name}.json`);
    if (stale.length) throw new Error(`Stale ${name} assets: ${stale.join(', ')} (run node tools/import-${name}.mjs)`);
    console.log(`${name} assets verified (${sources.length} product sources)`);
  } else {
    await mkdir(target, {recursive: true});
    for (const [file, text] of Object.entries(files)) await writeFile(path.join(target, file), text);
    await writeFile(path.join(target, `${name}.json`), JSON.stringify(receipt, null, 2) + '\n');
    const size = Object.values(files).reduce((sum, text) => sum + text.length, 0);
    console.log(`${name} imported: ${(size / 1024).toFixed(0)} KiB across ${Object.keys(files).length} files, ${sources.length} product sources`);
  }
  return {product, modules, receipt};
}

/** The product tokens and typography every bundled page reads. */
export const BASE_STYLES = [
  'src/styles/fallback-theme.generated.css',
  'src/styles/tokens.css',
  'src/styles/typography/foundations.css',
  'src/styles/typography/locales.css',
  'src/styles/typography/roles.css',
  'src/shared-ui/styles/control-geometry.css',
  'src/shared-ui/styles/loading-mark.css',
  'src/styles/tooltip.css',
];
