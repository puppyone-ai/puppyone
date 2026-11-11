#!/usr/bin/env electron
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createProjectInitializationService } from "../../../../electron/main/project-initialization-service.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";

const locale = process.argv.find((value) => value.startsWith("--locale="))?.slice("--locale=".length) ?? "en";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-samples-"));
const output = path.join(repo, "artifacts/tests/workspace/onboarding", `${Date.now()}-${locale}`);
await fs.mkdir(output, { recursive: true });
const source = await readSourceIdentity(repo);
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const parentPath = path.join(temporary, "projects");
await fs.mkdir(parentPath);
const receipt = await createProjectInitializationService({ journalDirectory: path.join(temporary, "operations") }).initialize({
  parentPath, name: "My Project", operationId: randomUUID(), locale,
  source: { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 2 } },
});
const root = receipt.path;
const pristine = Object.fromEntries(await Promise.all(receipt.createdPaths.map(async (name) => [name, await fs.readFile(path.join(root, name), "utf8")])));
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: (value) => fs.realpath(value), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
process.argv.push(root);

let window, failure;
const steps = [], errors = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await wait(100); }
  throw new Error(`Timed out: ${label}`);
}
const shot = async (name) => { await wait(400); await fs.writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG()); };
async function open(name) {
  const selector = `.tree-row.file[aria-label=${JSON.stringify(name)}]`;
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function mouseClick(x, y) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
  }
}

const deadline = setTimeout(() => { console.error("Getting Started samples acceptance timed out"); app.exit(1); }, 150000);
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.setSize(1400, 950);
    window.webContents.setBackgroundThrottling(false);
    window.hide();
    window.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(message); });
    await until(() => evaluate("!!document.querySelector('.app-shell')"), "app ready");
    window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    const coachmark = () => evaluate("document.querySelector('.desktop-header-coachmark-actions button')?.click(), true");

    const title = pristine["Getting Started.md"].split("\n")[0].slice(2);
    await until(() => evaluate(`[...document.querySelectorAll('.cm-content')].some(node => node.textContent.includes(${JSON.stringify(title)}))`), "guide opens first");
    await coachmark();
    await shot("1-guide.png");
    steps.push("a new project opens Getting Started.md first");

    const link = await until(() => evaluate(`(() => {
      const node = [...document.querySelectorAll('.cm-content a, .cm-content .cm-md-link-label, .cm-content [data-href]')].find(item => item.textContent.trim() === "Formats.csv");
      if (!node) return null;
      node.scrollIntoView({ block: "center" });
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`), "Formats.csv link in the guide");
    await mouseClick(link.x, link.y);
    const tableOpened = () => evaluate("document.querySelectorAll('td.csv-table-editor__body-cell[data-csv-row]').length >= 8 * 4");
    const fromLink = await until(tableOpened, "CSV table from link").catch(() => false);
    if (!fromLink) await open("Formats.csv");
    await until(tableOpened, "formats table");
    await shot("2-formats.png");
    steps.push(fromLink ? "the guide's link opens the formats table" : "formats table renders (a plain click on the guide's link does not navigate)");

    await open("How It Works.html");
    const frame = await until(() => window.webContents.mainFrame.framesInSubtree.find((item) => item.url.includes("/document-projection/")), "tour frame");
    await until(() => frame.executeJavaScript("document.querySelectorAll('.step').length === 4").catch(() => false), "tour page");
    const visibleStep = () => frame.executeJavaScript("[...document.querySelectorAll('.step')].findIndex(step => !step.hidden)");
    assert.equal(await visibleStep(), 0);
    await frame.executeJavaScript("document.querySelector('[data-move=\"1\"]').click()");
    assert.equal(await visibleStep(), 1, "Next moves through the tour");
    await frame.executeJavaScript("document.querySelector('#tab-3').click()");
    assert.equal(await visibleStep(), 2, "step tabs jump directly");
    await frame.executeJavaScript("document.querySelector('#tab-1').click()");
    await shot("3-how-it-works.png");
    steps.push("the tour runs offline and steps through its pages");

    await open("Workspace Map.excalidraw");
    await until(() => evaluate("!!document.querySelector('.excalidraw canvas')"), "workspace map canvas");
    assert.equal(await evaluate("!!document.querySelector('.whiteboard-editor [role=alert]')"), false, "the workspace map is a valid whiteboard");
    await shot("4-map.png");
    steps.push("workspace map opens as a whiteboard");

    for (const [name, content] of Object.entries(pristine)) {
      assert.equal(await fs.readFile(path.join(root, name), "utf8"), content, `${name} is not rewritten by opening it`);
    }
    assert.deepEqual(errors, [], "no renderer errors");
  } catch (error) {
    failure = error; console.error(error);
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
  } finally {
    clearTimeout(deadline);
    const sourceAfter = await readSourceIdentity(repo);
    if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during acceptance");
    await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: !failure, locale, steps, errors, failure: failure?.stack }, null, 2));
    console.log(`Getting Started samples evidence: ${output}`);
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    app.exit(failure ? 1 : 0);
  }
}).catch((error) => { console.error(error); app.exit(1); });
