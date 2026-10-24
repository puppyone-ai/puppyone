// Shared harness: bundle real product modules with the product's renderer CSS
// and theme projection, and load them into an isolated, offline Electron page.
// Used by reference-editor.mjs (pixel references) and import-editor-theme.mjs
// (token contract). Not an application entry point.
import {BrowserWindow} from 'electron';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {productRoot as repo} from './product-source.mjs';

export const productRoot = repo;
export const source = p => path.join(repo, p);
const modules = process.env.PUPPYONE_NODE_MODULES ?? path.join(repo, 'node_modules');

/** Merge renderer catalogs for the given namespaces into flat `ns.key` maps. */
export async function catalogs(namespaces, locales = ['en', 'zh-Hans']) {
  const out = {}, paths = [];
  for (const locale of locales) {
    out[locale] = {};
    for (const ns of namespaces) {
      const p = `locales/renderer/${locale}/${ns}.json`; paths.push(p);
      for (const [key, value] of Object.entries(JSON.parse(await readFile(source(p), 'utf8')))) out[locale][`${ns}.${key}`] = value;
    }
  }
  return {catalogs: out, paths};
}

/** Bundle a TSX entry (as a string) plus the complete renderer stylesheet. */
export async function bundleProduct(input, extraInputs = [], env = {}) {
  const {build} = await import(pathToFileURL(path.join(modules, 'esbuild/lib/main.js')));
  const alias = {'react': path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'),
    '@puppyone/shared-ui': source('packages/shared-ui/src/index.ts'),
    '@puppyone/localization/core': source('packages/localization/src/core/index.ts'),
    '@puppyone/localization/react': source('packages/localization/src/react/index.ts'),
    '@puppyone/localization': source('packages/localization/src/index.ts')};
  const sharedPackage = JSON.parse(await readFile(source('packages/shared-ui/package.json'), 'utf8'));
  for (const [key, value] of Object.entries(sharedPackage.exports ?? {}))
    if (key.endsWith('.css') && typeof value === 'string') alias[`@puppyone/shared-ui/${key.slice(2)}`] = source(`packages/shared-ui/${value}`);
  const plugins = [{name: 'offline-public-assets', setup(b) { b.onResolve({filter: /^\/(fonts|assets)\//}, args => ({path: source(`public${args.path}`)})); }}];
  const loader = {'.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl'};
  const bundle = await build({absWorkingDir: repo, stdin: {contents: input, resolveDir: repo, loader: 'tsx'}, nodePaths: [modules], alias, plugins, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({DEV: false, PROD: true, MODE: 'production', BASE_URL: pathToFileURL(source('public')).href + '/', ...env})},
    loader, metafile: true, outdir: 'fixture-out', splitting: false, logLevel: 'error'});
  const css = await build({absWorkingDir: repo, entryPoints: [source('src/styles/cascade.css'), source('src/styles.css')], nodePaths: [modules], alias, plugins, bundle: true, write: false, loader, metafile: true, outdir: 'fixture-css', logLevel: 'error'});
  const themePath = 'src/features/themes/builtinSubThemes.generated.ts';
  const compiled = (await readFile(source(themePath), 'utf8')).match(/const DEFAULT_NEUTRAL_COMPILED_CSS = Object.freeze\((\{[\s\S]*?\n\})\);/);
  if (!compiled) throw Error('Review generated Default-neutral projection');
  const theme = JSON.parse(compiled[1]);
  const inputs = [...new Set([...Object.keys(bundle.metafile.inputs), ...Object.keys(css.metafile.inputs), ...extraInputs, themePath])].filter(p => !p.startsWith('<') && !p.startsWith('(disabled):'));
  const hashes = Object.fromEntries(await Promise.all(inputs.sort().map(async p => [p, createHash('sha256').update(await readFile(path.resolve(repo, p.split('?')[0]))).digest('hex')])));
  return {
    script: bundle.outputFiles.find(f => f.path.endsWith('.js')).text,
    style: [...css.outputFiles, ...bundle.outputFiles.filter(f => f.path.endsWith('.css'))].map(f => f.text).join('\n') + '\n' + subThemeLayer(theme),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
    sourceHashes: hashes,
  };
}

/** The compiled sub-theme CSS exactly as SubThemeStyleHost injects it. */
export function subThemeLayer(theme) {
  return Object.values(theme).filter(Boolean).map(css => `@layer sub-theme {\n${css}\n}`).join('\n');
}

/** Open an offline window and load the bundle with `window.fixture`. */
export async function openPage(profile, {width, height, mode, fixture, script, style}) {
  const win = new BrowserWindow({width, height, useContentSize: true, frame: false, show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
  win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_d, done) => done({cancel: true}));
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  const dark = mode === 'dark' ? 'dark' : '';
  const html = `<!doctype html><html lang="en" class="${dark}" data-interface-style="default"><meta charset="utf-8"><style>${style}\nhtml,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--po-canvas);color:var(--po-text)}</style><body class="app-shell theme-root ${dark}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"><div id="root" style="position:relative"></div><div id="desktop-overlay-root" class="desktop-overlay-root ${dark}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"></div><script>window.fixture=${JSON.stringify(fixture)};window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));</script><script type="module">${script.replaceAll('</script', '<\\/script')}</script>`;
  const page = path.join(profile, `fixture-${Date.now()}.html`); await writeFile(page, html); await win.loadFile(page);
  return win;
}
