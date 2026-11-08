#!/usr/bin/env electron
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { app, BrowserWindow, session } from 'electron';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'puppyone-notion-open-')));
app.setAppPath(repo);
app.setPath('appData', temporary);
app.setPath('userData', path.join(temporary, 'puppyone-dev'));
app.getPreferredSystemLanguages = () => ['en-US'];
await fs.mkdir(path.join(temporary, 'documents'));
app.setPath('documents', path.join(temporary, 'documents'));
BrowserWindow.prototype.show = function () { this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = () => {};
app.focus = () => {};
app.commandLine.appendSwitch('disable-gpu');
process.env.VITE_DESKTOP_CLOUD_API_URL = 'http://127.0.0.1:9/api/v1';
process.env.VITE_DESKTOP_CLOUD_WEB_URL = 'http://127.0.0.1:9';
const report = path.join(repo, 'artifacts/tests/notion-template-open');
await fs.mkdir(report, { recursive: true });
const sourceFiles = [
  { path: 'README.md', content: Buffer.from('# Synthetic source template\n') },
  { path: 'assets/raw.bin', content: Buffer.from([0, 255, 1, 128]) },
  { path: 'scripts/untrusted.sh', content: Buffer.from('touch SHOULD_NOT_RUN\n') },
];
let server;
const timer = setTimeout(() => { console.error('Native Notion template open timed out.'); app.exit(1); }, 90000);
try {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ type: 'puppyone.template', version: 1, name: 'Notion migration', entry: 'README.md', workflow: { kind: 'import-source', provider: 'notion' }, files: sourceFiles.map(file => ({ path: file.path, size: file.content.length, sha256: createHash('sha256').update(file.content).digest('hex') })) }));
  for (const file of sourceFiles) zip.file('content/' + file.path, file.content);
  const file = path.join(temporary, 'Notion.puppyonetemplate');
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const { createServer } = await import('vite');
  server = await createServer({ root: repo, cacheDir: path.join(temporary, 'vite-cache'), logLevel: 'error',
    define: { 'import.meta.env.VITE_DESKTOP_CLOUD_API_URL': JSON.stringify('http://127.0.0.1:9/api/v1'), 'import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL': JSON.stringify('http://127.0.0.1:9') },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [repo, await fs.realpath(path.join(repo, 'node_modules'))] } } });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = 'http://127.0.0.1:' + server.httpServer.address().port;
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const url = new URL(request.url);
      callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname) });
    });
  });
  app.on('browser-window-created', (_event, window) => { console.log('Native test window created'); window.webContents.on('console-message', details => { if (details.level === 'error') console.error('Renderer:', details.message); }); });
  console.log('Starting Desktop Main');
  await import('../../../../electron/main.mjs');
  console.log('Desktop Main imported; ready:', app.isReady());
  // Match the cold-start event delivered when the OS opens a downloaded file.
  app.emit('open-file', { preventDefault() {} }, file);
  // Electron emits ready only after this entry module has finished evaluating.
  void verifyDialog();
} catch (error) {
  console.error(error); clearTimeout(timer); await server?.close(); app.exit(1);
}
async function verifyDialog() {
  await app.whenReady();
  try {
  const deadline = Date.now() + 75000;
  let result = null; let window;
  while (Date.now() < deadline) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.isDestroyed()) {
      try { result = await window.webContents.executeJavaScript(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(item => /Unpack and open/.test(item.textContent));
        return dialog ? { title: dialog.getAttribute('aria-label'), text: dialog.textContent, ready: dialog.querySelector('button[type="submit"]')?.disabled === false } : null;
      })()`); } catch { /* Renderer is still mounting. */ }
      if (result?.ready) break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  console.log('Native test windows:', BrowserWindow.getAllWindows().map(w => ({ url: w.webContents.getURL(), title: w.getTitle() })));
  if (!result && window) { console.log('Native test page:', await window.webContents.executeJavaScript('document.body.innerText')); await fs.writeFile(path.join(report, 'failure.png'), (await window.capturePage()).toPNG()); }
  assert(result, 'Cold file-open must reach unpack confirmation');
  assert.match(result.text, /Notion migration/);
  assert.equal(result.ready, true, 'Unpack must work without a provider account');
  assert.doesNotMatch(result.text, /Connect.*Notion/i);
  await fs.writeFile(path.join(report, 'unpack.png'), (await window.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
  let workflow = null; let projectWindow = null;
  while (Date.now() < deadline) {
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (candidate === window || candidate.isDestroyed()) continue;
      try { workflow = await candidate.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector('[role="dialog"][data-import-source="notion"]');
        return dialog ? { text: dialog.textContent, ready: dialog.querySelector('.desktop-dialog-body button')?.disabled === false } : null;
      })()`); } catch { /* Project window is mounting. */ }
      if (workflow?.ready) { projectWindow = candidate; break; }
    }
    if (projectWindow) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(projectWindow, 'The unpacked project must open before its optional workflow');
  const project = path.join(temporary, 'documents', 'PuppyOne', 'Notion migration');
  for (const file of sourceFiles) assert.deepEqual(await fs.readFile(path.join(project, file.path)), file.content);
  await assert.rejects(fs.stat(path.join(project, 'SHOULD_NOT_RUN')), { code: 'ENOENT' });
  assert(workflow.text.includes(path.join(project, 'projects')), 'The optional import uses a child destination');
  await fs.writeFile(path.join(report, 'workflow.png'), (await projectWindow.capturePage()).toPNG());
  await fs.writeFile(path.join(report, 'result.json'), JSON.stringify({ ok: true, unpack: result, workflow, project, filesVerified: sourceFiles.length }, null, 2));
  console.log('PASS: Desktop file-open unpacks byte-preserved files, opens a new project and then offers the optional Notion workflow without executing package files.');
  clearTimeout(timer);
  await server.close();
  app.exit(0);
} catch (error) {
  console.error(error);
  clearTimeout(timer);
  await server?.close();
  app.exit(1);
}

}
