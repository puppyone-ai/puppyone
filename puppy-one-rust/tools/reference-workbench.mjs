// Pixel references for the right sidebar (Workbench tabs, launcher, Agent Chat)
// rendered from the real product components in an isolated, offline Electron
// page. Fixture data mirrors src/features/workbench/lab.rs exactly.
//
//   <product>/node_modules/.bin/electron tools/reference-workbench.mjs
//   PUPPYONE_REFERENCE_ONLY=chat-transcript-dark,... to limit cases.
//
// Output: artifacts/workbench-reference/<case>.png + .json (geometry + styles).
import {app} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {bundleProduct, catalogs, openPage, productRoot} from './product-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, process.env.PUPPYONE_REFERENCE_OUT ?? 'artifacts/workbench-reference');
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-workbench-reference-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
const only = process.env.PUPPYONE_REFERENCE_ONLY?.split(',');

const {scenarios: SCENARIOS} = JSON.parse(await readFile(path.join(root, 'tools/workbench-scenarios.json'), 'utf8'));
const cases = SCENARIOS.flatMap(s => ['dark', 'light'].map(mode => ({...s, mode, id: `${s.scenario}-${mode}`})));

async function run() {
  const namespaces = ['agent', 'terminal', 'workspace', 'common', 'shell', 'settings', 'shared-ui', 'editor'];
  const {catalogs: catalogMap, paths} = await catalogs(namespaces, ['en']);
  const entry = (await readFile(path.join(root, 'tools/reference-workbench-entry.tsx'), 'utf8'))
    .replaceAll('"PRODUCT/', JSON.stringify(productRoot + '/').slice(0, -1));
  const {script, style, sourceCommit, sourceHashes} = await bundleProduct(entry, paths);
  await mkdir(out, {recursive: true}); await app.whenReady();
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    const fixture = {id: c.id, mode: c.mode, locale: 'en', width: c.width, height: c.height};
    const page = `window.__catalogs=${JSON.stringify(catalogMap)};\n${script}`;
    const win = await openPage(profile, {width: c.width, height: c.height, mode: c.mode, fixture, script: page, style});
    try {
      await win.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;
        for(let i=0;i<300&&!window.__referenceReady&&!window.__errors.length;i++)await new Promise(r=>setTimeout(r,20));
        if(!window.__referenceReady)throw Error('Fixture did not render: '+window.__errors.join(';'));
        await new Promise(r=>setTimeout(r,500));})()`);
      // A live conversation is pinned to its latest output (`initialPinned`);
      // the harness mounts asynchronously, so settle the viewport there.
      await win.webContents.executeJavaScript(`(async()=>{for(const el of document.querySelectorAll('.desktop-agent-transcript')){el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));}
        await new Promise(r=>setTimeout(r,300));})()`);
      if (c.click) {
        await win.webContents.executeJavaScript(`(async()=>{const el=document.querySelector(${JSON.stringify(c.click)});
          if(!el)throw Error('Missing click target ${c.click}');el.click();await new Promise(r=>setTimeout(r,500));})()`);
      }
      // Hover/focus chrome must not leak into the reference.
      await win.webContents.executeJavaScript(`(async()=>{document.activeElement?.blur?.();
        document.dispatchEvent(new PointerEvent('pointermove',{clientX:-10,clientY:-10}));await new Promise(r=>setTimeout(r,250));})()`);
      const state = await win.webContents.executeJavaScript(`(()=>{
        const sel='.desktop-terminal-panel, .desktop-terminal-panel *, #desktop-overlay-root *';
        const elements=[...document.querySelectorAll(sel)].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,4000);
        return {dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],errors:window.__errors,
          elements:elements.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
            return {cls:(typeof el.className==='string'?el.className:el.getAttribute('class'))||'',tag:el.tagName.toLowerCase(),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100),
              color:s.color,bg:s.backgroundColor,border:s.borderTopWidth+' '+s.borderTopColor,radius:s.borderTopLeftRadius,font:s.fontSize+'/'+s.lineHeight+' '+s.fontWeight+' '+s.fontFamily.split(',')[0],
              padding:s.padding,opacity:s.opacity,text:(el.childElementCount===0?el.textContent:'').trim().slice(0,120)};})};})()`);
      const image = await win.webContents.capturePage(); if (image.isEmpty()) throw Error('Empty reference');
      await writeFile(path.join(out, `${c.id}.png`), image.toPNG());
      await writeFile(path.join(out, `${c.id}.json`), JSON.stringify({scope: 'real product right-sidebar components; offline fixture services', ...c, sourceCommit, sourceHashes, versions: process.versions, ...state}, null, 2) + '\n');
      console.log(`Captured ${c.id}${state.errors.length ? ' (page errors: ' + state.errors.join('; ') + ')' : ''}`);
    } finally { win.destroy(); }
  }
}
async function cleanup() { await rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(() => {}); }
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
