// electron tools/reference-ui-assets.mjs spec.json
// Real product components + complete production stylesheet, offline profile.
import {app} from 'electron';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {bundleProduct,openPage} from './product-renderer.mjs';
const root=path.resolve(import.meta.dirname,'..');
const spec=JSON.parse(await readFile(process.argv[2],'utf8'));
const board=JSON.parse(await readFile(path.join(root,'fixtures/ui/asset-gallery.json'),'utf8'));
const profile=spec.profile??await mkdtemp(path.join(os.tmpdir(),'puppyone-asset-reference-'));
const cleanup=()=>spec.profile?Promise.resolve():rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
async function run(){
 const bundle=await bundleProduct(`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {TestLocalizationProvider} from './packages/localization/src/testing/TestLocalizationProvider';
 import {PRODUCT_ICONS} from './packages/shared-ui/src/icons/productIcons';
 import {FileGlyphIcon} from './packages/shared-ui/src/file/fileIcons';
 const registry=PRODUCT_ICONS;
 import {LoadingMark} from './packages/shared-ui/src/primitives/LoadingMark';
 import {PlaceholderLayer,LoadingPlaceholderStyleProvider} from './packages/shared-ui/src/primitives/LoadingPlaceholder';
 const {board,time,still}=window.fixture;
 Object.defineProperty(performance,'now',{value:()=>time*1000});
 const actualMatchMedia=window.matchMedia.bind(window);
 if(still)window.matchMedia=q=>q==='(prefers-reduced-motion: reduce)'?{matches:true,media:q,addEventListener(){},removeEventListener(){}}:actualMatchMedia(q);
 function Fixture(){React.useEffect(()=>{window.__ready=true;},[]);return <TestLocalizationProvider>{board.items.map(item=>{
  let child;
  if(item.kind==='icon'){const Icon=registry[item.name];child=<Icon size={item.size} strokeWidth={item.stroke}/>;}
  if(item.kind==='mark')child=<LoadingMark size={item.size} tone={item.tone} layout={item.layout} loadingStyle={item.style} ariaHidden/>;
  if(item.kind==='file')child=<FileGlyphIcon name={item.name} type={item.nodeType} size={item.size} theme={item.theme}/>;
  if(item.kind==='placeholder')child=<LoadingPlaceholderStyleProvider style={item.style}><div className="po-placeholder-surface" style={{width:item.w,height:item.h}}>{item.shapes.map((s,i)=><span key={i} data-placeholder-shape="" style={{position:'absolute',left:s.x,top:s.y,width:s.width,height:s.height,borderRadius:s.radius}}/>)}<PlaceholderLayer/></div></LoadingPlaceholderStyleProvider>;
  return <div key={item.id} data-asset-id={item.id} style={{position:'absolute',left:item.x,top:item.y,width:item.w,height:item.h,color:'var(--po-'+(item.ink??'text')+')',display:'flex',alignItems:'center',justifyContent:'center'}}>{child}</div>;
 })}</TestLocalizationProvider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
 await app.whenReady();
 const win=await openPage(profile,{width:board.width,height:board.height,mode:spec.mode,fixture:{board,time:spec.time,still:spec.still??false},...bundle});
 try {
   if(spec.still){win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});}
   const state=await win.webContents.executeJavaScript(`(async()=>{
     for(let i=0;i<200&&!window.__ready;i++)await new Promise(r=>setTimeout(r,10));
     if(!window.__ready)throw Error('Reference did not mount');
     await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));
     await new Promise(r=>setTimeout(r,150));
     for(const a of document.getAnimations()){a.pause();a.currentTime=${spec.time*1000};}
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
     return {errors:window.__errors,dpr:devicePixelRatio,items:[...document.querySelectorAll('[data-asset-id]')].map(e=>({id:e.dataset.assetId,rect:rect(e),children:[...e.querySelectorAll('[data-loading-mark-unit],[data-loading-mark-baton]')].map(c=>({rect:rect(c),opacity:getComputedStyle(c).opacity})),color:getComputedStyle(e).color}))};
   })()`);
   if(state.errors.length)throw Error(JSON.stringify(state.errors));
   await mkdir(path.dirname(spec.out),{recursive:true});
   await writeFile(spec.out+'.png',(await win.webContents.capturePage()).toPNG());
   await writeFile(spec.out+'.json',JSON.stringify({...state,sourceCommit:bundle.sourceCommit,sourceHashes:bundle.sourceHashes,spec},null,2)+'\n');
 } finally {win.destroy();}
}
run().then(async()=>{await cleanup();app.quit();}).catch(async e=>{console.error(e);await cleanup();app.exit(1);});
