import {productRoot} from './product-source.mjs';
// Development-only Electron renderer reference. NOT part of the Rust application.
// Uses current product CSS verbatim, a synthetic tree, and no preload / account / real files.
import {app, BrowserWindow} from 'electron';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const profile=mkdtempSync(path.join(os.tmpdir(),'puppyone-rust-reference-'));
app.setPath('userData',profile);

async function main() {
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=productRoot;
const dark=process.env.PUPPYONE_THEME!=='light';
const width=Number(process.env.PUPPYONE_WIDTH??1280),height=Number(process.env.PUPPYONE_HEIGHT??800);
const right=process.env.PUPPYONE_RIGHT==='1';
const out=path.resolve(root,process.env.PUPPYONE_REFERENCE??`artifacts/reference-${dark?'dark':'light'}.png`);
const read=p=>readFile(path.join(repo,p),'utf8');
const cssPaths=['packages/shared-ui/src/styles/control-geometry.css','src/styles/typography/foundations.css','src/styles/tokens.css','src/styles/scrollbars.css','src/styles/titlebar.css','src/styles/shell.css','packages/shared-ui/src/styles/data-workspace.css','src/features/data-workspace/browser.css','src/features/data-workspace/data-shell.css'];
const css=(await Promise.all(cssPaths.map(read))).join('\n');
const theme=await read('sub-themes/default-neutral/theme.css');
const lightTokens=theme.match(/@puppyone application\s*\{\s*:root\s*\{([\s\S]*?)\n  \}/)[1];
const darkTokens=theme.match(/\.dark \.theme-root\s*\{([\s\S]*?)\n  \}/)[1];
const font=(await readFile(path.join(repo,'public/fonts/geist/Geist-Variable.woff2'))).toString('base64');
const fixture=JSON.parse(await readFile(path.join(root,'fixtures/tree.json'),'utf8'));
const icon=async(name,size=16,stroke=1.8)=> (await readFile(path.join(root,'assets/icons',`${name}.svg`),'utf8')).replace('stroke="white"','stroke="currentColor"').replace('width="24" height="24"',`width="${size}" height="${size}"`).replace('stroke-width="1.8"',`stroke-width="${stroke}"`);
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
let index=0;
async function rows(nodes,depth=0,parent='') {
 let html='';
 for(const n of nodes) {
  const id=parent+n.name;
  const selected=id==='document/puppyone-desktop/architecture/02-native-shell.md';
  const symbol=n.folder?(n.expanded?'chevron-down':'chevron-right'):'file-text';
  html+=`<div class="explorer-tree-virtual-row" style="transform:translateY(${index++*34}px)"><div class="explorer-tree-motion-shell" data-depth="${depth}" style="--depth:${depth}"><button class="tree-row ${n.folder?'folder':'file'} ${selected?'selected':''}"><span class="tree-row-content"><span class="tree-icon-slot">${(await icon(symbol,n.folder?14:16)).replace('<svg ',`<svg class="${n.folder?'tree-disclosure-marker':''}" `)}</span><span class="tree-label"><span class="tree-label-primary">${escape(n.name.replace(/\.md$/,''))}</span></span></span></button></div></div>`;
  if(n.expanded) html+=await rows(n.children??[],depth+1,id+'/');
 }
 return html;
}
const tree=await rows(fixture);
const html=`<!doctype html><html data-po-scrollbar-mode="product" data-interface-style="default"><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}button{font:inherit;padding:0}svg{display:block;flex-shrink:0}
${css}
@font-face{font-family:'Geist Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
.app-shell{${lightTokens}${dark?darkTokens:''}--po-font-ui:'Geist Sans',sans-serif;font-family:var(--po-font-ui)}
.fixture-workbench{position:absolute;top:40px;bottom:0;left:0;right:0;display:flex}
.fixture-left{width:220px;flex:none;display:flex;flex-direction:column;background:var(--po-sidebar);position:relative}
.fixture-tree{height:calc(100% - 48px);flex:none;overflow:hidden}
.fixture-footer{height:48px;flex:none;display:flex;align-items:center;padding-left:12px;gap:4px;background:var(--po-sidebar)}
.fixture-footer button{width:28px;height:28px;display:grid;place-items:center;border:0;background:transparent;color:color-mix(in srgb,var(--po-text-muted) 80%,var(--po-sidebar))}
.fixture-editor{flex:1;min-width:200px;background:var(--po-surface-editor)}
.fixture-right{width:${right?'360':'0'}px;flex:none;background:var(--po-surface-editor)}
.fixture-left:after,.fixture-right:before{position:absolute;width:1px;top:0;bottom:0;background:var(--po-shell-divider);content:''}
.fixture-left:after{right:0}.fixture-right{position:relative}.fixture-right:before{left:-1px;display:${right?'block':'none'}}
.desktop-titlebar:after{position:absolute;left:1px;right:1px;bottom:0;height:1px;background:var(--po-header-divider);content:''}
.tree-disclosure-marker{opacity:.82}
</style>
<div class="app-shell ${dark?'dark':''}"><div class="desktop-shell" data-titlebar-sidebar-state="expanded">
<header class="desktop-titlebar" data-window-chrome-mode="overlay" data-window-platform="macos" data-centered-project="true">
 <div class="desktop-titlebar-layout"><div class="desktop-titlebar-leading"><div class="desktop-titlebar-left"><button class="desktop-titlebar-context-icon-button desktop-titlebar-home">${await icon('house',14,1.65)}</button></div><div class="desktop-titlebar-drag-fill"></div></div>
 <div class="desktop-titlebar-centered-context"><button class="desktop-titlebar-workspace-button local"><span class="desktop-titlebar-workspace-mark">${await icon('laptop')}</span><span class="desktop-titlebar-workspace-name">puppyone</span></button></div>
 <div class="desktop-titlebar-trailing"><div class="desktop-titlebar-actions"><button class="desktop-titlebar-action desktop-titlebar-changes"><span class="desktop-titlebar-git-status"><span class="desktop-titlebar-git-indicator outgoing">${await icon('arrow-up',15,2)}<span>2</span></span><span class="desktop-titlebar-git-indicator local">${await icon('asterisk',15,1.9)}<span>3</span></span></span></button><span class="desktop-titlebar-action-divider"></span><button class="desktop-titlebar-action desktop-titlebar-terminal">${await icon('message-square')}</button></div></div>
 </div></header>
 <div class="fixture-workbench desktop-data-workspace-wrap" data-sidebar-navigation-placement="bottom"><aside class="fixture-left"><div class="fixture-tree explorer-tree-shell no-root"><div class="explorer-tree-scroll" data-po-scrollbar="sidebar"><div class="explorer-tree-list"><div class="explorer-tree-virtual-canvas" style="height:${index*34}px">${tree}</div></div></div></div><footer class="fixture-footer"><button>${await icon('settings',14,1.65)}</button><button>${await icon('circle-help',14,1.65)}</button></footer></aside><main class="fixture-editor"></main><aside class="fixture-right"></aside></div>
</div></div>`;
console.log('Reference fixture prepared; waiting for Electron');
await app.whenReady();
console.log('Electron ready');
try {
 const win=new BrowserWindow({width,height,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 console.log('Loading source-backed fixture');
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 console.log('Waiting for fonts');
 await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
 await new Promise(r=>setTimeout(r,250));
 const geometry=await win.webContents.executeJavaScript(`Object.fromEntries(['.desktop-titlebar','.fixture-left','.fixture-footer','.fixture-editor','.fixture-right','.desktop-titlebar-workspace-button','.desktop-titlebar-changes','.desktop-titlebar-terminal','.tree-row'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height]]}))`);
 await mkdir(path.dirname(out),{recursive:true});
 await writeFile(out,(await win.webContents.capturePage()).toPNG());
 // Home fixture correction: DesktopCloudShell.tsx renders House at 14 / 1.65,
 // not the old hand-written 16 / 1.8. This remains synthetic, not real Header TSX.
 const sourcePaths=[...cssPaths,'src/components/DesktopCloudShell.tsx','sub-themes/default-neutral/theme.css','public/fonts/geist/Geist-Variable.woff2'];
 const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async p=>[p,createHash('sha256').update(await readFile(path.join(repo,p))).digest('hex')])));
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
 await writeFile(out.replace(/\.png$/,'.json'),JSON.stringify({scope:'synthetic source-CSS diagnostic, not full product parity',width,height,geometry,cssSources:cssPaths,sourceCommit,sourceHashes,electron:process.versions.electron,chrome:process.versions.chrome,fixtureRevision:2},null,2));
 console.log(`Reference: ${out}`);
 win.destroy();
} finally {await rm(profile,{recursive:true,force:true});app.quit();}
}
void main().catch(async error=>{console.error(error);await rm(profile,{recursive:true,force:true});app.exit(1);});
