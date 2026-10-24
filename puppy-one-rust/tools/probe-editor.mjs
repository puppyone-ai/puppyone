// Ground truth for the native Markdown editor: render the product
// MarkdownViewer (real CodeMirror + product CSS + default sub-theme) with a
// document and selection, then dump line boxes, per-character rectangles and
// computed text styles, widget boxes, list-marker pseudo-elements, the caret
// and the selection. tools/compare-editor-geometry.py diffs this against the
// native editor's own dump.
//   electron tools/probe-editor.mjs spec.json
// spec: {file, mode: dark|light, scale: small|medium|large, width, height,
//        selection?: [anchor, head], focus?: bool, out, screenshot?: path}
import {app} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {bundleProduct, catalogs, openPage, source} from './product-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(await readFile(process.argv.at(-1), 'utf8'));
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-editor-probe-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});

async function run() {
  const {catalogs: catalog} = await catalogs(['editor', 'shared-ui', 'common']);
  const text = spec.text ?? await readFile(path.resolve(root, spec.file), 'utf8');
  const input = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {EditorView} from '@codemirror/view';
import {LocalizationProvider} from '@puppyone/localization/react';
import {resolveEditorViewer} from ${JSON.stringify(source('packages/shared-ui/src/editor/registry/viewerRegistry.tsx'))};
import {PresetViewerRenderer} from ${JSON.stringify(source('packages/shared-ui/src/editor/host/PresetViewerRenderer.tsx'))};
import {resolveTypography, DEFAULT_TYPOGRAPHY_PREFERENCES, withTypographyScale} from ${JSON.stringify(source('src/features/typography/fontCatalog.ts'))};
import {applyTypographyToElement} from ${JSON.stringify(source('src/features/typography/typographyRuntime.ts'))};
window.__EditorView=EditorView;
const catalogs=${JSON.stringify(catalog)};const noop=()=>{};
const f=window.fixture;
applyTypographyToElement(document.documentElement, resolveTypography(withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, f.scale)));
const state={locale:'en',preference:'en',direction:'ltr',systemLanguages:[]};
const localization={initialState:state,initialCatalog:catalogs.en,fallbackCatalog:catalogs.en,loadCatalog:async()=>({catalog:catalogs.en,fallbackCatalog:catalogs.en}),client:{onLocaleChanged:()=>noop,setLanguagePreference:async()=>state}};
const doc={path:'probe.md',name:'probe.md',type:'markdown',version:'probe-1',markdownDialect:null,sourceKind:'local'};
const {viewer,format,resolvedExtension}=resolveEditorViewer(doc);
const context={document:doc,format,resolvedExtension,content:f.text,resourcePolicy:viewer.resourcePolicy,canEdit:true,hideSourceView:false,loading:false,fileUrlLoading:false,fileIconTheme:'default',
 editorInteractionPreferences:{showSaveStatus:false,markdownBlockDragEnabled:false,markdownHeadingOutlineEnabled:false},htmlTrustMode:'safe',workspaceId:'probe',workspaceRoot:'/probe',markdownEnvironment:null,documentNavigation:null,contextMapEnvironment:null,appPreview:null,aiEditFile:null};
