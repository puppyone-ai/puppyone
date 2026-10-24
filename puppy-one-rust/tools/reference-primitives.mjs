import {productRoot} from './product-source.mjs';
// Development-only REAL React component probe, not part of the Rust runtime.
// This supplements, not replaces, the incomplete full-shell synthetic reference.
import {app, BrowserWindow} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=productRoot;
const modules=path.resolve(process.env.PUPPYONE_NODE_MODULES??path.join(repo,'node_modules'));
const profile=mkdtempSync(path.join(os.tmpdir(),'puppyone-rust-primitives-'));
app.setPath('userData',profile);
app.on('window-all-closed',()=>{}); // two sequential fixture windows; quit after both
const components=['packages/shared-ui/src/sidebar/SidebarRow.tsx','packages/shared-ui/src/sidebar/SidebarIconButton.tsx','packages/shared-ui/src/sidebar/SidebarList.tsx'];
const cssPaths=['src/styles/cascade.css','src/styles/base.css','packages/shared-ui/src/styles/control-geometry.css','src/styles/typography/foundations.css','src/styles/typography/locales.css','src/styles/typography/roles.css','src/styles/tokens.css','packages/shared-ui/src/styles/sidebar-primitives.css'];
const inputs=[...components,'src/styles.css','packages/shared-ui/src/styles/shared-ui-patterns.css','packages/shared-ui/src/sidebar/classNames.ts',...cssPaths,'sub-themes/default-neutral/theme.css','public/fonts/geist/Geist-Variable.woff2'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run() {
 const {build}=await import(pathToFileURL(path.join(modules,'esbuild/lib/main.js')));
 execFileSync('git',['diff','--quiet','HEAD','--',...inputs],{cwd:repo});
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 const hashes=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,hash(await readFile(path.join(repo,p)))])));
 const bundle=await build({stdin:{resolveDir:repo,loader:'tsx',contents:`
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {FileText, Settings, House} from 'lucide-react';
  import {SidebarRow} from ${JSON.stringify(path.join(repo,components[0]))};
  import {SidebarIconButton} from ${JSON.stringify(path.join(repo,components[1]))};
  import {SidebarList} from ${JSON.stringify(path.join(repo,components[2]))};
  function Fixture(){React.useEffect(()=>{window.__referenceReady=true;},[]);return <><SidebarList>
   <SidebarRow id="normal" label="README.md" icon={<FileText size={16}/>}/>
   <SidebarRow id="active" active label="Selected document" icon={<FileText size={16}/>}/>
   <SidebarRow id="disabled" disabled label="Unavailable document" icon={<FileText size={16}/>}/>
   <SidebarRow id="long" label="A long document label that must truncate within the row" icon={<FileText size={16}/>}/>
   <SidebarRow id="focus" label="Keyboard focus" icon={<FileText size={16}/>}/>
   </SidebarList><div style={{display:'flex',gap:4,marginTop:16}}><SidebarIconButton id="settings" label="Settings" icon={<Settings size={14} strokeWidth={1.65}/>}/><SidebarIconButton id="home" label="Home" icon={<House size={14} strokeWidth={1.65}/>}/></div>
  </>}; createRoot(document.querySelector('#fixture')).render(<Fixture/>);`},nodePaths:[modules],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 // Preserve import-layer ownership from src/styles.css. Concatenating raw
 // base.css would make its unlayered `button {font:inherit}` override rows.
 const css=(await Promise.all(cssPaths.map(async p=>{
  const source=await readFile(path.join(repo,p),'utf8');
  if(p.endsWith('cascade.css'))return source;
  const layer=p.endsWith('base.css')?'reset':p.endsWith('sidebar-primitives.css')?'patterns':'tokens';
  return `@layer ${layer}{${source}}`;
 }))).join('\n');
 const theme=await readFile(path.join(repo,'sub-themes/default-neutral/theme.css'),'utf8');
 const light=theme.match(/@puppyone application\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/)?.[1];
 const dark=theme.match(/\.dark \.theme-root\s*\{([\s\S]*?)\n  \}/)?.[1];
 if(!light||!dark)throw new Error('Default-neutral grammar changed; review fixture projection');
 const font=(await readFile(path.join(repo,'public/fonts/geist/Geist-Variable.woff2'))).toString('base64');
 const out=path.join(root,'artifacts/primitives-reference');await mkdir(out,{recursive:true});
 await app.whenReady();
 for(const mode of ['light','dark']) {
  const win=new BrowserWindow({width:360,height:300,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try {
   // Wrapper supplies only placement and a Default/Medium scope; component
   // structure and state styles come from the actual product modules above.
   const html=`<!doctype html><html lang="en" data-interface-style="default"><meta charset="utf-8"><style>${css}\n@font-face{font-family:'Geist Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}html,body{margin:0;width:100%;height:100%;overflow:hidden}.app-shell{${light}${mode==='dark'?dark:''};--po-font-ui:'Geist Sans',sans-serif;color-scheme:${mode};height:100%;background:var(--po-sidebar)}#fixture{position:absolute;left:12px;top:12px;width:196px}</style><body class="app-shell ${mode==='dark'?'dark':''}"><div id="fixture"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`;
   const page=path.join(profile,`fixture-${mode}.html`);
   await writeFile(page,html);await win.loadFile(page);
   const state=await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;for(let i=0;i<100&&!window.__referenceReady;i++)await new Promise(r=>setTimeout(r,10));if(!window.__referenceReady)throw Error('React did not commit');document.querySelector('#focus').focus();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return Object.fromEntries(['normal','active','disabled','long','focus','settings','home'].map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect(),s=getComputedStyle(el);return [id,{rect:[r.x,r.y,r.width,r.height],font:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,radius:s.borderRadius,padding:s.padding,disabled:el.disabled,focused:el===document.activeElement}]}));})()`);
   if(Object.values(state).some(x=>x.rect[2]<=0||x.rect[3]<=0))throw Error('Blank component geometry');
   if(state.normal.fontSize!=='14px'||state.normal.rect[3]!==32||!state.disabled.disabled||!state.focus.focused)throw Error('Default/Medium component contract differs: '+JSON.stringify(state));
   const bitmap=await win.webContents.capturePage();if(bitmap.isEmpty())throw Error('Empty capture');
   const provenance={scope:'real SidebarRow/SidebarIconButton + production CSS; Default-neutral fixture projection, not full App/Appearance parity',sourceCommit,sourceHashes:hashes,mode,scale:'medium',platform:process.platform,arch:process.arch,versions:{electron:process.versions.electron,chrome:process.versions.chrome,react:JSON.parse(await readFile(path.join(modules,'react/package.json'),'utf8')).version},...await win.webContents.executeJavaScript('({devicePixelRatio,viewport:[innerWidth,innerHeight]})'),components:state};
   await writeFile(path.join(out,`${mode}.png`),bitmap.toPNG());await writeFile(path.join(out,`${mode}.json`),JSON.stringify(provenance,null,2)+'\n');
  } finally {win.destroy();}
 }
 console.log(`Real product primitive references captured: ${out}`);
}
void run().then(async()=>{await rm(profile,{recursive:true,force:true});app.quit();}).catch(async error=>{console.error(error.message);await rm(profile,{recursive:true,force:true});app.exit(1);});
