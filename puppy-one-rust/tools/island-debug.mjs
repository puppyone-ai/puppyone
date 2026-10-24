// Load the built content island exactly as web_editor.rs assembles it, in an
// isolated Electron window with a recording window.ipc, then replay host
// messages. For diagnosing the island; captures are Chromium, not WebKit.
// usage: electron tools/island-debug.mjs <file> [out.png] [--light] [--menu]
import {app, BrowserWindow} from 'electron';
import {readFile, writeFile, rm} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [file, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.filter(a => a.startsWith('--')));
const profile = mkdtempSync(path.join(os.tmpdir(), 'puppyone-island-debug-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
async function run() {
  const nonce = 'debug';
  const html = (await readFile(path.join(root, 'editor/src/index.html'), 'utf8'))
    .replaceAll('__NONCE__', nonce).replace('__SMOKE__', 'true')
    .replace('__STYLE_BUNDLE__', () => '').replace('__BUNDLE__', () => '');
  const css = await readFile(path.join(root, 'editor/bundle/editor.css'), 'utf8');
  const js = await readFile(path.join(root, 'editor/bundle/editor.js'), 'utf8');
  // Function replacements: bundles contain `$'`-style sequences.
  const page = html.replace('<style></style>', () => `<style>${css}</style>`)
    .replace(`window.__PUPPY_SMOKE_MODE__=true;\n\n`, () => `window.__PUPPY_SMOKE_MODE__=true;window.__posted=[];window.ipc={postMessage:m=>window.__posted.push(JSON.parse(m))};\n${js.replaceAll('</script', '<\\/script')}\n`);
  await app.whenReady();
  const win = new BrowserWindow({width: 1059, height: 760, useContentSize: true, show: false, frame: false, webPreferences: {sandbox: true, contextIsolation: true}});
  const logs = [];
  win.webContents.on('console-message', e => logs.push(`[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  const target = path.join(profile, 'island.html'); await writeFile(target, page); await win.loadFile(target);
  const text = await readFile(path.resolve(file), 'utf8');
  const dark = !flags.has('--light');
  const loaded = await win.webContents.executeJavaScript('({editor:typeof window.puppyEditor,ipc:typeof window.ipc,scripts:document.scripts.length})');
  if (loaded.editor !== 'object') { console.log('island did not start', JSON.stringify(loaded)); console.log(logs.join('\n')); win.destroy(); return; }
  const result = await win.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.puppyEditor.receive({kind:'theme',dark:${dark},scale:0});
    window.puppyEditor.receive({kind:'open',id:'doc-1',name:${JSON.stringify(path.basename(file))},text:${JSON.stringify(text)},revision:0});
    for(let i=0;i<100&&!window.__posted.some(m=>m.type==='loaded'||m.type==='fault');i++)await wait(30);
    await wait(500);
    ${flags.has('--menu') ? `document.querySelector('.desktop-editor-pane').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:innerWidth/2,clientY:12}));document.querySelector('.desktop-editor-pane-handle')?.click();await wait(400);` : ''}
    return {posted:window.__posted,state:window.__puppySmoke.state(),errors:[...document.querySelectorAll('.editor-state')].map(e=>e.textContent)};})()`);
  console.log(JSON.stringify(result, null, 1).slice(0, 4000));
  console.log(logs.filter(l => !l.includes('Electron Security Warning')).slice(0, 40).join('\n'));
  if (out) { const image = await win.webContents.capturePage(); await writeFile(out, image.toPNG()); console.log('wrote', out); }
  win.destroy();
}
const cleanup = () => rm(profile, {recursive: true, force: true, maxRetries: 6, retryDelay: 100}).catch(() => {});
void run().then(async () => { await cleanup(); app.quit(); }).catch(async e => { console.error(e); await cleanup(); app.exit(1); });
