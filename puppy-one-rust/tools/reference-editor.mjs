import {productRoot} from './product-source.mjs';
// Actual product editor pane (EditorPaneShell → TextEditorFrame → Viewer) in an
// isolated Electron profile, sized like the native editor area. Documents are
// in-memory fixtures; no workspace, persistence or service is involved.
// Output: artifacts/editor-reference/<case>.png + .json (geometry + computed styles).
import {app, BrowserWindow} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = productRoot;
const modules = process.env.PUPPYONE_NODE_MODULES ?? path.join(repo, 'node_modules');
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-editor-reference-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
const out = path.join(root, process.env.PUPPYONE_REFERENCE_OUT ?? 'artifacts/editor-reference');
const source = p => path.join(repo, p);
// Native editor area of a 1280×800 window: sidebar 221px, header 40px.
const WIDTH = Number(process.env.PUPPYONE_REFERENCE_WIDTH ?? 1059);
const HEIGHT = Number(process.env.PUPPYONE_REFERENCE_HEIGHT ?? 760);
const fixtures = path.join(root, 'fixtures/editor');
const only = process.env.PUPPYONE_REFERENCE_ONLY?.split(',');
// case id → document, mode, interaction
const cases = [];
for (const mode of ['dark', 'light']) {
  cases.push({id: `md-${mode}`, file: 'sample.md', mode});
  cases.push({id: `csv-${mode}`, file: 'sample.csv', mode});
  cases.push({id: `md-menu-${mode}`, file: 'sample.md', mode, menu: true});
  cases.push({id: `csv-menu-${mode}`, file: 'sample.csv', mode, menu: true});
  cases.push({id: `md-source-${mode}`, file: 'sample.md', mode, view: 'source'});
  cases.push({id: `json-${mode}`, file: 'sample.json', mode});
  cases.push({id: `code-${mode}`, file: 'sample.ts', mode});
}

async function run() {
  const {build} = await import(pathToFileURL(path.join(modules, 'esbuild/lib/main.js')));
  const alias = {'react': path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'),
    '@puppyone/shared-ui': source('packages/shared-ui/src/index.ts'),
    '@puppyone/localization/core': source('packages/localization/src/core/index.ts'),
    '@puppyone/localization/react': source('packages/localization/src/react/index.ts'),
    '@puppyone/localization': source('packages/localization/src/index.ts')};
  const sharedPackage = JSON.parse(await readFile(source('packages/shared-ui/package.json'), 'utf8'));
  for (const [key, value] of Object.entries(sharedPackage.exports ?? {}))
    if (key.endsWith('.css') && typeof value === 'string') alias[`@puppyone/shared-ui/${key.slice(2)}`] = source(`packages/shared-ui/${value}`);
  const catalogs = {}, catalogPaths = [];
  for (const locale of ['en', 'zh-Hans']) {
    catalogs[locale] = {};
    for (const ns of ['editor', 'shared-ui', 'common', 'workspace', 'shell']) {
      const p = `locales/renderer/${locale}/${ns}.json`; catalogPaths.push(p);
      const values = JSON.parse(await readFile(source(p), 'utf8'));
      for (const [key, value] of Object.entries(values)) catalogs[locale][`${ns}.${key}`] = value;
    }
  }
  const documents = {};
  for (const file of new Set(cases.map(c => c.file))) documents[file] = await readFile(path.join(fixtures, file), 'utf8');
  const input = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {LocalizationProvider} from '@puppyone/localization/react';
import {EditorPaneMenuContributionProvider} from ${JSON.stringify(source('packages/shared-ui/src/editor/editorPaneMenuContribution.tsx'))};
import {EditorAppearanceProvider} from ${JSON.stringify(source('packages/shared-ui/src/core/appearance/EditorAppearanceContext.tsx'))};
import {EditorFindHost} from ${JSON.stringify(source('packages/shared-ui/src/editor/find/editorFind.tsx'))};
import {resolveEditorViewer} from ${JSON.stringify(source('packages/shared-ui/src/editor/registry/viewerRegistry.tsx'))};
import {PresetViewerRenderer} from ${JSON.stringify(source('packages/shared-ui/src/editor/host/PresetViewerRenderer.tsx'))};
import {getFileSemanticKind} from ${JSON.stringify(source('packages/shared-ui/src/core/fileFormats.ts'))};
import {EditorPaneShell} from ${JSON.stringify(source('src/features/editor-workbench/layout/EditorPaneShell.tsx'))};
import ${JSON.stringify(source('src/features/editor-workbench/layout/desktop-editor-split-view.css'))};
import {resolveTypography, DEFAULT_TYPOGRAPHY_PREFERENCES} from ${JSON.stringify(source('src/features/typography/fontCatalog.ts'))};
import {applyTypographyToElement} from ${JSON.stringify(source('src/features/typography/typographyRuntime.ts'))};
const catalogs=${JSON.stringify(catalogs)};const documents=${JSON.stringify(documents)};const noop=()=>{};
window.puppyoneDesktop={getPlatformCapabilities:async()=>({platform:'macos'})};
applyTypographyToElement(document.documentElement, resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES));
const f=window.fixture;
const initialState={locale:f.locale,preference:f.locale,direction:'ltr',systemLanguages:[]};
const localization={initialState,initialCatalog:catalogs[initialState.locale],fallbackCatalog:catalogs.en,
 loadCatalog:async locale=>({catalog:catalogs[locale],fallbackCatalog:catalogs.en}),client:{onLocaleChanged:()=>noop,setLanguagePreference:async preference=>({...initialState,preference,locale:preference})}};
