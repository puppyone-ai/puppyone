// Resolve the product Markdown theme contract (--po-md-*, --po-markdown-editor-*,
// --po-editor-*) inside the real MarkdownViewer for every appearance × text
// scale, and write assets/editor/markdown-theme.json. Native layout reads only
// these values; formulas mirror the product CSS rules. `--check` fails on drift.
//   electron tools/import-editor-theme.mjs [--check]
import {app} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {bundleProduct, catalogs, openPage, source} from './product-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `--csv`: the CSV viewer's contract (csv-table-editor.css) instead.
const csv = process.argv.includes('--csv');
const out = path.join(root, csv ? 'assets/editor/csv-theme.json' : 'assets/editor/markdown-theme.json');
const check = process.argv.includes('--check');
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-editor-theme-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
// Markdown roles plus the interface roles markdown-editor.css consumes
// directly (caret, task checkbox, block rings), and the shared editable-table
// contract (editable-table.css), resolved on the table widget wrapper where
// Markdown binds it.
const TOKEN = csv
  ? /^--po-(editable-table|csv|host-csv|editor-padding)-|^--csv-table-|^--po-(editor-bg|text|text-muted|text-disabled|text-subtle|accent|control|control-size-tight|panel|divider|border|selected|shadow|elevation-low|text-size-caption|text-size-hint|text-size-content|plain-text-reading-weight|text-weight-medium|control-size|control-size-compact|text-selection-bg|text-selection-inactive-bg|selection-background|selection-inactive-background|surface-editor-mode-radius|surface-editor-mode-shadow)$/
  : /^--po-(md|markdown-editor|editor|editable-table)-|^--cm-md-block-|^--po-(text|text-inverse|text-muted|accent|control)$/;
const FILE = csv ? 'sample.csv' : 'sample.md';

async function run() {
  const {catalogs: catalog} = await catalogs(['editor', 'shared-ui', 'common']);
  const specimen = await readFile(path.join(root, 'fixtures/editor', FILE), 'utf8');
  const input = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {LocalizationProvider} from '@puppyone/localization/react';
import {resolveEditorViewer} from ${JSON.stringify(source('packages/shared-ui/src/editor/registry/viewerRegistry.tsx'))};
import {PresetViewerRenderer} from ${JSON.stringify(source('packages/shared-ui/src/editor/host/PresetViewerRenderer.tsx'))};
import {resolveTypography, DEFAULT_TYPOGRAPHY_PREFERENCES, withTypographyScale} from ${JSON.stringify(source('src/features/typography/fontCatalog.ts'))};
import {applyTypographyToElement} from ${JSON.stringify(source('src/features/typography/typographyRuntime.ts'))};
const catalogs=${JSON.stringify(catalog)};const noop=()=>{};
const f=window.fixture;
applyTypographyToElement(document.documentElement, resolveTypography(withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, f.scale)));
const state={locale:'en',preference:'en',direction:'ltr',systemLanguages:[]};
const localization={initialState:state,initialCatalog:catalogs.en,fallbackCatalog:catalogs.en,loadCatalog:async()=>({catalog:catalogs.en,fallbackCatalog:catalogs.en}),client:{onLocaleChanged:()=>noop,setLanguagePreference:async()=>state}};
const doc={path:${JSON.stringify(FILE)},name:${JSON.stringify(FILE)},type:${JSON.stringify(csv ? 'csv' : 'markdown')},version:'theme-1',markdownDialect:null,sourceKind:'local'};
const {viewer,format,resolvedExtension}=resolveEditorViewer(doc);
const context={document:doc,format,resolvedExtension,content:${JSON.stringify(specimen)},resourcePolicy:viewer.resourcePolicy,canEdit:true,hideSourceView:false,loading:false,fileUrlLoading:false,fileIconTheme:'default',
 editorInteractionPreferences:{showSaveStatus:false,markdownBlockDragEnabled:false,markdownHeadingOutlineEnabled:false},htmlTrustMode:'safe',workspaceId:'theme',workspaceRoot:'/theme',markdownEnvironment:null,documentNavigation:null,contextMapEnvironment:null,appPreview:null,aiEditFile:null};
