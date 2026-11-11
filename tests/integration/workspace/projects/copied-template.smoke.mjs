#!/usr/bin/env electron
// A first launch with a store link copied offers that template once, and only once.
// Real Main and renderer, a fresh profile, and a local stand-in for the template
// store. It writes the system clipboard, so it keeps and restores its text.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, Menu } from "electron";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-copied-template-"));
const screenshots = path.join(repoRoot, "artifacts/tests/copied-template");
const templateId = "b91aaade-bc9e-4dfd-8f23-11f06ec00301";
const releaseId = "c3c1a7a4-55b1-4c7e-9a3e-2f0b8e6d1f10";
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
let renderer;
let savedClipboard = null;
const detailRequests = [];
const evaluate = (source) => window.webContents.executeJavaScript(source, true);
const guard = setTimeout(() => { console.error("Copied template check timed out"); void finish(1); }, 120_000);

// The store answers one template, the way the website's API does.
const store = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== `/api/templates/${templateId}`) { response.writeHead(404).end("{}"); return; }
  detailRequests.push(url.search);
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    id: templateId, release_id: releaseId, name: "Smoke Outreach", description: "A template for this check.",
    version: "1.0.0", author: "smoke", locale: "en", file_count: 3, icon: null, delivery: "github",
  }));
});
await new Promise((resolve) => store.listen(0, "127.0.0.1", resolve));
const storeOrigin = `http://127.0.0.1:${store.address().port}`;
const copiedLink = `${storeOrigin}/t/${templateId}?release=${releaseId}`;

async function until(expression, description) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (await evaluate(expression).catch(() => false)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function finish(code) {
  clearTimeout(guard);
  if (savedClipboard !== null) clipboard.writeText(savedClipboard);
  store.close();
  await renderer?.close();
  app.exit(code);
}

const { createServer } = await import("vite");
renderer = await createServer({
  root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
  define: {
    "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
    "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
  },
  server: { host: "127.0.0.1", port: 5392, strictPort: false, hmr: false, watch: null,
    fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), temporaryRoot] } },
});
await renderer.listen();
process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${renderer.httpServer.address().port}`;
process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
process.env.PUPPYONE_TEMPLATE_STORE_ORIGIN = storeOrigin;
await import("../../../../electron/main.mjs");

// Electron emits ready only after this module has finished loading.
async function main() {
  await app.whenReady();
  savedClipboard = clipboard.readText();
  clipboard.writeText(copiedLink);
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 400 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);

  await until("!!document.querySelector('.onboarding-entry-template-name')", "the copied template's card");
  const card = await evaluate(`({
    note: document.body.textContent.includes('From the template link you copied.'),
    name: document.querySelector('.onboarding-entry-template-name').textContent,
  })`);
  assert.deepEqual(card, { note: true, name: "Smoke Outreach" });
  // Development StrictMode may resolve the card twice; what matters is that it asked.
  const askedOnFirstLaunch = detailRequests.length;
  assert.ok(askedOnFirstLaunch >= 1, "the card never asked the store");
  await fs.mkdir(screenshots, { recursive: true });
  await fs.writeFile(path.join(screenshots, "first-launch.png"), (await window.webContents.capturePage()).toPNG());

  // Cancel is the answer. The same profile, still without projects, is not asked again.
  await evaluate("[...document.querySelectorAll('form button')].find((button) => button.textContent === 'Cancel').click()");
  await until("!document.querySelector('.onboarding-entry-template-name')", "the card to close");
  window.webContents.reload();
  await until("document.readyState === 'complete' && !!document.querySelector('.desktop-theme-bootstrap-surface')", "the relaunch");
  await wait(4000);
  assert.equal(await evaluate("!!document.querySelector('.onboarding-entry-template-name')"), false, "the copied link was offered again");
  assert.equal(detailRequests.length, askedOnFirstLaunch, "the relaunch asked the store again");
  console.log("Copied template smoke passed.");
}

main().then(() => finish(0)).catch(async (error) => {
  console.error(error.message);
  await fs.mkdir(screenshots, { recursive: true }).catch(() => {});
  if (window) await fs.writeFile(path.join(screenshots, "failure.png"), (await window.webContents.capturePage()).toPNG()).catch(() => {});
  await finish(1);
});
