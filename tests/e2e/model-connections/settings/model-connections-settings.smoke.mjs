#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";
import { workspaceFromPath } from "../../../../local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";

const repo = path.resolve(import.meta.dirname, "../../../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-model-settings-"));
const workspace = path.join(temporary, "workspace"); await fs.mkdir(workspace);
const output = path.join(repo, "artifacts/tests/model-connections/settings"); await fs.mkdir(output, { recursive: true });
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
process.env.SHELL = "/bin/sh";
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: (root) => fs.realpath(root), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(workspace)]);
process.argv.push(workspace);
let metadataReads = 0;
const server = http.createServer((request, response) => {
  assert.equal(request.url, "/v1/models"); assert.equal(request.headers.authorization, "Bearer synthetic-settings-key"); metadataReads++;
  response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: "ui-test-model" }] }));
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
let window;
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const expires = Date.now() + 20_000;
  while (Date.now() < expires) { const result = await read(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Settings smoke: ${label}`);
}
async function clickText(label) {
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}); if(!b)throw Error('Button missing'); b.click(); })()`);
}
async function fill(selector, value) {
  await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
const deadline = setTimeout(() => { console.error("Settings smoke timed out."); app.exit(1); }, 90_000);
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  let failed = false;
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.webContents.setBackgroundThrottling(false);
    window.setSize(1200, 850); window.show(); app.focus({ steal: true }); window.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "app ready");
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}))");
    await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog'))"), "dialog ready");
    await clickText("Model connections");
    await until(() => evaluate("Boolean(document.querySelector('.model-connections'))"), "model settings ready");
    assert.equal((await evaluate("window.puppyoneDesktop.modelConnections.read()" )).value.connections.length, 0);
    await clickText("Add connection");
    await fill('.model-connection-setup input[id$="-name"]', "Native UI test");
    await fill('input[type="url"]', `http://127.0.0.1:${server.address().port}/v1`);
    await evaluate("(()=>{const s=document.querySelector('.model-connection-setup select[id$=\"-driver\"]');s.value='openai-compatible';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await fill('.model-connection-setup input[id$="-name"]', "Native UI test");
    await fill('input[type="url"]', `http://127.0.0.1:${server.address().port}/v1`);
    await until(() => evaluate("Boolean(document.querySelector('input[type=password]'))"), "write-only Key field");
    await fill('input[type="password"]', "synthetic-settings-key");
    await clickText("Save connection");
    await until(() => evaluate("document.querySelector('.model-connection-card')?.textContent.includes('ui-test-model')"), "saved catalog");
    assert.equal(metadataReads, 1, "Saving reads metadata only");
    const publicSnapshot = await evaluate("window.puppyoneDesktop.modelConnections.read()");
    assert.equal(publicSnapshot.ok, true); assert.equal(JSON.stringify(publicSnapshot).includes("synthetic-settings-key"), false);
    assert.equal(await evaluate("Boolean(document.querySelector('input[type=password]'))"), false);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fs.writeFile(path.join(output, "model-connections.png"), (await window.webContents.capturePage()).toPNG());
    await clickText("Remove"); await clickText("Remove and stop chats");
    await until(async () => (await evaluate("window.puppyoneDesktop.modelConnections.read()")).value.connections.length === 0, "delete persisted");
    console.log(JSON.stringify({ ok: true, actualAppRenderer: true, loggedOutSettings: true, secureWriteOnlySave: true, catalogVisible: true, confirmedRemoval: true }));
  } catch (error) {
    failed = true; console.error(error);
    if (window) await fs.writeFile(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    clearTimeout(deadline);
    for (const item of BrowserWindow.getAllWindows()) item.destroy();
    await fs.rm(temporary, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