createRoot(document.getElementById('root')).render(<LocalizationProvider {...localization}>
 <div className="desktop-editor-split-view" data-pane-count="1" style={{position:'absolute',inset:0}}><div className="desktop-editor-pane"><div className="desktop-editor-pane-content">
  <PresetViewerRenderer viewer={viewer} context={context}/></div></div></div></LocalizationProvider>);`;
  const bundle = await bundleProduct(input);
  const variants = {};
  await app.whenReady();
  for (const mode of ['dark', 'light']) for (const scale of ['small', 'medium', 'large']) {
    const win = await openPage(profile, {width: 1059, height: 760, mode, fixture: {scale}, ...bundle});
    try {
      variants[`${mode}/${scale}`] = await win.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;
        const HOST=${JSON.stringify(csv ? '.csv-table-editor' : '.markdown-codemirror-editor')};
        for(let i=0;i<250&&!document.querySelector(HOST+' '+${JSON.stringify(csv ? 'table' : '.cm-content')});i++)await new Promise(r=>setTimeout(r,20));
        const host=document.querySelector(HOST);
        if(!host)throw Error('Viewer did not render: '+window.__errors.join(';'));
        const names=new Set();
        const walk=rules=>{for(const rule of rules){if(rule.style)for(const p of rule.style)if(${TOKEN}.test(p))names.add(p);if(rule.cssRules)walk(rule.cssRules);}};
        for(const sheet of document.styleSheets){try{walk(sheet.cssRules)}catch{}}
        const box=document.createElement('div');box.style.cssText='position:absolute;visibility:hidden;left:0;top:0;width:1000px;contain:layout';host.append(box);
        const a=document.createElement('div');a.style.color='rgb(255, 0, 0)';const b=document.createElement('div');b.style.color='rgb(0, 0, 255)';box.append(a,b);
        const pa=document.createElement('div'),pb=document.createElement('div'),len=document.createElement('div'),pad=document.createElement('div');
        a.append(pa);b.append(pb);box.append(len,pad);
        const tokens={};
        const TABLE=${JSON.stringify(csv ? '.csv-table-editor' : '.markdown-codemirror-editor .cm-md-table-widget-wrap')};
        for(let i=0;i<250&&!document.querySelector(TABLE);i++)await new Promise(r=>setTimeout(r,20));
        const table=document.querySelector(TABLE);
        if(!table)throw Error('The specimen table widget did not render');
        for(const name of [...names].sort()){
          const owner=name.startsWith('--po-editable-table-')?table:host;
          owner.append(box);
          const raw=getComputedStyle(owner).getPropertyValue(name).trim();
          const t={raw};
          if(raw){
            pa.style.color=pb.style.color='var('+name+')';
            const ca=getComputedStyle(pa).color,cb=getComputedStyle(pb).color;
            if(ca===cb)t.color=ca;
            len.style.width='var('+name+')';
            const w=parseFloat(getComputedStyle(len).width);
            if(len.style.width&&!(w===1000&&!/^1000px$/.test(raw))&&/px|em|rem|calc|max|min|%|^0$/.test(raw))t.px=w;
            if(/^-?\\d+(\\.\\d+)?$/.test(raw))t.number=Number(raw);
            if(/^[\\d.]+px( [\\d.]+px){1,3}$/.test(raw)){pad.style.padding=raw;const s=getComputedStyle(pad);t.box=[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat);}
            len.style.width='';pa.style.color=pb.style.color='';
          }
          tokens[name]=t;
        }
        box.remove();
        const content=document.querySelector(${JSON.stringify(csv ? '.csv-table-editor table' : '.markdown-codemirror-editor .cm-content')});
        const cs=getComputedStyle(content);
        return {tokens,scaleAttribute:document.documentElement.getAttribute('data-typography-scale'),root:{fontFamily:cs.fontFamily,fontSize:cs.fontSize,fontWeight:cs.fontWeight,lineHeight:cs.lineHeight,color:cs.color,caretColor:cs.caretColor,padding:[cs.paddingTop,cs.paddingRight,cs.paddingBottom,cs.paddingLeft]}};
      })()`);
      console.log(`Resolved ${mode}/${scale}: ${Object.keys(variants[`${mode}/${scale}`].tokens).length} tokens`);
    } finally { win.destroy(); }
  }
  const result = {source: csv ? 'product CSV viewer contract resolved in CsvViewer (default.neutral)' : 'product Markdown theme contract resolved in MarkdownViewer (default.neutral)', sourceCommit: bundle.sourceCommit,
    inputs: Object.fromEntries(Object.entries(bundle.sourceHashes).filter(([p]) => /styles|theme|typography/i.test(p))), variants};
  const text = JSON.stringify(result, null, 1) + '\n';
  if (check) {
    const current = JSON.parse(await readFile(out, 'utf8'));
    if (JSON.stringify(current.variants) !== JSON.stringify(result.variants)) throw Error(`Stale ${path.relative(root, out)}: run electron tools/import-editor-theme.mjs${csv ? ' --csv' : ''}`);
    console.log(csv ? 'CSV theme verified' : 'Markdown theme verified');
  } else {
    await mkdir(path.dirname(out), {recursive: true}); await writeFile(out, text); console.log('Wrote', path.relative(root, out));
  }
}
const cleanup = () => rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(() => {});
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
