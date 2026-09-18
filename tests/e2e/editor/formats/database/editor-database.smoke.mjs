#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DuckDBInstance } from "@duckdb/node-api";
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { workspaceFromPath } from "../../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-editor-database-"));
const artifactRoot = path.join(repo, "artifacts/tests/editor/database-app"); await fs.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_DATABASE_APP_ARTIFACT_DIR ?? await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
app.setAppPath(repo); app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const roots = [];
for (const name of ["Database A", "Database B"]) {
  const root = path.join(temporary, name); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "note.md"), `# ${name}\nNo database belongs on this page.`);
  await fs.writeFile(path.join(root, "unknown.db"), "not a supported database");
  roots.push(await fs.realpath(root));
}
const sqlite = new DatabaseSync(path.join(roots[0], "sample.db"));
sqlite.exec("CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT, big INTEGER)");
const insert = sqlite.prepare("INSERT INTO items VALUES(?,?,?)");
for (let i = 0; i < 57; i++) insert.run(i, `SQLite row ${i}`, 9223372036854775807n);
sqlite.close();
const large = new DatabaseSync(path.join(roots[0], "large.db"));
large.exec("CREATE TABLE payload(id INTEGER PRIMARY KEY, bytes BLOB); INSERT INTO payload VALUES(1,zeroblob(268435456));"); large.close();
const duck = await DuckDBInstance.create(path.join(roots[1], "sample.db")); const connection = await duck.connect();
await connection.run("CREATE TABLE items AS SELECT range AS id, 'DuckDB row' AS label, 123456789012345678901234567890::HUGEINT AS big FROM range(57)");
connection.closeSync(); duck.closeSync();
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: root => fs.realpath(root), workspaceFromPath });
for (const root of [...roots].reverse()) await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(roots[0]);
const hosts = [], steps = [], messages = [];
let fullReads = 0, peakRendererKiB = 0, peakHostKiB = 0, window, failure;
const fork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (filename, args, options) => {
  const child = fork(filename, args, options);
  if (options?.serviceName === "Database Preview") {
    const entry = { child, pid: null, exited: false }; hosts.push(entry);
    child.once("spawn", () => { entry.pid = child.pid; }); child.once("exit", () => { entry.exited = true; });
  }
  return child;
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (["workspace:read-file", "workspace:get-file-url"].includes(channel) && /\.db$/.test(args[0]?.path ?? "")) fullReads++;
  const result = await listener(event, ...args);
  if (channel.startsWith("database-preview:") && result) messages.push({ channel, bytes: Buffer.byteLength(JSON.stringify(result)), ok: result.ok, error: result.error?.code });
  return result;
});
const hash = async (filename) => { const digest = createHash("sha256"); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest("hex"); };
const files = [path.join(roots[0], "sample.db"), path.join(roots[0], "large.db"), path.join(roots[1], "sample.db")];
const hashes = await Promise.all(files.map(hash));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(30); }
  throw new Error(`Database App acceptance: ${label}`);
}
async function click(selector) {
  await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
const openFile = name => click(`.tree-row.file[aria-label="${name}"]`);
async function ready(text) {
  await until(() => evaluate(`document.querySelector('.database-preview tbody')?.textContent.includes(${JSON.stringify(text)})`), `ready ${text}`);
  assert.equal(window.contentView.children.length, 0, "Database must not allocate native display surfaces");
  assert(await evaluate("document.querySelectorAll('.database-preview td').length<=1200"));
}
async function bounds(label) {
  assert(await evaluate(`(() => { const s=document.querySelector('.database-preview'),p=s?.closest('.desktop-editor-pane'); if(!s||!p)return false;
    const a=s.getBoundingClientRect(),b=p.getBoundingClientRect();return a.width>0&&a.height>0&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1; })()`), label);
  assert(await evaluate("window.__databaseSurface===document.querySelector('.database-preview')"), `${label}: no unrelated remount`);
  steps.push(label);
}
async function noDatabase(label) {
  await until(() => evaluate("!document.querySelector('.database-preview')"), `${label} DOM detached`);
  await until(() => hosts.every(host => host.exited), `${label} native hosts exited`); steps.push(label);
}
async function project(name) {
  await evaluate(`(() => { const b=[...document.querySelectorAll('.desktop-project-switcher-rail-project')].find(e=>e.getAttribute('aria-label')?.includes(${JSON.stringify(name)}));if(!b)throw Error('Missing project');b.click();})()`);
  await until(() => evaluate(`[...document.querySelectorAll('.desktop-project-switcher-rail-project')].some(e=>e.getAttribute('aria-label')?.includes(${JSON.stringify(name)})&&e.getAttribute('aria-current')==='page')`), name);
}
const deadline = setTimeout(() => { console.error("Database acceptance timed out"); app.exit(1); }, 180_000);
await import("../../../../../electron/main.mjs");
// Electron's ESM entry must finish evaluating before app.ready can fire.
app.whenReady().then(async () => {
const sampleMemory = setInterval(() => {
  for (const metric of app.getAppMetrics()) {
    if (hosts.some(host => host.pid === metric.pid)) peakHostKiB = Math.max(peakHostKiB, metric.memory.workingSetSize);
    if (metric.type === "Tab") peakRendererKiB = Math.max(peakRendererKiB, metric.memory.workingSetSize);
  }
}, 100);
try {
  window = await until(() => BrowserWindow.getAllWindows()[0], "main window"); window.setSize(1200, 850); window.show();
  await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "App ready");
  await evaluate("localStorage.setItem('puppyone.desktop.experimental',JSON.stringify({enableMultiRootWorkspaces:true,enableProjectSwitcherRail:true}));location.reload()");
  await until(() => evaluate("document.querySelectorAll('.desktop-project-switcher-rail-project').length===2"), "projects ready");
  await openFile("sample.db"); await ready("9223372036854775807");
  await evaluate("window.__databaseSurface=document.querySelector('.database-preview')"); await bounds("SQLite registered DOM surface");
  await fs.writeFile(path.join(output, "sqlite-ready.png"), (await window.webContents.capturePage()).toPNG());
  for (const zoom of [1.25, 0.8, 1]) { window.webContents.setZoomFactor(zoom); await wait(150); await bounds(`zoom-${zoom}`); }
  window.setSize(800, 650); await wait(150); await bounds("window-resize"); window.setSize(1200, 850);
  await evaluate("document.querySelector('.data-explorer-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
  await wait(400); await bounds("sidebar-resize");
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}))");
  await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog'))"), "Settings dialog"); await wait(400);
  assert(await evaluate("(()=>{const d=document.querySelector('.desktop-settings-dialog'),r=d.getBoundingClientRect();return d.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()"));
  await bounds("settings-overlay");
  await fs.writeFile(path.join(output, "settings-over-database.png"), (await window.webContents.capturePage()).toPNG());
  await click(".desktop-settings-dialog .desktop-dialog-icon-button");
  await evaluate("[...document.querySelectorAll('.database-preview button')].find(b=>b.textContent==='Next page').click()");
  await until(() => evaluate("document.querySelectorAll('.database-preview tbody tr').length===7"), "second engine page"); steps.push("50+7 engine pagination");
  await openFile("large.db"); await ready("268435456"); steps.push({ label: "large BLOB projected without full source IPC", sourceBytes: (await fs.stat(files[1])).size });
  await project("Database B"); await openFile("note.md"); await noDatabase("project-switch");
  await openFile("sample.db"); await ready("123456789012345678901234567890"); steps.push("DuckDB via same DOM provider");
  await fs.writeFile(path.join(output, "duckdb-ready.png"), (await window.webContents.capturePage()).toPNG());
  await openFile("unknown.db"); await until(() => evaluate("document.querySelector('.database-preview [role=alert]')?.textContent.includes('unrecognized-format')"), "unknown format fallback");
  await until(() => hosts.every(host => host.exited), "unknown closes previous engine");
  await project("Database A"); await openFile("sample.db"); await ready("SQLite row");
  await fs.rename(path.join(roots[0], "sample.db"), path.join(roots[0], "previous.db"));
  const replacement = new DatabaseSync(path.join(roots[0], "sample.db"));
  replacement.exec("CREATE TABLE replacement(label TEXT); INSERT INTO replacement VALUES('new snapshot');"); replacement.close();
  await ready("new snapshot"); steps.push("external atomic replacement invalidates snapshot");
  await openFile("note.md"); await noDatabase("document-close");
  assert.equal(fullReads, 0, "database must never be buffered through readFile/getFileUrl");
  assert(messages.every(message => message.bytes <= 1024 * 1024));
  assert.deepEqual([await hash(path.join(roots[0], "previous.db")), await hash(files[1]), await hash(files[2])], hashes);
  assert((await fs.readdir(roots[0])).every(name => !/-wal$|-shm$|-journal$|\.tmp$/.test(name)));
} catch (error) {
  failure = error; console.error(error);
  if (window && !window.isDestroyed()) {
    await fs.writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(output, "failure-dom.txt"), await evaluate("document.body.innerHTML"));
  }
} finally {
  clearInterval(sampleMemory); clearTimeout(deadline);
  const sourceAfter = await readSourceIdentity(repo);
  if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, source, sourceAfter,
    platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node,
    steps, fullReads, messages, peakHostKiB, peakRendererKiB, hosts: hosts.map(({ pid, exited }) => ({ pid, exited })),
    verification: "Production renderer and real Electron utility processes; DOM-driven interaction, not packaged multi-platform or OS-native pointer acceptance",
    failure: failure?.stack }, null, 2));
  console.log(`Database App evidence: ${output}`);
  if (window && !window.isDestroyed()) window.destroy();
  for (const host of hosts) if (!host.exited) host.child.kill();
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(failure ? 1 : 0);
}
}).catch(error => { console.error(error); app.exit(1); });
