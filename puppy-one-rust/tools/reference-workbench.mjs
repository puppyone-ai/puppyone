// Pixel references rendered from the real product components in an isolated,
// offline Electron page. Two suites share the harness:
//   workbench — right sidebar (tabs, launcher, Agent Chat); fixtures mirror
//               src/features/workbench/lab.rs
//   settings  — SettingsDialog, one page per case; fixtures mirror src/lab.rs
//   cloud     — Cloud surfaces (History sidebar); data shared with src/lab.rs
//
//   <product>/node_modules/.bin/electron tools/reference-workbench.mjs
//   PUPPYONE_REFERENCE_SUITE=settings ... for the Settings suite.
//   PUPPYONE_REFERENCE_ONLY=chat-transcript-dark,... to limit cases.
//
// Output: artifacts/<suite>-reference/<case>.png + .json (geometry + styles).
import {app} from 'electron';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {bundleProduct, catalogs, openPage, productRoot} from './product-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = {
  workbench: {entry: 'tools/reference-workbench-entry.tsx', scenarios: 'tools/workbench-scenarios.json',
    scope: 'real product right-sidebar components; offline fixture services',
    elements: '.desktop-terminal-panel, .desktop-terminal-panel *, #desktop-overlay-root *'},
  settings: {entry: 'tools/reference-settings-entry.tsx', scenarios: 'tools/settings-scenarios.json',
    scope: 'real product SettingsDialog; offline fixture services',
    elements: '.desktop-settings-dialog, .desktop-settings-dialog *, .desktop-settings-dialog-backdrop',
    // Required at import time; the page is offline, so it is never reached.
    env: {VITE_DESKTOP_CLOUD_API_URL: 'https://api.puppyone.ai'}},
  cloud: {entry: 'tools/reference-cloud-entry.tsx', scenarios: 'tools/cloud-scenarios.json',
    scope: 'real product Cloud surfaces; offline fixture Cloud bridge',
    elements: '.desktop-git-history-sidebar, .desktop-git-history-sidebar *, #desktop-overlay-root *',
    data: 'fixtures/cloud-history.json',
    env: {VITE_DESKTOP_CLOUD_API_URL: 'https://api.puppyone.ai'}},
};
const suiteName = process.env.PUPPYONE_REFERENCE_SUITE ?? 'workbench';
const suite = SUITES[suiteName];
if (!suite) throw Error(`Unknown suite ${suiteName}`);
const out = path.join(root, process.env.PUPPYONE_REFERENCE_OUT ?? `artifacts/${suiteName}-reference`);
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-workbench-reference-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
// Offscreen references must never take the screen or keyboard from the user.
if (process.platform === 'darwin') { app.setActivationPolicy('accessory'); app.dock?.hide(); }
const only = process.env.PUPPYONE_REFERENCE_ONLY?.split(',');

const {scenarios: SCENARIOS} = JSON.parse(await readFile(path.join(root, suite.scenarios), 'utf8'));
const cases = SCENARIOS.flatMap(s => ['dark', 'light'].map(mode => ({...s, mode, id: `${s.scenario}-${mode}`})));

async function run() {
  const namespaces = ['agent', 'automation', 'cloud', 'common', 'editor', 'onboarding', 'plugins', 'settings', 'shared-ui', 'shell', 'source-control', 'terminal', 'updates', 'workspace'];
  const {catalogs: catalogMap, paths} = await catalogs(namespaces, ['en']);
  const entry = (await readFile(path.join(root, suite.entry), 'utf8'))
    .replaceAll('"PRODUCT/', JSON.stringify(productRoot + '/').slice(0, -1));
  const {script, style, sourceCommit, sourceHashes} = await bundleProduct(entry, paths, suite.env);
  await mkdir(out, {recursive: true}); await app.whenReady();
  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    const fixture = {id: c.id, mode: c.mode, locale: 'en', width: c.width, height: c.height};
    // A scenario may bring its own data; non-JSON files arrive as a string.
    const dataFile = c.data ?? suite.data;
    const raw = dataFile ? await readFile(path.join(root, dataFile), 'utf8') : null;
    const data = raw === null ? 'null' : dataFile.endsWith('.json') ? raw : JSON.stringify(raw);
    const page = `window.__catalogs=${JSON.stringify(catalogMap)};window.__fixtureData=${data};\n${script}`;
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
      // Hover/focus chrome must not leak into the reference, and finite
      // animations (the approval attention ring's three pulses) are captured
      // at rest so the frame doesn't depend on timing; the native lab
      // settles the same ones (\`crate::lab::settled\`).
      await win.webContents.executeJavaScript(`(async()=>{document.activeElement?.blur?.();
        for(const a of document.getAnimations()){if(Number.isFinite(a.effect?.getComputedTiming?.().endTime))a.finish();}
        document.dispatchEvent(new PointerEvent('pointermove',{clientX:-10,clientY:-10}));await new Promise(r=>setTimeout(r,250));})()`);
      const state = await win.webContents.executeJavaScript(`(()=>{
        const sel=${JSON.stringify(suite.elements)};
        const elements=[...document.querySelectorAll(sel)].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,4000);
        return {dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],errors:window.__errors,
          elements:elements.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
            return {cls:(typeof el.className==='string'?el.className:el.getAttribute('class'))||'',tag:el.tagName.toLowerCase(),rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100),
              color:s.color,bg:s.backgroundColor,border:s.borderTopWidth+' '+s.borderTopColor,radius:s.borderTopLeftRadius,font:s.fontSize+'/'+s.lineHeight+' '+s.fontWeight+' '+s.fontFamily.split(',')[0],
              padding:s.padding,opacity:s.opacity,text:(el.childElementCount===0?el.textContent:'').trim().slice(0,120)};})};})()`);
      const image = await win.webContents.capturePage(); if (image.isEmpty()) throw Error('Empty reference');
      await writeFile(path.join(out, `${c.id}.png`), image.toPNG());
      await writeFile(path.join(out, `${c.id}.json`), JSON.stringify({scope: suite.scope, ...c, sourceCommit, sourceHashes, versions: process.versions, ...state}, null, 2) + '\n');
      console.log(`Captured ${c.id}${state.errors.length ? ' (page errors: ' + state.errors.join('; ') + ')' : ''}`);
    } finally { win.destroy(); }
  }
}
async function cleanup() { await rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(() => {}); }
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