createRoot(document.getElementById('root')).render(<LocalizationProvider {...localization}>
 <div className="desktop-editor-split-view" data-pane-count="1" style={{position:'absolute',inset:0}}><div className="desktop-editor-pane"><div className="desktop-editor-pane-content">
  <PresetViewerRenderer viewer={viewer} context={context}/></div></div></div></LocalizationProvider>);`;
  const bundle = await bundleProduct(input);
  await app.whenReady();
  const win = await openPage(profile, {width: spec.width ?? 1059, height: spec.height ?? 760, mode: spec.mode ?? 'dark', fixture: {scale: spec.scale ?? 'medium', text}, ...bundle});
  try {
    const result = await win.webContents.executeJavaScript(`(async()=>{
      await document.fonts.ready;
      for(let i=0;i<250&&!document.querySelector('.markdown-codemirror-editor .cm-content');i++)await new Promise(r=>setTimeout(r,20));
      const dom=document.querySelector('.cm-editor');
      if(!dom)throw Error('Markdown viewer did not render: '+window.__errors.join(';'));
      const view=window.__EditorView.findFromDOM(dom);
      const spec=${JSON.stringify({selection: spec.selection ?? null, focus: spec.focus ?? false})};
      if(spec.focus)view.focus();
      if(spec.selection)view.dispatch({selection:{anchor:spec.selection[0],head:spec.selection[1]}});
      await new Promise(r=>setTimeout(r,500));
      const r4=r=>[r.x,r.y,r.width,r.height].map(v=>Math.round(v*1000)/1000);
      const content=document.querySelector('.cm-content');
      const origin=content.getBoundingClientRect();
      const text=el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,weight:s.fontWeight,style:s.fontStyle,family:s.fontFamily.split(',')[0].replaceAll('"',''),size:s.fontSize,lineHeight:s.lineHeight,decoration:s.textDecorationLine,decorationColor:s.textDecorationColor,decorationThickness:s.textDecorationThickness};};
      const lines=[...content.querySelectorAll(':scope > .cm-line, :scope > .cm-widgetBuffer, :scope > *')].map(el=>{const s=getComputedStyle(el);const b=getComputedStyle(el,'::before');
        return {className:el.className,rect:r4(el.getBoundingClientRect()),padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],lineHeight:s.lineHeight,fontSize:s.fontSize,background:s.backgroundColor,borderLeft:s.borderLeftWidth+' '+s.borderLeftColor,boxShadow:s.boxShadow,
          from:(()=>{try{return view.posAtDOM(el,0)}catch{return null}})(),
          before:b.content&&b.content!=='none'?{content:b.content,left:b.left,top:b.top,width:b.width,height:b.height,color:b.color,weight:b.fontWeight,justify:b.justifyContent,numeric:b.fontVariantNumeric,size:b.fontSize}:null};});
      const chars=[];
      const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        const parent=node.parentElement;if(!parent||parent.closest('.cm-md-hidden-syntax'))continue;
        let pos;try{pos=view.posAtDOM(node,0)}catch{continue}
        const st=text(parent);
        for(let i=0;i<node.data.length;i++){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const rects=[...range.getClientRects()];
          chars.push({at:pos+i,ch:node.data[i],rect:rects[0]?r4(rects[0]):null,cls:parent.className,...st});}
      }
      const widgets=[...content.querySelectorAll('[class*="cm-md-"]:not(.cm-line)')].map(el=>{const s=getComputedStyle(el);return {className:typeof el.className==='string'?el.className:'',tag:el.tagName,rect:r4(el.getBoundingClientRect()),background:s.backgroundColor,border:[s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth].join(' ')+' '+s.borderTopColor,radius:s.borderRadius,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],...text(el)};});
      const sel=window.getSelection();const selection=[];
      for(let i=0;i<sel.rangeCount;i++)for(const r of sel.getRangeAt(i).getClientRects())selection.push(r4(r));
      const head=view.state.selection.main.head;
      let caret=null;try{const r=document.createRange();const p=view.domAtPos(head);r.setStart(p.node,p.offset);r.collapse(true);const rs=[...r.getClientRects()];caret=rs[0]?r4(rs[0]):null;}catch{}
      return {viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,content:r4(origin),scroller:r4(document.querySelector('.cm-scroller').getBoundingClientRect()),selection:{main:[view.state.selection.main.anchor,view.state.selection.main.head],rects:selection},coords:view.coordsAtPos(head),caret,lines,chars,widgets,errors:window.__errors};
    })()`);
    if (spec.screenshot) { const image = await win.webContents.capturePage(); await mkdir(path.dirname(path.resolve(root, spec.screenshot)), {recursive: true}); await writeFile(path.resolve(root, spec.screenshot), image.toPNG()); }
    const out = path.resolve(root, spec.out);
    await mkdir(path.dirname(out), {recursive: true});
    await writeFile(out, JSON.stringify({spec, ...result}, null, 1) + '\n');
    console.log('Probed', path.relative(root, out), `${result.lines.length} lines, ${result.chars.length} chars`);
  } finally { win.destroy(); }
}
const cleanup = () => rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(() => {});
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