// The product's own routing (EditorDocumentHost): registry resolution and
// viewer normalisation before render.
const doc={path:f.file,name:f.file,type:getFileSemanticKind(f.file,'file'),version:'reference-1',markdownDialect:null,sourceKind:'local'};
const {viewer,format,resolvedExtension}=resolveEditorViewer(doc);
window.__viewerId=viewer.id;
const raw=documents[f.file];const content=viewer.normalizeContent?.(raw,doc)??raw;
const context={document:doc,format,resolvedExtension,content,resourcePolicy:viewer.resourcePolicy,canEdit:true,hideSourceView:false,loading:false,fileUrlLoading:false,fileIconTheme:'default',
 editorInteractionPreferences:{showSaveStatus:false,markdownBlockDragEnabled:false,markdownHeadingOutlineEnabled:false},htmlTrustMode:'safe',workspaceId:'reference',workspaceRoot:'/reference',markdownEnvironment:null,documentNavigation:null,contextMapEnvironment:null,appPreview:null,aiEditFile:null};
const pane={kind:'leaf',id:'pane-1',documentPath:doc.path};
const drop={dropIntent:null,over:noop,leave:noop,drop:noop};
const move={dropIntent:null,prepare:noop,start:noop,move:noop,end:()=>'click',cancel:noop,lostCapture:noop};
function Fixture(){
 const [menu,setMenu]=React.useState(null);const [open,setOpen]=React.useState(false);
 React.useEffect(()=>{window.__setMenuOpen=setOpen;window.__menu=()=>menu;},[menu]);
 return <LocalizationProvider {...localization}><EditorAppearanceProvider revision={f.mode}><EditorFindHost documentId={doc.path}>
  <div className="desktop-editor-split-view" data-pane-count="1" style={{position:'absolute',inset:0}}>
   <div className="desktop-editor-pane-slot"><div className="desktop-editor-pane-host">
    <EditorPaneShell active actionsOpen={open} agentPresencePath={null} contentState="document" editorLabel={f.file}
     fileDrop={drop} findCommand={{open:noop}} menuContribution={menu} pane={pane} paneCount={1} paneMove={move}
     onActionsPaneChange={id=>setOpen(id!==null)} onActivate={noop} onClose={noop} onOpenExternal={noop} onSplit={noop}>
     <EditorPaneMenuContributionProvider onContributionChange={setMenu}>
      <PresetViewerRenderer viewer={viewer} context={context}/>
     </EditorPaneMenuContributionProvider>
    </EditorPaneShell>
   </div></div>
  </div>
 </EditorFindHost></EditorAppearanceProvider></LocalizationProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
  const plugins = [{name: 'offline-public-assets', setup(b) { b.onResolve({filter: /^\/(fonts|assets)\//}, args => ({path: source(`public${args.path}`)})); }}];
  const loader = {'.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl'};
  const bundle = await build({absWorkingDir: repo, stdin: {contents: input, resolveDir: repo, loader: 'tsx'}, nodePaths: [modules], alias, plugins, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({DEV: false, PROD: true, MODE: 'production', BASE_URL: pathToFileURL(source('public')).href + '/'})},
    loader, metafile: true, outdir: 'fixture-out', splitting: false, logLevel: 'error'});
  const css = await build({absWorkingDir: repo, entryPoints: [source('src/styles/cascade.css'), source('src/styles.css')], nodePaths: [modules], alias, plugins, bundle: true, write: false, loader, metafile: true, outdir: 'fixture-css', logLevel: 'error'});
  const themePath = 'src/features/themes/builtinSubThemes.generated.ts';
  const compiled = (await readFile(source(themePath), 'utf8')).match(/const DEFAULT_NEUTRAL_COMPILED_CSS = Object.freeze\((\{[\s\S]*?\n\})\);/);
  if (!compiled) throw Error('Review generated Default-neutral projection');
  const theme = JSON.parse(compiled[1]);
  const inputs = [...new Set([...Object.keys(bundle.metafile.inputs), ...Object.keys(css.metafile.inputs), ...catalogPaths, themePath])].filter(p => !p.startsWith('<') && !p.startsWith('(disabled):'));
  const hashes = Object.fromEntries(await Promise.all(inputs.map(async p => [p, createHash('sha256').update(await readFile(path.resolve(repo, p.split('?')[0]))).digest('hex')])));
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim();
  const style = [...css.outputFiles, ...bundle.outputFiles.filter(f => f.path.endsWith('.css'))].map(f => f.text).join('\n');
  const script = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  await mkdir(out, {recursive: true}); await app.whenReady();
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    const win = new BrowserWindow({width: WIDTH, height: HEIGHT, useContentSize: true, frame: false, show: false, webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
    win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_d, done) => done({cancel: true}));
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    try {
      const dark = c.mode === 'dark' ? 'dark' : '';
      const html = `<!doctype html><html lang="en" class="${dark}" data-interface-style="default"><meta charset="utf-8"><style>${style}\n${Object.values(theme).filter(Boolean).map(css => `@layer sub-theme {\n${css}\n}`).join('\n')}\nhtml,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--po-canvas);color:var(--po-text)}</style><body class="app-shell theme-root ${dark}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"><div id="root" style="position:relative"></div><div id="desktop-overlay-root" class="desktop-overlay-root ${dark}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"></div><script>window.fixture=${JSON.stringify({...c, locale: 'en'})};window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));</script><script type="module">${script.replaceAll('</script', '<\\/script')}</script>`;
      const page = path.join(profile, 'fixture.html'); await writeFile(page, html); await win.loadFile(page);
      await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;
        const ready=()=>document.querySelector(window.fixture.file.endsWith('.csv')?'.csv-table-editor, [class*="csv-table"]':'.cm-content');
        for(let i=0;i<250&&!ready()&&!window.__errors.length;i++)await new Promise(r=>setTimeout(r,20));
        if(!ready())throw Error('Viewer did not render: '+window.__errors.join(';'));
        await new Promise(r=>setTimeout(r,600));})()`);
      if (c.view === 'source') {
        await win.webContents.executeJavaScript(`(async()=>{window.__setMenuOpen(true);await new Promise(r=>setTimeout(r,200));
          const b=[...document.querySelectorAll('.desktop-editor-pane-menu-segment')][1];if(!b)throw Error('No source segment');b.click();
          window.__setMenuOpen(false);await new Promise(r=>setTimeout(r,600));})()`);
      }
      if (c.menu) {
        await win.webContents.executeJavaScript(`(async()=>{const pane=document.querySelector('.desktop-editor-pane');
          pane.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:innerWidth/2,clientY:12}));
          window.__setMenuOpen(true);await new Promise(r=>setTimeout(r,400));
          document.activeElement?.blur?.();})()`);
      }
      const state = await win.webContents.executeJavaScript(`(()=>{
        const pick=(selector,limit=400)=>[...document.querySelectorAll(selector)].slice(0,limit).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return {selector,tag:el.tagName,display:s.display,className:typeof el.className==='string'?el.className:'',rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100),
            font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,fontStyle:s.fontStyle,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,color:s.color,background:s.backgroundColor,
            padding:s.padding,margin:s.margin,border:[s.borderTop,s.borderRight,s.borderBottom,s.borderLeft].join(' | '),borderRadius:s.borderRadius,textDecoration:s.textDecorationLine,
            text:(el.textContent||'').trim().slice(0,120)}});
        const css=n=>getComputedStyle(document.body).getPropertyValue(n).trim();
        return {viewer:window.__viewerId,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],errors:window.__errors,
          tokens:Object.fromEntries(['--po-canvas','--po-text','--po-text-muted','--po-accent','--po-font-content','--po-font-mono','--po-user-text-size-content','--po-divider'].map(n=>[n,css(n)])),
          elements:[...pick('.desktop-editor-pane,.desktop-editor-pane-content,.desktop-editor-pane-handle-shell,.desktop-editor-pane-handle,.desktop-editor-pane-menu,.desktop-editor-pane-menu *[class]'),
            ...pick('.cm-editor,.cm-scroller,.cm-content,.cm-line,.cm-line *[class]'),
            ...pick('[class*="csv"]'),...pick('table,th,td'),...pick('[class*="cm-md-"]:not(.cm-line)',600)]};})()`);
      const image = await win.webContents.capturePage(); if (image.isEmpty()) throw Error('Empty reference');
      await writeFile(path.join(out, `${c.id}.png`), image.toPNG());
      await writeFile(path.join(out, `${c.id}.json`), JSON.stringify({scope: 'real product editor pane + viewer; in-memory fixture document', case: c, size: [WIDTH, HEIGHT], sourceCommit, sourceHashes: hashes, versions: {electron: process.versions.electron, chrome: process.versions.chrome}, ...state}, null, 2) + '\n');
      console.log(`Captured ${c.id} (${state.elements.length} elements${state.errors.length ? ', errors: ' + state.errors.join('; ') : ''})`);
    } finally { win.destroy(); }
  }
}
async function cleanup() { await rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(e => console.warn('Temporary profile cleanup:', e.message)); }
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
