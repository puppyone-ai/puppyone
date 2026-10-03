#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/cloud/account-workbench");
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-account-cloud-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
let window;
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
const waitFor = async (expression) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`Timed out: ${expression}; ${errors.join("; ")}`);
};
async function openProject(id) {
  await evaluate("window.__accountCloudSmoke.home()");
  await waitFor(`Boolean(document.querySelector('[data-cloud-project-id="${id}"] .onboarding-project-row'))`);
  await evaluate(`document.querySelector('[data-cloud-project-id="${id}"] .onboarding-project-row').click()`);
  await waitFor(`window.__accountCloudSmoke.state().active && window.__accountCloudSmoke.state().project === '${id}' && !document.querySelector('[role=dialog]')`);
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .tree-row'))");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(el => el.textContent.includes('readme')).click()");
  await waitFor("Boolean(document.querySelector('.desktop-account-cloud-workspace .cm-content'))");
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#account-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__accountCloudSmoke)");
  await waitFor("document.querySelectorAll('[data-cloud-project-id]').length === 2");
  assert(await evaluate("!document.querySelector('[role=dialog]') && !document.querySelector('.desktop-cloud-home-entry')"), "Homepage must list Cloud projects without a browse button or picker");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("document.querySelector('.onboarding-project-list').getBoundingClientRect().height > 50"), "Homepage project list must be visible");
  await writeFile(path.join(artifacts, "catalog.png"), (await window.webContents.capturePage()).toPNG());
  await openProject("alpha");
  await waitFor("document.querySelector('.cm-content').textContent.includes('ALPHA_CLOUD_BODY')");
  assert(await evaluate("document.querySelector('.desktop-titlebar-workspace-name').textContent === 'Hosted alpha'"), "Header must identify the selected Cloud project");
  const geometry = await evaluate(`(() => {
    const shell = document.querySelector('.desktop-account-cloud-workspace');
    const rect = (selector) => { const r = shell.querySelector(selector).getBoundingClientRect(); return { width:r.width, height:r.height }; };
    return { explorer:rect('.explorer-column'), editor:rect('.browser-column') };
  })()`);
  assert(geometry.explorer.width > 100 && geometry.editor.width > 300 && geometry.editor.height > 400, "No-local hosted shell must have a usable native layout");
  await evaluate("window.__accountCloudSmoke.edit('ALPHA_EDIT_ONLY')");
  await waitFor("window.__accountCloudSmoke.state().writes.some(write => write.project === 'alpha' && write.content === 'ALPHA_EDIT_ONLY')");
  await writeFile(path.join(artifacts, "hosted-editor.png"), (await window.webContents.capturePage()).toPNG());
  await openProject("beta");
  await waitFor("document.querySelector('.cm-content').textContent.includes('BETA_CLOUD_BODY')");
  assert(await evaluate("!document.querySelector('.cm-content').textContent.includes('ALPHA_EDIT_ONLY')"), "Different project must not display the previous draft");
  await evaluate("window.__accountCloudSmoke.signOut()");
  await waitFor("!window.__accountCloudSmoke.state().active && !document.querySelector('.desktop-account-cloud-workspace')");
  await evaluate("window.__accountCloudSmoke.signIn()");
  await openProject("alpha");
  await waitFor("document.querySelector('.cm-content').textContent.includes('ALPHA_EDIT_ONLY')");
  await evaluate("window.__accountCloudSmoke.edit('ALPHA_AFTER_RELOGIN')");
  await waitFor("window.__accountCloudSmoke.state().writes.some(write => write.content === 'ALPHA_AFTER_RELOGIN')");
  await evaluate("document.querySelector('button[data-project-location=local]').click()");
  await waitFor("!window.__accountCloudSmoke.state().active && Boolean(document.querySelector('.onboarding-project-list'))");
  await evaluate("window.__accountCloudSmoke.showLocalFixtures()");
  await waitFor("document.querySelectorAll('.onboarding-project-row-wrap').length === 7");
  assert(await evaluate("!document.querySelector('.onboarding-project-group') && document.querySelectorAll('[data-cloud-project-id=alpha]').length === 1 && Boolean(document.querySelector('[data-project-location=linked] .onboarding-project-cloud-badge'))"), "One flat list must express linked projects through their folder/cloud icon, not section headings");
  assert(await evaluate("[...document.querySelectorAll('.onboarding-project-row-wrap')].slice(0,3).map(row => row.querySelector('.desktop-menu-item-label').textContent).join('|') === 'Hosted beta|Local notes|Hosted alpha'"), "All locations must share one last-modified order");
  assert(await evaluate("getComputedStyle(document.querySelector('[data-project-location=cloud]')).color !== getComputedStyle(document.querySelector('[data-project-location=local]')).color"), "The Cloud-only outline icon must use the semantic blue/info color");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "flat-homepage.png"), (await window.webContents.capturePage()).toPNG());
  window.setSize(640, 520);
  await waitFor("innerWidth === 640 && innerHeight === 520");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate(`(() => {
    const list = document.querySelector('.onboarding-project-list');
    const action = document.querySelector('.onboarding-project-cloud').getBoundingClientRect();
    const row = document.querySelector('[data-cloud-project-id=alpha]').getBoundingClientRect();
    return list.scrollHeight > list.clientHeight && action.left >= row.left && action.right <= row.right;
  })()`), "The flat project list must scroll and retain the explicit Cloud action at the minimum window size");
  await writeFile(path.join(artifacts, "flat-homepage-minimum.png"), (await window.webContents.capturePage()).toPNG());
  assert(errors.length === 0, `Unexpected renderer errors: ${errors.join("; ")}`);
  const result = { passed: true, geometry, ...(await evaluate("window.__accountCloudSmoke.state()")), errors };
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
  console.log("Account Cloud workspace Electron smoke passed.");
  window.destroy(); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), errors }, null, 2));
  if (window) { await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG()); window.destroy(); }
  app.exit(1);
});
