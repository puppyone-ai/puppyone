#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/cloud/workspace-actions");
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-workspace-actions-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
let window;
const errors = [];
const assert = (value, message) => { if (!value) throw new Error(message); };
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function waitFor(expression) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${expression}; ${errors.join("; ")}`);
}
async function capture(name) {
  await evaluate("document.fonts.ready");
  await evaluate("new Promise(resolve => setTimeout(resolve, 350))");
  await writeFile(path.join(artifacts, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
const button = tool => `document.querySelector('[data-cloud-workspace-tool=${tool}]')`;
async function exercise(hosted) {
  const mode = hosted ? "account" : "native";
  const api = hosted ? "window.__accountCloudSmoke" : "window.__nativeCloudWorkbenchSmoke";
  // The Header and Share keep the Agent list current by themselves, whatever else is happening.
  const workspaceRequests = `${api}.state().requests.filter(path => !/\\/(agent-links|access\\/sessions)$/.test(path)).length`;
  await window.loadURL("about:blank");
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#${mode}-cloud-workbench-smoke`);
  await waitFor(`Boolean(${api})`);
  if (hosted) {
    await waitFor("Boolean(document.querySelector('[data-cloud-project-id=alpha] .onboarding-project-row'))");
    await evaluate("document.querySelector('[data-cloud-project-id=alpha] .onboarding-project-row').click()");
  } else {
    // The folder's Cloud project is its own project in the project menu (ADR-001).
    await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
    await waitFor("Boolean(document.querySelector('.desktop-project-menu .desktop-project-switcher-row[data-project-location=cloud]'))");
    await evaluate("document.querySelector('.desktop-project-menu .desktop-project-switcher-row[data-project-location=cloud]').querySelector('button').click()");
    await waitFor(`${api}.state().location === 'cloud'`);
  }
  await waitFor(`${button("history")} && !${button("history")}.disabled`);
  assert(await evaluate("!document.querySelector('[data-cloud-workspace-tool=automation], [data-cloud-workspace-tool=connect]')"), "Retired entries must not be visible");
  if (!hosted) {
    await evaluate(`${api}.setLoginAppearance('light', 'en')`);
    await evaluate("[...document.querySelectorAll('.data-content .tree-row.file')].find(row => row.getBoundingClientRect().width > 0 && row.dataset.explorerPath.endsWith('/cloud-only.md')).click()");
    await waitFor("[...document.querySelectorAll('.data-content .cm-content')].some(content => content.textContent.includes('Cloud only'))");
    const before = await evaluate(workspaceRequests);
    await evaluate(`${button("share")}.click()`);
    await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-share input'))");
    assert(await evaluate("document.querySelector('.desktop-cloud-workspace-share input').value === 'https://app-fixture.puppyone.ai/11111111-1111-4111-8111-111111111111/cloud-only.md'"), "Share must show the current document's human URL");
    assert(await evaluate(`${workspaceRequests} === ${before}`), "Sharing must make zero Cloud requests");
    await waitFor("Boolean(document.querySelector('.desktop-cloud-share-preview-window'))");
    assert(await evaluate("Boolean(document.querySelector('.desktop-cloud-share-preview-window [data-explorer-path=\"puppyone-preview://share/notes.md\"]'))"), "Share preview uses cached real file names");
    assert(await evaluate("!document.querySelector('.desktop-cloud-share-preview-heading, .desktop-cloud-workspace-share .desktop-dialog-footer')"), "Share contains only link/copy row and preview illustration");
    await waitFor("Boolean(document.querySelector('.desktop-cloud-share-preview-window .markdown-codemirror-editor .cm-editor'))");
    assert(await evaluate("document.querySelector('.desktop-cloud-share-preview-window .cm-content').textContent.includes('Cloud only')"), "Share previews the current file's accepted body");
    assert(await evaluate("document.querySelector('.desktop-cloud-workspace-share h2').textContent === 'Share this project'"), "Share title is independent of project name");
    for (const theme of ["light", "dark"]) {
      await evaluate(`${api}.setLoginAppearance('${theme}', 'en')`);
      await capture(`share-${theme}`);
      const nativeStyles = await evaluate("(() => { const preview = document.querySelector('.desktop-cloud-share-preview-window .tree-row.file'); const actual = [...document.querySelectorAll('.data-content .tree-row.file')].find(row => !row.closest('.desktop-cloud-share-preview-window') && row.getBoundingClientRect().width > 0); const a = getComputedStyle(actual); const b = getComputedStyle(preview); return Object.fromEntries(['fontSize', 'fontWeight', 'lineHeight', 'height', 'borderRadius', 'color', 'paddingLeft', 'paddingRight'].map(key => [key, { actual:a[key], preview:b[key] }])); })()");
      assert(Object.values(nativeStyles).every(value => value.actual === value.preview), `Miniature rows inherit the exact ${theme} product Explorer styles before uniform scaling: ${JSON.stringify(nativeStyles)}`);
    }
    assert(await evaluate(`${workspaceRequests} === ${before}`), "Rendering the actual Viewer must add no Cloud requests");
    window.setSize(640, 520);
    await evaluate("new Promise(resolve => setTimeout(resolve, 350))");
    assert(await evaluate("(() => { const r = document.querySelector('.desktop-cloud-workspace-share .desktop-cloud-share-copy').getBoundingClientRect(); return r.bottom <= innerHeight && r.width <= innerWidth; })()"), "Share copy action stays visible on a small window");
    await capture("share-small");
    window.setSize(1100, 760);
    await evaluate("document.querySelector('.desktop-cloud-workspace-share .desktop-dialog-icon-button').click()");
    // Selecting a folder overrides the still-open document; switching tabs
    // restores the actual document as the target rather than retaining it.
    await evaluate("[...document.querySelectorAll('.data-content .tree-row.folder')].find(row => row.getBoundingClientRect().width > 0 && row.dataset.explorerPath.endsWith('/records')).click()");
    await evaluate(`${button("share")}.click()`);
    await waitFor("document.querySelector('.desktop-cloud-workspace-share input')?.value.endsWith('/records/')");
    await capture("share-folder");
    await evaluate("document.querySelector('.desktop-cloud-workspace-share .desktop-dialog-icon-button').click()");
    await evaluate("[...document.querySelectorAll('.data-content .tree-row.file')].find(row => row.getBoundingClientRect().width > 0 && row.dataset.explorerPath.endsWith('/notes.md')).click()");
    await waitFor("[...document.querySelectorAll('.data-content .cm-content')].some(content => content.textContent.includes('Cloud note'))");
    await evaluate(`${button("share")}.click()`);
    await waitFor("document.querySelector('.desktop-cloud-workspace-share input')?.value.endsWith('/notes.md')");
    await capture("share-notes");
    await evaluate("document.querySelector('.desktop-cloud-workspace-share .desktop-dialog-icon-button').click()");
  }
  await evaluate(`${button("agent")}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-cloud-agent-sidebar .cm-content'))");
  await evaluate(`${api}.editAgent('Keep this draft')`);
  for (const theme of ["light", "dark"]) {
    await evaluate(hosted ? `${api}.setTheme('${theme}')` : `${api}.setLoginAppearance('${theme}', 'en')`);
    await evaluate(`${button("history")}.click()`);
    await waitFor("document.querySelector('.desktop-cloud-workspace-history')?.textContent.includes('Update research notes')");
    assert(await evaluate(`${button("agent")}.getAttribute('aria-expanded') === 'false'`), "History owns the auxiliary pane");
    await evaluate("new Promise(resolve => setTimeout(resolve, 350))");
    const geometry = await evaluate("(() => { const r = document.querySelector('.desktop-cloud-workspace-history').getBoundingClientRect(); return { width:r.width, height:r.height, right:r.right }; })()");
    assert(geometry.width >= 280 && geometry.height > 400 && geometry.right <= 1101, `History must fit the right pane: ${JSON.stringify(geometry)}`);
    await capture(`${mode}-history-${theme}`);
    await evaluate("document.querySelector('.desktop-cloud-workspace-history .desktop-history-row').click()");
    await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-history .desktop-commit-detail'))");
    await capture(`${mode}-detail-${theme}`);
    await evaluate(`${button("agent")}.click()`);
    await waitFor("document.querySelector('.desktop-cloud-agent-sidebar .cm-content')?.textContent.includes('Keep this draft')");
  }
  await evaluate(`${button("history")}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-history'))");
  await evaluate("document.querySelector('.desktop-cloud-workspace-history button[aria-label=Close]').click()");
  await waitFor("document.querySelector('.desktop-right-sidebar').dataset.paneCollapsed === 'true'");
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  await exercise(false);
  await exercise(true);
  assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
  console.log("Cloud workspace actions passed: Share URL, zero-request sharing, History in both shells and themes, retained Agent draft, sidebar close.");
  window.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
