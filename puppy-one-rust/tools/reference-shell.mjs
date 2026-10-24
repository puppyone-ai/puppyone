import {productRoot} from './product-source.mjs';
// Actual product components in an isolated Electron profile. Fixture services
// are unavailable; this is NOT an operational Agent/Cloud or whole-App receipt.
import {app, BrowserWindow} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), repo=productRoot;
const modules=process.env.PUPPYONE_NODE_MODULES??path.join(repo,'node_modules');
const profile=mkdtempSync(path.join(os.tmpdir(),'puppyone-shell-reference-'));
app.setPath('userData',profile);app.on('window-all-closed',()=>{});
const out=path.join(root,'artifacts/shell-reference');
const source=p=>path.join(repo,p);
const components={settings:'src/features/settings/SettingsDialog.tsx',project:'src/features/app-shell/DesktopWorkspaceSwitcher.tsx',feedback:'src/features/app-shell/DesktopHelpLauncher.tsx',agent:'src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher.tsx'};
async function run(){
 const {build}=await import(pathToFileURL(path.join(modules,'esbuild/lib/main.js')));
 const alias={'react':path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),
 '@puppyone/shared-ui/control-geometry.css':source('packages/shared-ui/src/styles/control-geometry.css'),
 '@puppyone/shared-ui/shared-ui-patterns.css':source('packages/shared-ui/src/styles/shared-ui-patterns.css'),
 '@puppyone/shared-ui/editor.css':source('packages/shared-ui/src/styles/editor.css'),
 '@puppyone/shared-ui/markdown-presentation-preview':source('packages/shared-ui/src/markdown-presentation-preview.ts'),
 '@puppyone/shared-ui':source('packages/shared-ui/src/index.ts'),
 '@puppyone/localization/core':source('packages/localization/src/core/index.ts'),
 '@puppyone/localization/react':source('packages/localization/src/react/index.ts'),
 '@puppyone/localization':source('packages/localization/src/index.ts')};
 const catalogs={},catalogPaths=[];
 for(const locale of ['en','zh-Hans']){catalogs[locale]={};for(const ns of ['settings','shell','common','updates','shared-ui','workspace','agent','terminal']){
  const p=`locales/renderer/${locale}/${ns}.json`;catalogPaths.push(p);
  const values=JSON.parse(await readFile(source(p),'utf8'));for(const [key,value] of Object.entries(values))catalogs[locale][`${ns}.${key}`]=value;
 }}
 const input=`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {LocalizationProvider} from '@puppyone/localization/react';
 import {SettingsDialog} from ${JSON.stringify(source(components.settings))};
 import {DesktopWorkspaceSwitcher} from ${JSON.stringify(source(components.project))};
 import {DesktopHelpLauncher} from ${JSON.stringify(source(components.feedback))};
 import {AuxiliaryWorkbenchLauncher} from ${JSON.stringify(source(components.agent))};
 import {ProjectWorkbenchStore} from ${JSON.stringify(source('src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore.ts'))};
 const catalogs=${JSON.stringify(catalogs)};const noop=()=>{};
 window.puppyoneDesktop={getPlatformCapabilities:async()=>({platform:'macos'})};
 const workspace={id:'fixture',name:'Reference',path:'/reference/project'};
 const store=new ProjectWorkbenchStore({projectId:'fixture',generation:'reference',rootPath:workspace.path});
 const initialState={locale:window.fixture.locale,preference:window.fixture.locale,direction:'ltr',systemLanguages:[]};
 const localization={initialState,initialCatalog:catalogs[initialState.locale],fallbackCatalog:catalogs.en,
 loadCatalog:async locale=>({catalog:catalogs[locale],fallbackCatalog:catalogs.en}),client:{onLocaleChanged:()=>noop,setLanguagePreference:async preference=>({...initialState,preference,locale:preference})}};
 function Fixture(){const ref=React.useRef(null);const [section,setSection]=React.useState('general');
 React.useEffect(()=>{window.__referenceReady=true;},[]);
 const theme={theme:window.fixture.mode,subThemeId:'default.neutral'};
 let body=null;
 if(window.fixture.surface==='settings') body=<SettingsDialog onClose={noop} workspace={workspace} activeSection={section} onSelectSection={setSection}
 preferences={{experimentalSettings:{enableOtherAppImports:false},titlebarActionsSettings:{order:['changes','terminal']}}}
 subThemeCatalog={{}} onFilesVisibilitySettingsChange={noop} onOpenImport={noop}
 git={{status:null,loading:false,error:null,refresh:noop}} cloud={{enabled:false,session:null,sessionRestoring:false,apiBaseUrl:null,onSessionChange:noop}}
 workspaceConfig={{value:null,loading:false,saving:false,error:null,change:async()=>null,unlink:async()=>{}}}
 updates={{state:{status:'disabled',channel:'dev',blockers:[],currentVersion:'reference'},check:noop,install:noop,automaticDownloadPreferenceAvailable:false,automaticDownloadPreferenceSaving:false,automaticDownloadPreferenceError:false,setAutomaticallyDownloadUpdates:noop}}/>;
 if(window.fixture.surface==='project') body=<div style={{position:'absolute',left:'50%',top:6,transform:'translateX(-50%)'}}><DesktopWorkspaceSwitcher open refObject={ref} titlebarLabel="Reference" menuAlignment="center" workspace={workspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false} projectLocation={{current:'local',localAvailable:true,cloudState:'unavailable'}} onClose={noop} onToggle={noop}/></div>;
 if(window.fixture.surface==='feedback') body=<DesktopHelpLauncher {...theme}/>;
 if(window.fixture.surface==='agent') body=<div style={{position:'absolute',right:0,top:40,bottom:0,width:360,display:'grid',gridTemplateRows:'1fr'}}><AuxiliaryWorkbenchLauncher store={store} contributions={[]} hiddenAgentIds={[]} groupId={null} itemId={null} presented={false}/></div>;
 return <LocalizationProvider {...localization}>{body}</LocalizationProvider>;
 };createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const sharedPackage=JSON.parse(await readFile(source('packages/shared-ui/package.json'),'utf8'));
 // Respect package CSS entrypoints without resolving a different worktree.
 for(const [key,value] of Object.entries(sharedPackage.exports??{}))if(key.endsWith('.css')&&typeof value==='string')alias[`@puppyone/shared-ui/${key.slice(2)}`]=source(`packages/shared-ui/${value}`);
 const plugins=[{name:'offline-public-assets',setup(b){b.onResolve({filter:/^\/(fonts|assets)\//},args=>({path:source(`public${args.path}`)}));}}];
 const bundle=await build({absWorkingDir:repo,stdin:{contents:input,resolveDir:repo,loader:'tsx'},nodePaths:[modules],alias,plugins,bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'production',BASE_URL:pathToFileURL(source('public')).href+'/'})},loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl','.png':'dataurl'},metafile:true,outfile:'fixture.js'});
 const css=await build({absWorkingDir:repo,entryPoints:[source('src/styles/cascade.css'),source('src/styles.css')],nodePaths:[modules],alias,plugins,bundle:true,write:false,loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl','.png':'dataurl'},metafile:true,outdir:'fixture-css'});
 const themePath='src/features/themes/builtinSubThemes.generated.ts';
 const themeSource=await readFile(source(themePath),'utf8');
 const compiled=themeSource.match(/const DEFAULT_NEUTRAL_COMPILED_CSS = Object.freeze\((\{[\s\S]*?\n\})\);/);
 if(!compiled)throw Error('Review generated Default-neutral projection');
 const themeCss=JSON.parse(compiled[1]).application;
 const inputs=[...new Set([...Object.keys(bundle.metafile.inputs),...Object.keys(css.metafile.inputs),...catalogPaths,themePath])].filter(p=>!p.startsWith('<')&&!p.startsWith('(disabled):'));
 const hashes=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,createHash('sha256').update(await readFile(path.resolve(repo,p.split('?')[0]))).digest('hex')])));
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 const workingTree=execFileSync('git',['status','--porcelain','--',...Object.values(components),'src/styles','packages/shared-ui','locales'],{cwd:repo,encoding:'utf8'}).trim();
 await mkdir(out,{recursive:true});await app.whenReady();
 for(const surface of Object.keys(components))for(const mode of ['light','dark'])for(const locale of ['en','zh-Hans']){
  const win=new BrowserWindow({width:1280,height:800,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true}));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const errors=[];win.webContents.on('console-message',(_event,_level,message)=>{if(/Error|missing-message|invalid-message/.test(message))errors.push(message);});
  try{
   const style=[...css.outputFiles,...bundle.outputFiles.filter(f=>f.path.endsWith('.css'))].map(f=>f.text).join('\n');
   const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
   const html=`<!doctype html><html lang="${locale}" class="${mode==='dark'?'dark':''}" data-interface-style="default"><meta charset="utf-8"><style>${style}\n${themeCss}\nhtml,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--po-editor-bg);color:var(--po-text)}</style><body class="app-shell theme-root ${mode==='dark'?'dark':''}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"><div id="root"></div><div id="desktop-overlay-root" class="desktop-overlay-root ${mode==='dark'?'dark':''}" data-po-appearance-root data-sub-theme-id="default.neutral" data-interface-style="default"></div><script>window.fixture=${JSON.stringify({surface,mode,locale})};window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));</script><script type="module">${script.replaceAll('</script','<\\/script')}</script>`;
   const page=path.join(profile,'fixture.html');await writeFile(page,html);await win.loadFile(page);
   await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;for(let i=0;i<150&&!window.__referenceReady&&!window.__errors.length;i++)await new Promise(r=>setTimeout(r,20));if(!window.__referenceReady)throw Error('Fixture did not render: '+window.__errors.join(';'));if(window.fixture.surface==='feedback')document.querySelector('button').click();await new Promise(r=>setTimeout(r,300));if(window.__errors.length)throw Error(window.__errors.join(';'));})()`);
   const state=await win.webContents.executeJavaScript(`({dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],appearance:{canvas:getComputedStyle(document.body).getPropertyValue('--po-canvas').trim(),header:getComputedStyle(document.body).getPropertyValue('--po-header').trim()},locale:document.documentElement.lang,regions:[...document.querySelectorAll('[role=dialog],.desktop-settings-dialog-header,.desktop-settings-dialog-content,.desktop-project-menu,.desktop-settings-row,.desktop-settings-dialog-navigation,.desktop-terminal-launcher,.po-sidebar-row,.po-desktop-sidebar-group__header,.desktop-settings-section-header,.desktop-language-setting-select')].map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{selector:el.className,rect:[r.x,r.y,r.width,r.height],font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,background:s.backgroundColor,padding:s.padding,border:s.border,opacity:s.opacity,text:el.textContent?.trim().slice(0,160)}})})`);
   if(state.appearance.canvas!==(mode==='dark'?'#161616':'#fafafa'))throw Error('Incorrect theme projection: '+JSON.stringify(state.appearance));
   const image=await win.webContents.capturePage();if(image.isEmpty())throw Error('Empty reference');
   const id=`${surface}-${mode}-${locale}`;await writeFile(path.join(out,`${id}.png`),image.toPNG());
   await writeFile(path.join(out,`${id}.json`),JSON.stringify({scope:'real product component; offline unavailable-service fixture, not full App or service parity',component:components[surface],sourceCommit,workingTree,sourceHashes:hashes,mode,locale,versions:process.versions,errors,...state},null,2)+'\n');
   console.log(`Captured ${id}`);
  }finally{win.destroy();}
 }
}
async function cleanup(){await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:100}).catch(e=>console.warn('Temporary profile cleanup:',e.message));}
void run().then(async()=>{await cleanup();app.quit();}).catch(async e=>{console.error(e);await cleanup();app.exit(1);});
