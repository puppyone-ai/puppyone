#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";
import { installFixtureAgent } from "../../../support/agent/install-fixture-agent.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

// Full application/Chat UI/project authorization, with only discovery and native
// model execution replaced. No credentials, provider requests or billable turns.
const repo = path.resolve(import.meta.dirname, "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-attachment-ui-"));
const workspace = path.join(temporary, "workspace");
await fs.mkdir(workspace);
const artifactRoot = path.join(repo, "artifacts/tests/agent/project-attachment-ingestion");
await fs.mkdir(artifactRoot, { recursive: true });
const output = process.env.PUPPYONE_ATTACHMENT_UI_ARTIFACT_DIR
  ? path.resolve(process.env.PUPPYONE_ATTACHMENT_UI_ARTIFACT_DIR) : await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=";
const imagePath = path.join(temporary, "native-image.png");
await fs.writeFile(imagePath, Buffer.from(png, "base64"));
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
process.env.SHELL = "/bin/sh";
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: root => fs.realpath(root), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(workspace)]);
process.argv.push(workspace);
const restoreProvider = installFixtureAgent(repo);
const observed = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalHandle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (channel === "agent:reference-stage" || (channel === "agent:command-dispatch" && args[0]?.kind === "start")) {
    observed.push({ channel, contextPresent: Boolean(args[0]?.projectContext), ok: Boolean(result && !result.agentFailure),
      code: result?.agentFailure?.code, route: args[0]?.sourcePaths ? "native" : args[0]?.sources ? "bytes" : "turn" });
  }
  return result;
});
app.on("window-all-closed", () => {});
let window;
const routes = [];
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Project attachment UI: ${label}`);
}
async function capture(name) {
  await fs.writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
}
async function ready(route) {
  await until(() => evaluate("Boolean(document.querySelector('.desktop-agent-visual-attachment.is-ready img'))"), `${route}: ready image`);
  assert.equal(await evaluate("document.querySelectorAll('.desktop-agent-visual-attachment.is-error').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.desktop-agent-visual-attachment button').length"), 1, "Only the compact remove action belongs on the image");
  routes.push(route);
}
async function remove() {
  await evaluate("document.querySelector('.desktop-agent-visual-attachment button').click()");
  await until(() => evaluate("!document.querySelector('.desktop-agent-visual-attachment')"), "removed image");
}
async function virtualImage(kind) {
  await evaluate(`(() => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], 'virtual-image.png', {type:'image/png'}));
    const editor = document.querySelector('.desktop-agent-prompt-editor .cm-content');
    editor.focus();
    editor.dispatchEvent(${kind === "drop" ? "new DragEvent('drop', {dataTransfer:data,bubbles:true,cancelable:true})" : "new ClipboardEvent('paste', {clipboardData:data,bubbles:true,cancelable:true})"});
  })()`);
}
const deadline = setTimeout(() => { console.error("Project attachment UI timed out."); app.exit(1); }, 90_000);
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  let failure;
  try {
    await until(() => (window = BrowserWindow.getAllWindows()[0]), "main window");
    window.webContents.setBackgroundThrottling(false);
    window.setSize(1200, 850); window.show(); window.webContents.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "application mounted");
    await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal').click()");
    await until(() => evaluate("Boolean(document.querySelector('.desktop-terminal-launcher-tool[title=Codex]'))"), "Codex fixture available");
    await evaluate("document.querySelector('.desktop-terminal-launcher-tool[title=Codex]').click()");
    await until(() => evaluate("document.querySelector('.desktop-agent-reference-trigger')?.disabled===false"), "image ingestion enabled");

    window.webContents.debugger.attach("1.3");
    const { root } = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: 1 });
    const { nodeId } = await window.webContents.debugger.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: '.desktop-agent-attachment-control input[type=file]' });
    assert(nodeId);
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [imagePath] });
    await ready("native-picker");
    await remove();
    await virtualImage("drop"); await ready("pathless-drop"); await remove();
    await virtualImage("paste"); await ready("pathless-paste");
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]')?.disabled"), true, "Codex still requires text: a ready image is not an attachment-only capability");
    await window.webContents.insertText("Describe this image.");
    await until(() => evaluate("document.querySelector('button[aria-label=\"Send message\"]')?.disabled===false"), "text plus ready image enables send");
    await capture("ready-to-send.png");
    await evaluate("document.querySelector('button[aria-label=\"Send message\"]').click()");
    await until(() => observed.some(item => item.channel === "agent:command-dispatch" && item.ok), "production submission accepted by fixture runtime");
    await until(() => evaluate("!document.querySelector('.desktop-agent-visual-attachment')"), "submitted draft cleared");
    assert.equal(observed.filter(item => item.channel === "agent:reference-stage").length, 3);
    assert(observed.every(item => item.ok && item.contextPresent), JSON.stringify(observed));
    assert.deepEqual(observed.filter(item => item.channel === "agent:reference-stage").map(item => item.route), ["native", "bytes", "bytes"]);
    await capture("submitted.png");
  } catch (error) {
    failure = String(error?.stack || error);
    console.error(failure);
    if (window && !window.isDestroyed()) await capture("failure.png");
  } finally {
    const receipt = { ok: !failure, source, actualAppRenderer: true, actualProjectAuthorization: true,
      nativeExecution: "fixture-only", events: "CDP picker and synthetic DOM drop/paste; not OS gestures", routes, observed, failure };
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ ...receipt, output }, null, 2));
    clearTimeout(deadline);
    for (const item of BrowserWindow.getAllWindows()) item.destroy();
    restoreProvider();
    await fs.rm(temporary, { recursive: true, force: true });
    app.exit(failure ? 1 : 0);
  }
});
