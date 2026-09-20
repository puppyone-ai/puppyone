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
const computeSmoke = process.argv.includes("--compute");
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
process.env.SHELL = "/bin/sh";
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: (root) => fs.realpath(root), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(workspace)]);
process.argv.push(workspace);
let metadataReads = 0;
let inferenceRequests = 0;
const server = http.createServer((request, response) => {
  assert.equal(request.headers.authorization, "Bearer synthetic-settings-key");
  if (request.url === "/v1/models") {
    metadataReads++;
    response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: "ui-test-model" }] })); return;
  }
  assert.equal(computeSmoke, true); assert.equal(request.url, "/v1/chat/completions");
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    inferenceRequests++;
    const body = JSON.parse(raw);
    const isVerification = body.tools?.some((tool) => tool.function?.name === "puppyone_connection_check");
    const toolCall = isVerification && !body.messages.some((message) => message.role === "tool");
    const delta = toolCall ? { tool_calls: [{ index: 0, id: "compute_check", type: "function", function: { name: "puppyone_connection_check", arguments: '{"token":"puppyone-model-check"}' } }] } : { content: "Compute source smoke complete." };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ id: "compute", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "compute", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: toolCall ? "tool_calls" : "stop" }] })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
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
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} || e.querySelector('strong')?.textContent.trim()===${JSON.stringify(label)} || e.getAttribute('aria-label')===${JSON.stringify(label)}); if(!b)throw Error('Button missing: '+${JSON.stringify(label)}); b.click(); })()`);
}
async function fill(selector, value) {
  await evaluate(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function ensureAgentSidebarOpen() {
  const selector = ".desktop-titlebar-terminal, .desktop-shell-toolbar-terminal";
  if (await evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') !== 'true'`)) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  await until(() => evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`), "Agent sidebar open");
}
const deadline = setTimeout(() => { console.error("Settings smoke timed out."); app.exit(1); }, 90_000);
async function capture(name) {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fs.writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
}
async function checkDefaultCompute() {
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}))");
  await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog'))"), "experimental settings");
  await clickText("Experimental");
  await evaluate("document.querySelector('input[aria-label=\"Built-in Agent\"]').click()");
  await clickText("Close");
  await evaluate("document.querySelector('.desktop-titlebar-terminal, .desktop-shell-toolbar-terminal').click()");
  await until(() => evaluate("Boolean(document.querySelector('.desktop-terminal-launcher-tool[title=\"Built-in Agent\"]'))"), "built-in Harness choice");
  await clickText("Built-in Agent");
  await until(() => evaluate("document.querySelector('.desktop-agent-compute-summary')?.textContent.includes('PuppyOne AI')"), "default managed compute");
  await ensureAgentSidebarOpen();
  await until(() => evaluate("Boolean(document.querySelector('.desktop-agent-empty-state'))"), "quiet first-use identity");
  assert.equal(await evaluate("Boolean(document.querySelector('.desktop-agent-readiness'))"), false, "First-use setup is not an error banner");
  assert.equal(await evaluate("Boolean(document.querySelector('.desktop-agent-compute-editor, .desktop-agent-compute-sources, .desktop-agent-compute input'))"), false, "Chat does not own connection configuration");
  assert.equal(await evaluate("document.querySelector('.desktop-agent-compute-summary')?.textContent.includes('Uses your account balance')"), true);
  assert.equal(await evaluate("document.querySelector('.desktop-agent-compute-customize')?.textContent"), "Bring your own API or local model");
  assert.equal(await evaluate("document.querySelector('button[aria-label=\"Send message\"]')?.disabled"), true, "Unavailable cloud must not be treated as a ready provider");
  assert.equal(metadataReads, 0); assert.equal(inferenceRequests, 0);
  await capture("built-in-compute-default.png");
  await clickText("Bring your own API or local model");
  await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog .model-connections'))"), "model connection settings from Chat");
  assert.equal(await evaluate("document.querySelector('.desktop-settings-sidebar [aria-current=\"page\"]')?.textContent.trim()"), "Model connections");
  await capture("built-in-compute-settings-entry.png");
  await evaluate("document.querySelector('.desktop-settings-dialog button[aria-label=\"Close\"]').click()");
}
async function checkComputeChoice() {
  await clickText("Verify Agent support");
  await until(() => evaluate("document.querySelector('.model-connection-details')?.textContent.includes('Tool round-trip verified')"), "verified model");
  await evaluate("document.querySelector('.desktop-settings-dialog button[aria-label=\"Close\"]').click()");
  await ensureAgentSidebarOpen();
  await until(() => evaluate("Boolean(document.querySelector('.desktop-agent-compute'))"), "Chat restored after Settings");
  assert.equal(await evaluate("Boolean(document.querySelector('.desktop-agent-composer button[aria-label=\"Agent model\"]'))"), false, "Built-in must not show a second unscoped model picker");
  await until(() => evaluate("document.querySelector('.desktop-agent-compute button[aria-label=\"Agent model\"]')?.disabled===false"), "verified model picker");
  await capture("built-in-compute-choice.png");
  await clickText("Agent model"); await clickText("ui-test-model");
  await until(() => evaluate("document.querySelector('.desktop-agent-boundary')?.getAttribute('data-phase')==='ready'"), "ready native session");
  await evaluate("document.querySelector('.desktop-agent-prompt-editor .cm-content').focus()");
  await window.webContents.insertText("Reply with a short confirmation.");
  await until(() => evaluate("document.querySelector('button[aria-label=\"Send message\"]')?.disabled===false"), "routed send enabled");
  await clickText("Send message");
  await until(() => evaluate("document.querySelector('.desktop-agent-conversation-region')?.textContent.includes('Compute source smoke complete.')"), "actual model response");
  await until(() => evaluate("document.querySelector('.desktop-agent-compute-customize')?.disabled===false"), "turn finished");
  await capture("built-in-compute-api.png");
  assert.equal(inferenceRequests, 3);
  window.setSize(1000, 720);
  await capture("built-in-compute-compact.png");
  assert.equal(await evaluate(`(() => {
    const section = document.querySelector('.desktop-agent-compute');
    const buttons = [...section.querySelectorAll('button')];
    const send = document.querySelector('button[aria-label="Send message"]').getBoundingClientRect();
    return buttons.every(button => { const rect = button.getBoundingClientRect(); return rect.top >= 0 && rect.right <= innerWidth; })
      && section.scrollWidth <= section.clientWidth && send.bottom <= innerHeight;
  })()`), true, "Compute summary and composer stay accessible in a compact window");
  await clickText("Bring your own API or local model");
  await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog .model-connections'))"), "settings reopen from Chat");
  assert.equal(inferenceRequests, 3, "Opening Settings must not infer or change the active route");
}
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  let failed = false;
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.webContents.setBackgroundThrottling(false);
    window.setSize(1200, 850); window.show(); app.focus({ steal: true }); window.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "app ready");
    if (computeSmoke) await checkDefaultCompute();
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:',',metaKey:true,bubbles:true}))");
    await until(() => evaluate("Boolean(document.querySelector('.desktop-settings-dialog'))"), "dialog ready");
    // Opening animation transforms the entire dialog; measure its settled geometry.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await clickText("Appearance");
    await clickText("Light");
    await until(() => evaluate("Boolean(document.querySelector('[data-theme-mode=light]'))"), "light appearance");
    const referenceHeading = await evaluate("(() => { const h = document.querySelector('.desktop-settings-section-header h2'); return { left: h.getBoundingClientRect().left, size: getComputedStyle(h).fontSize }; })()");
    await clickText("Model connections");
    await until(() => evaluate("Boolean(document.querySelector('.model-connections'))"), "model settings ready");
    const connectionHeading = await evaluate("(() => { const h = document.querySelector('.model-connections .desktop-settings-section-header h2'); return { left: h.getBoundingClientRect().left, size: getComputedStyle(h).fontSize }; })()");
    assert.equal(connectionHeading.size, referenceHeading.size, "Model connections uses the same heading type as Appearance");
    assert.ok(Math.abs(connectionHeading.left - referenceHeading.left) <= 1,
      `Model connections aligns with Appearance: ${connectionHeading.left} / ${referenceHeading.left}`);
    assert.equal(await evaluate("Boolean(document.querySelector('.desktop-settings-sidebar .lucide-plug'))"), true);
    await capture("settings-connections-empty-light.png");
    await clickText("Appearance");
    await clickText("Dark");
    await until(() => evaluate("Boolean(document.querySelector('[data-theme-mode=dark]'))"), "dark appearance");
    await clickText("Model connections");
    await capture("settings-connections-empty-dark.png");
    assert.equal((await evaluate("window.puppyoneDesktop.modelConnections.read()" )).value.connections.length, 0);
    await clickText("Add API connection");
    await capture("settings-connections-add-api.png");
    await fill('.model-connection-setup input[id$="-name"]', "Native UI test");
    await fill('input[type="url"]', `http://127.0.0.1:${server.address().port}/v1`);
    await until(() => evaluate("Boolean(document.querySelector('input[type=password]'))"), "write-only Key field");
    await fill('input[type="password"]', "synthetic-settings-key");
    await clickText("Save connection");
    await until(() => evaluate("document.querySelector('.model-connections-list-row')?.textContent.includes('Native UI test')"), "saved connection");
    await capture("settings-connections-list.png");
    await clickText("Native UI test");
    await until(() => evaluate("document.querySelector('.model-connection-details')?.textContent.includes('ui-test-model')"), "saved catalog");
    assert.equal(metadataReads, 1, "Saving reads metadata only");
    const publicSnapshot = await evaluate("window.puppyoneDesktop.modelConnections.read()");
    assert.equal(publicSnapshot.ok, true); assert.equal(JSON.stringify(publicSnapshot).includes("synthetic-settings-key"), false);
    assert.equal(publicSnapshot.value.connections[0].sourceKind, "api", "Explicit API category is independent of loopback transport");
    assert.equal(await evaluate("Boolean(document.querySelector('input[type=password]'))"), false);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fs.writeFile(path.join(output, "model-connections.png"), (await window.webContents.capturePage()).toPNG());
    if (computeSmoke) await checkComputeChoice();
    if (computeSmoke) await clickText("Native UI test");
    await clickText("Edit connection");
    assert.equal(await evaluate("document.querySelector('input[type=password]').value"), "", "Saved Key remains write-only");
    await fill('.model-connection-setup input[id$="-name"]', "Work API");
    await clickText("Save connection");
    await until(() => evaluate("document.querySelector('.model-connections .desktop-settings-section-header h2')?.textContent==='Work API'"), "renamed connection");
    await clickText("Back");
    await clickText("General");
    await evaluate("(() => { const select = document.querySelector('.desktop-language-setting-select'); select.value='zh-Hans'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await until(() => evaluate("document.documentElement.lang === 'zh-Hans'"), "Chinese settings");
    await clickText("模型连接");
    await capture("settings-connections-list-zh-dark.png");
    await clickText("添加 API 连接");
    await capture("settings-connections-form-zh-dark.png");
    await clickText("取消");
    await clickText("Work API");
    await capture("settings-connections-detail-zh-dark.png");
    window.setSize(900, 720);
    await capture("settings-connections-detail-compact.png");
    assert.equal(await evaluate("(() => { const body = document.querySelector('.model-connections .desktop-settings-body'); return body.scrollWidth <= body.clientWidth; })()"), true, "Settings remains usable without horizontal overflow");
    await clickText("通用");
    await evaluate("(() => { const select = document.querySelector('.desktop-language-setting-select'); select.value='en'; select.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await until(() => evaluate("document.documentElement.lang === 'en'"), "English settings restored");
    await clickText("Model connections");
    await clickText("Work API");
    await clickText("Remove"); await clickText("Remove and stop chats");
    await until(async () => (await evaluate("window.puppyoneDesktop.modelConnections.read()")).value.connections.length === 0, "delete persisted");
    console.log(JSON.stringify({ ok: true, actualAppRenderer: true, loggedOutSettings: true, secureWriteOnlySave: true, catalogVisible: true, confirmedRemoval: true,
      ...(computeSmoke ? { managedDefault: true, quietFirstUse: true, settingsOwnedConfiguration: true, verifiedModelSelection: true, actualAgentTurn: true, noImplicitSourceFallback: true, inferenceRequests } : {}) }));
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
