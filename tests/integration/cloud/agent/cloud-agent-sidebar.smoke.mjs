#!/usr/bin/env electron
import { app, BrowserWindow } from "electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const artifacts = path.join(repo, "artifacts/tests/cloud/agent-sidebar");
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-cloud-agent-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-color-profile", "srgb");
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
const entry = "document.querySelector('[data-cloud-workspace-tool=agent]')";
const composer = "document.querySelector('.desktop-cloud-agent-sidebar .cm-content')";
const send = "document.querySelector('.desktop-cloud-agent-sidebar .desktop-agent-composer-action')";
const rightPane = "document.querySelector('.desktop-right-sidebar')";
async function selectLocation(location) {
  if (!await evaluate(`Boolean(document.querySelector('button[data-project-location=${location}]'))`)) {
    await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
  }
  await waitFor(`Boolean(document.querySelector('button[data-project-location=${location}]'))`);
  await evaluate(`document.querySelector('button[data-project-location=${location}]').click()`);
}
async function settleSidebar() {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await waitFor("[...document.querySelectorAll('.desktop-right-sidebar')].every(element => element.getAnimations({subtree:true}).every(animation => animation.effect?.getTiming().iterations === Infinity || animation.playState !== 'running'))");
}
async function checkHistoryTypography() {
  const typography = await evaluate(`(() => {
    const title = document.querySelector('.desktop-agent-history-title');
    const time = document.querySelector('.desktop-agent-history-time');
    const option = document.querySelector('.desktop-agent-history-option');
    const style = getComputedStyle(option);
    return {
      title: getComputedStyle(title).fontSize,
      time: getComputedStyle(time).fontSize,
      contentRole: style.getPropertyValue('--agent-font-size').trim(),
      metaRole: style.getPropertyValue('--agent-font-size-meta').trim(),
      color: getComputedStyle(time).color,
      metaColor: style.getPropertyValue('--agent-text-subtle').trim(),
    };
  })()`);
  assert(typography.contentRole && typography.metaRole, 'Cloud history must inherit the native Agent typography boundary');
  assert(parseFloat(typography.title) === parseFloat(typography.contentRole), 'History titles use the native content size');
  assert(parseFloat(typography.time) === parseFloat(typography.metaRole), 'History timestamps use the smaller native metadata size');
  assert(parseFloat(typography.time) < parseFloat(typography.title), 'History metadata must retain its visual hierarchy');
  assert(typography.metaColor, 'Cloud history must inherit the native supporting text color');
  return typography;
}
async function checkWorkbench(api, mode) {
  const tabs = "document.querySelectorAll('.desktop-right-sidebar [role=tab]')";
  const plus = "document.querySelector('.desktop-right-sidebar [aria-label=\"New tab\"]')";
  const selectedHost = '.desktop-terminal-contribution-host[aria-hidden="false"]';
  const visibleComposer = `document.querySelector('${selectedHost} .cm-content')`;
  const closeActive = "document.querySelector('.desktop-terminal-tab:has([aria-selected=true]) .desktop-terminal-tab-close').click()";
  const before = await evaluate(`${api}.state().agent.requests.length`);
  await evaluate(`${plus}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-terminal-launcher-tool'))");
  assert(await evaluate(`${tabs}.length === 2 && !document.querySelector('.desktop-terminal-launcher-scan')`), "Plus opens the native launcher without local discovery");
  await evaluate("document.querySelector('.desktop-terminal-launcher-tool').click()");
  await waitFor(`${tabs}.length === 2 && Boolean(${visibleComposer})`);
  await evaluate(`${api}.editAgent('Independent second draft')`);
  await waitFor(`${visibleComposer}?.textContent === 'Independent second draft'`);
  assert(await evaluate(`${api}.state().agent.requests.length === ${before}`), "New tab and draft must not make API requests");
  await settleSidebar();
  await writeFile(path.join(artifacts, `${mode}-tabs.png`), (await window.webContents.capturePage()).toPNG());
  await evaluate(`${tabs}[0].click()`);
  await waitFor(`${tabs}[0].getAttribute('aria-selected') === 'true'`);
  await evaluate(closeActive);
  await waitFor(`${tabs}.length === 1`);
  await evaluate(`${plus}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-terminal-launcher-history'))");
  await evaluate("document.querySelector('.desktop-terminal-launcher-history').click()");
  await waitFor("Boolean(document.querySelector('.desktop-agent-history-option'))");
  const typography = await checkHistoryTypography();
  await writeFile(path.join(artifacts, `${mode}-history-typography.json`), JSON.stringify(typography, null, 2));
  await evaluate("document.querySelector('.desktop-agent-history-toolbar-button[aria-label=\"Search chat history\"]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-agent-history-search input'))");
  await settleSidebar();
  await writeFile(path.join(artifacts, `${mode}-history.png`), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('.desktop-agent-history-toolbar-button[aria-label=\"Back to Agents\"]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-terminal-launcher-tool'))");
  await evaluate("document.querySelector('.desktop-terminal-launcher-history').click()");
  await waitFor("Boolean(document.querySelector('.desktop-agent-history-option'))");
  await evaluate("document.querySelector('.desktop-agent-history-option').click()");
  await waitFor(`Boolean(${visibleComposer}) && !document.querySelector('.desktop-agent-history-view')`);
  assert(await evaluate(`document.querySelector('${selectedHost} .desktop-cloud-agent-sidebar').textContent.includes('Connected: Connection test: turn 3')`), "History restores the original messages");
  // Close the empty secondary tab so the existing publication checks address the restored chat.
  await evaluate(`${tabs}[0].click()`);
  await waitFor(`${visibleComposer}?.textContent === 'Independent second draft'`);
  await evaluate(closeActive);
  await waitFor(`${tabs}.length === 1 && Boolean(${visibleComposer})`);
}
async function checkLocationRoundTrip(api) {
  await selectLocation("local");
  await waitFor(`${api}.state().location === 'local' && ${rightPane}.dataset.paneCollapsed === 'true'`);
  await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
  await evaluate("document.querySelector('.desktop-titlebar-terminal').click()");
  await waitFor(`${rightPane}.dataset.paneCollapsed === 'false'`);
  await evaluate(`${api}.holdCloudRead()`);
  await selectLocation("cloud");
  await waitFor(`${entry}?.disabled && ${rightPane}.dataset.paneCollapsed === 'true'`);
  assert(await evaluate(`${api}.state().location === 'local' && document.querySelector('[data-native-local-agent]').getAttribute('aria-hidden') === 'true'`),
    "Requesting Cloud must collapse and hide Local sidebar before file access completes");
  await evaluate("document.querySelector('button[data-project-location=local]').click()");
  await waitFor("!document.querySelector('[data-cloud-workspace-tool=agent]')");
  await evaluate(`${api}.finishCloudRead()`);
  await evaluate("new Promise(resolve => setTimeout(resolve, 300))");
  assert(await evaluate(`${api}.state().location === 'local' && ${rightPane}.dataset.paneCollapsed === 'true'`),
    "Cancelling Cloud must retain a closed Local pane and fence the delayed response");
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor(`${api}.state().location === 'cloud' && !${entry}.disabled`);
  assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'false' && ${rightPane}.dataset.paneCollapsed === 'true'`),
    "Returning to a previously opened Cloud Agent must keep the pane closed");
  await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
  await evaluate(`${entry}.click()`);
  await waitFor(`${composer}?.textContent.includes('Keep this draft')`);
  assert(await evaluate("document.querySelector('[data-native-local-agent]').getAttribute('aria-hidden') === 'true'"),
    "Explicit reopen must show Cloud chat while Local remains hidden");
}
async function exercise(mode) {
  const hosted = mode === "hosted";
  const api = hosted ? "window.__accountCloudSmoke" : "window.__nativeCloudWorkbenchSmoke";
  const fileContent = hosted ? "document.querySelector('.browser-column .cm-content')"
    : "document.querySelector('[data-workspace-location=cloud] .browser-column .cm-content')";
  await window.loadURL("about:blank");
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#${hosted ? "account" : "native"}-cloud-workbench-smoke`);
  await waitFor(`Boolean(${api})`);
  if (hosted) {
    await waitFor("Boolean(document.querySelector('[data-cloud-project-id=alpha] .onboarding-project-row'))");
    await evaluate("document.querySelector('[data-cloud-project-id=alpha] .onboarding-project-row').click()");
    await waitFor(`${api}.state().active`);
    await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .tree-row'))");
    await evaluate("document.querySelector('[data-cloud-native=true] .tree-row').click()");
  } else {
    await evaluate("document.querySelector('.desktop-titlebar-terminal').click()");
    await waitFor(`${rightPane}.dataset.paneCollapsed === 'false'`);
    await evaluate(`${api}.holdCloudRead()`);
    await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
    await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
    await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
    await waitFor(`${entry}?.disabled && ${rightPane}.dataset.paneCollapsed === 'true'`);
    assert(await evaluate(`${api}.state().location === 'local'`), "Local pane closes before Cloud commits");
    await evaluate(`${api}.finishCloudRead()`);
    await waitFor(`${api}.state().location === 'cloud'`);
    await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
    await waitFor("!document.querySelector('.desktop-project-location-menu')");
    await evaluate(`${api}.openCloudFile('readme.txt')`);
  }
  await waitFor(`Boolean(${entry}) && !${entry}.disabled`);
  await evaluate(`${entry}.click()`);
  await waitFor(`Boolean(${composer}) && ${entry}.getAttribute('aria-expanded') === 'true'`);
  assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'true' && !document.querySelector('[role=dialog]')`), "Agent opens the right sidebar directly");
  assert(await evaluate(`${api}.state().agent.requests.length === 0`), "Opening Agent must not create any Cloud resources");
  if (hosted) {
    await evaluate("document.querySelector('.desktop-sidebar-footer-button[aria-label=Settings]').click()");
    await waitFor(`${api}.state().settingsOpened === 1`);
    await evaluate("document.querySelector('.desktop-feedback button').click()");
    await waitFor("Boolean(document.querySelector('.desktop-feedback-dialog'))");
    await evaluate("document.querySelector('.desktop-feedback-close').click()");
    await waitFor("!document.querySelector('.desktop-feedback-dialog')");
    assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'true'`), "Settings and Feedback remain available while Agent is open");
  }
  await evaluate(`${api}.editAgent('Keep this draft'); ${entry}.click()`);
  await waitFor(`${entry}.getAttribute('aria-expanded') === 'false'`);
  await evaluate(`${entry}.click()`);
  await waitFor(`${composer}?.textContent.includes('Keep this draft')`);
  assert(await evaluate(`!${send}.disabled`), "Reopened composer keeps an editable draft");
  if (!hosted) await checkLocationRoundTrip(api);
  for (const theme of ["light", "dark"]) {
    await evaluate(hosted ? `${api}.setTheme('${theme}')` : `${api}.setLoginAppearance('${theme}', 'en')`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await waitFor(`${rightPane}.dataset.panePresentation === 'expanded'`);
    await waitFor("[...document.querySelectorAll('.desktop-cloud-header-reveal')].every(element => element.getAnimations({subtree:true}).every(animation => animation.playState === 'finished'))");
    const geometry = await evaluate(`(() => {
      const panel = document.querySelector('.desktop-cloud-agent-sidebar').getBoundingClientRect();
      const input = document.querySelector('.desktop-agent-composer').getBoundingClientRect();
      return { width: panel.width, height: panel.height, left: panel.left, right: panel.right, inputBottom: input.bottom };
    })()`);
    assert(geometry.width >= 280 && geometry.height > 400 && geometry.left > 300 && geometry.right <= 1101 && geometry.inputBottom <= 761,
      `Sidebar must share the local full-height right panel: ${JSON.stringify(geometry)}`);
    await writeFile(path.join(artifacts, `${mode}-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate(`${api}.editAgent('Update the cloud notes')`);
  await waitFor(`${composer}?.textContent === 'Update the cloud notes'`);
  await evaluate(`${send}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-agent-approval-actions .is-primary'))");
  assert(await evaluate("document.querySelectorAll('.desktop-agent-approval-actions button').length === 2"), "Cloud approval offers allow-once and decline");
  await evaluate("document.querySelector('.desktop-agent-approval-actions .is-primary').click()");
  await waitFor("document.querySelector('.desktop-cloud-agent-sidebar').textContent.includes('Cloud file updated.')");
  await waitFor(`${fileContent}?.textContent.includes('AGENT_PUBLISHED_CLOUD_BODY')`);
  assert(await evaluate(`${api}.state().agent.states[0] === 'succeeded'`), "Cloud publication has a confirmed server outcome");
  await evaluate(`${api}.editAgent('Keep running until I stop')`);
  await waitFor(`${composer}?.textContent === 'Keep running until I stop'`);
  await evaluate(`${send}.click()`);
  await waitFor(`${send}?.classList.contains('is-stop')`);
  if (!hosted) {
    await selectLocation("local");
    await waitFor(`${api}.state().location === 'local' && ${rightPane}.dataset.paneCollapsed === 'true'`);
    assert(await evaluate(`${api}.state().agent.states[1] === 'running'`), "Changing location must not stop the remote task");
    await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
    await waitFor(`${api}.state().location === 'cloud' && !${entry}.disabled`);
    assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'false'`), "A running task must not reopen the Cloud pane on return");
    await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
    await evaluate(`${entry}.click()`);
    await waitFor(`${send}?.classList.contains('is-stop')`);
  }
  await evaluate(`${entry}.click()`);
  await waitFor(`${entry}.getAttribute('aria-expanded') === 'false'`);
  assert(await evaluate(`${api}.state().agent.states[1] === 'running'`), "Hiding the sidebar does not stop the server task");
  await evaluate(`${entry}.click()`);
  await waitFor(`Boolean(${composer}) && ${send}?.classList.contains('is-stop')`);
  await evaluate(`${send}.click()`);
  await waitFor(`${api}.state().agent.states[1] === 'stopped' && !${send}.classList.contains('is-stop')`);
  const chatSessions = [];
  for (let turn = 1; turn <= 3; turn++) {
    if (turn > 1) {
      if (hosted) {
        await evaluate(`${entry}.click()`);
        await waitFor(`${entry}.getAttribute('aria-expanded') === 'false'`);
      } else {
        await selectLocation("local");
        await waitFor(`${api}.state().location === 'local' && ${rightPane}.dataset.paneCollapsed === 'true'`);
        await selectLocation("cloud");
        await waitFor(`${api}.state().location === 'cloud' && !${entry}.disabled`);
        assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'false'`), "Cloud chat remains closed after each return");
        await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
      }
      await evaluate(`${entry}.click()`);
      await waitFor(`Boolean(${composer})`);
    }
    const prompt = `Connection test: turn ${turn}`;
    await evaluate(`${api}.editAgent(${JSON.stringify(prompt)})`);
    await waitFor(`${composer}?.textContent === ${JSON.stringify(prompt)} && !${send}.disabled`);
    await evaluate(`${send}.click()`);
    await waitFor(`!![...document.querySelectorAll('.desktop-cloud-agent-sidebar .desktop-agent-message.is-assistant')].find(x=>x.textContent.includes(${JSON.stringify(`Connected: ${prompt}`)}))`);
    await waitFor(`[...${composer}.querySelectorAll('.cm-line:not(:has(.cm-placeholder))')].every(line=>!line.textContent) && !${send}.classList.contains('is-stop')`);
    chatSessions.push(await evaluate(`${api}.state().agent.runs.at(-1).session_id`));
  }
  assert(new Set(chatSessions).size === 1, "Three replies across reopen/location switches retain one server session");
  await writeFile(path.join(artifacts, `${mode}-chat-roundtrip.png`), (await window.webContents.capturePage()).toPNG());
  await checkWorkbench(api, mode);
  if (hosted) {
    await evaluate(`${api}.editAgent('Publish another update')`);
    await waitFor(`${composer}?.textContent === 'Publish another update'`);
    await evaluate(`${send}.click()`);
    await waitFor("Boolean(document.querySelector('.desktop-agent-approval-actions .is-primary'))");
    await evaluate(`${api}.holdWrites(); ${api}.edit('UNSAVED_HUMAN_CLOUD_CONTENT')`);
    await waitFor("document.querySelector('.browser-column .cm-content')?.textContent.includes('UNSAVED_HUMAN_CLOUD_CONTENT')");
    await evaluate("document.querySelector('.desktop-agent-approval-actions .is-primary').click()");
    await waitFor("Boolean(document.querySelector('.browser-column .editor-inline-error button'))");
    assert(await evaluate("document.querySelector('.browser-column .cm-content').textContent.includes('UNSAVED_HUMAN_CLOUD_CONTENT')"), "Agent publication must preserve dirty Cloud content");
    await writeFile(path.join(artifacts, "hosted-dirty-conflict.png"), (await window.webContents.capturePage()).toPNG());
    await evaluate(`${api}.releaseWrites()`);
    await evaluate("document.querySelector('.browser-column .editor-inline-error button').click()");
    await waitFor("document.querySelector('.browser-column .cm-content')?.textContent.includes('AGENT_PUBLISHED_CLOUD_BODY_3')");
    await evaluate(`${api}.home()`);
    await waitFor("Boolean(document.querySelector('[data-cloud-project-id=beta] .onboarding-project-row'))");
    await evaluate("document.querySelector('[data-cloud-project-id=beta] .onboarding-project-row').click()");
    await waitFor(`${api}.state().project === 'beta' && Boolean(${entry})`);
    assert(await evaluate(`${entry}.getAttribute('aria-expanded') === 'false'`), "A different project owns a separate closed sidebar");
    await evaluate(`${entry}.click()`); await waitFor(`Boolean(${composer})`);
    assert(await evaluate("!document.querySelector('.desktop-cloud-agent-sidebar').textContent.includes('Update the cloud notes')"), "Previous project messages must not cross into the new project");
    await evaluate(`${api}.signOut()`); await waitFor("!document.querySelector('.desktop-account-cloud-workspace')");
  }
  return await evaluate(`${api}.state().agent`);
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  const hosted = await exercise("hosted");
  const linked = await exercise("linked");
  assert(errors.length === 0, `Unexpected renderer errors: ${errors.join("; ")}`);
  await writeFile(path.join(artifacts, "result.json"), JSON.stringify({ passed: true, hosted, linked, errors }, null, 2));
  console.log("Cloud Agent sidebar Electron smoke passed for hosted and repository-linked projects.");
  window.destroy(); app.exit(0);
}).catch(async error => {
  console.error(error);
  await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ error: String(error), errors }, null, 2));
  if (window) { await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG()); window.destroy(); }
  app.exit(1);
});
