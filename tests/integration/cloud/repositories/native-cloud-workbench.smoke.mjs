#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/cloud/native-workbench");
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-native-cloud-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
const errors = [];
let window;
const assert = (value, message) => { if (!value) throw new Error(message); };
const evaluate = async (code) => { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error(`Renderer step failed: ${code}: ${error.message}; ${errors.join("; ")}`); } };
const presentation = (location) => evaluate(`(() => {
  const surface = document.querySelector('[data-workspace-location="${location}"]');
  const sample = (selector) => {
    const node = surface.querySelector(selector); if (!node) throw new Error("Missing native surface " + selector);
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      color: css.color, background: css.backgroundColor, font: css.fontSize, padding: css.padding };
  };
  return { explorer: sample(".explorer-column"), editor: sample(".browser-column"),
    footer: sample(".desktop-sidebar-footer-bar"), row: sample(".tree-row-content"), code: sample(".cm-editor") };
})()`);
const state = () => evaluate("window.__nativeCloudWorkbenchSmoke.state()");
const waitFor = async (expression) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Renderer did not become ready: ${expression}`);
};
async function selectLocation(location) {
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await waitFor(`Boolean(document.querySelector('button[data-project-location="${location}"]'))`);
  await evaluate(`document.querySelector('button[data-project-location="${location}"]').click()`);
  await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#native-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__nativeCloudWorkbenchSmoke && document.querySelector('[data-workspace-location=local] .cm-content')?.textContent.includes('LOCAL_FILE_BODY'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('local', 'LOCAL_UNSAVED_DRAFT')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().localWrites.some(item => item.content === 'LOCAL_UNSAVED_DRAFT')");
  const localPresentation = await presentation("local");
  await writeFile(path.join(artifacts, "local.png"), (await window.webContents.capturePage()).toPNG());
  const localHost = await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor').dataset.fixtureIdentity = 'retained-local-host'");
  await selectLocation("cloud");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true]')?.textContent.includes('cloud-only'))");
  assert(await evaluate("document.querySelector('[data-workspace-location=local]').hidden && !document.querySelector('[data-workspace-location=cloud]').hidden && !document.querySelector('[role=dialog]')"), "Cloud switch must replace the main surface without a dialog");
  assert(await evaluate("!document.querySelector('[data-cloud-native=true]').textContent.includes('local-only') && document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')"), "Cloud tree must contain Cloud files only");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('readme')).click()");
  await waitFor("Boolean(document.querySelector('[data-workspace-location=cloud] .cm-content')?.textContent.includes('CLOUD_FILE_BODY'))");
  const cloudPresentation = await presentation("cloud");
  for (const region of ["explorer", "editor", "footer", "row", "code"]) {
    const before = localPresentation[region], after = cloudPresentation[region];
    for (const property of region === "row" ? ["color", "font", "padding"] : ["x", "y", "width", "height", "background", "font", "padding"]) {
      assert(typeof before[property] === "number" ? Math.abs(before[property] - after[property]) < 1 : before[property] === after[property],
        `Native ${region} ${property} changed on Cloud switch: ${before[property]} -> ${after[property]}`);
    }
  }
  assert(await evaluate("!document.querySelector('[data-workspace-location=cloud] .desktop-explorer-toolbar, [data-workspace-location=cloud] .desktop-cloud-service-sidebar, [data-workspace-location=cloud] .desktop-cloud-inline-navigation')"), "Cloud must use the native file UI without a separate toolbar or service menu");
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('cloud', 'CLOUD_EDIT_ONLY')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(item => item.content === 'CLOUD_EDIT_ONLY' && item.path === 'readme.txt')");
  let snapshot = await state();
  assert(snapshot.localWrites.every((item) => !item.content.includes("CLOUD_EDIT")), "Cloud edits must never write to the local provider");
  assert(snapshot.cloudWrites.every((item) => !item.content.includes("LOCAL_UNSAVED")), "Local drafts must never write to Cloud");
  await waitFor("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud.png"), (await window.webContents.capturePage()).toPNG());
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host' && document.querySelector('[data-workspace-location=local] .cm-content').textContent.includes('LOCAL_UNSAVED_DRAFT')"), "Returning to This Mac must retain the same editor and local unsaved draft");
  await selectLocation("cloud");
  assert(await evaluate("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY') && document.querySelector('.desktop-titlebar-editor-tabs').textContent.includes('readme')"), "Returning to Cloud must retain its own tabs and content");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('records')).click()");
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('sample')");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('sample')).click()");
  await waitFor("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')");
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')"), "Cloud data files must use the native data viewer");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-data.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await waitFor("Boolean(document.querySelector('[data-workspace-location=cloud] [data-cloud-file-provider-state=signed-out]'))");
  assert(await evaluate("Boolean(document.querySelector('[data-workspace-location=cloud] .explorer-column') && document.querySelector('[data-workspace-location=cloud] .desktop-sidebar-footer-bar')) && !document.querySelector('[role=dialog]')"), "Unavailable Cloud must retain the file Sidebar and footer");
  const pendingGeometry = await evaluate("(() => { const r = document.querySelector('[data-workspace-location=cloud] .explorer-column').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  for (const property of ["x", "y", "width", "height"]) assert(Math.abs(pendingGeometry[property] - cloudPresentation.explorer[property]) < 1, "Unavailable Cloud changed Explorer geometry");
  assert(await evaluate("!document.querySelector('[data-workspace-location=cloud]').textContent.includes('LOCAL_FILE_BODY')"), "Unavailable Cloud must not fall back to local files");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-unavailable.png"), (await window.webContents.capturePage()).toPNG());
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host'"), "Provider unavailability must preserve the local editor host");
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
  snapshot = await state();
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, localHost, localPresentation, cloudPresentation, pendingGeometry, snapshot, errors }, null, 2));
  assert(!errors.length, `Renderer errors: ${errors.join("; ")}`);
  console.log("Native Cloud workbench smoke passed: identical native layout/styles, Cloud tree/data/edit/save, inline provider gate, isolated drafts and retained hosts.");
  window.destroy(); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  if (window) {
    await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
    console.error(await window.webContents.executeJavaScript("JSON.stringify({ state: window.__nativeCloudWorkbenchSmoke?.state(), cloud: document.querySelector('[data-workspace-location=cloud]')?.textContent, errors: [...document.querySelectorAll('[role=alert]')].map(item=>item.textContent) })"));
    window.destroy();
  }
  app.exit(1);
});
