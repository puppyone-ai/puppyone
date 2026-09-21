#!/usr/bin/env electron
import { app, BrowserWindow, WebContentsView, session } from "electron";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createMermaidRendererHost } from "../../../../../../electron/main/mermaid/renderer-host.mjs";
import { createMermaidRenderService } from "../../../../../../electron/main/mermaid/render-service.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-mermaid-isolation-")));
app.commandLine.appendSwitch("disable-gpu");
let ui;
let service;
const hosts = [];
async function run() {
try {
  ui = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  await ui.loadURL("data:text/html,<html><body>Mermaid responsiveness probe</body></html>");
  await ui.webContents.executeJavaScript("window.ticks = 0; setInterval(() => window.ticks++, 10); void 0");
  function TrackedView(options) {
    const view = new WebContentsView(options); hosts.push(view.webContents);
    view.webContents.on("console-message", (details) => console.log("host:", details.message));
    view.webContents.on("render-process-gone", (_event, details) => console.log("host exit:", details.reason));
    return view;
  }
  service = createMermaidRenderService({ createHost: () => createMermaidRendererHost({
    WebContentsView: TrackedView, session,
    url: process.env.MERMAID_SMOKE_URL || pathToFileURL(path.join(root, "dist/mermaid-renderer.html")).href,
    preload: path.join(root, "electron/mermaid-preload.cjs"),
  }) });
  const config = { theme: "base", fontFamily: '"PuppyOne Open Sans", sans-serif', htmlLabels: false };
  const source = "graph LR\n" + Array.from({ length: 80 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}`).join("\n");
  const cold = await service.render(ui.webContents.id, { id: "cold", source, config });
  assert(cold.ok, cold.error); assert(cold.svg.includes("<svg"));
  const hostPid = hosts[0].getOSProcessId();
  assert(hostPid > 0 && hostPid !== ui.webContents.getOSProcessId(), "Mermaid must not share the UI renderer process");
  assert.equal(await hosts[0].executeJavaScript("typeof window.puppyoneDesktop"), "undefined");
  assert.equal(await hosts[0].executeJavaScript("document.fonts.check('16px \"PuppyOne Open Sans\"')"), true);
  const warm = await service.render(ui.webContents.id, { id: "warm", source: "graph TD; A-->B", config });
  assert(warm.ok, warm.error); assert.equal(hosts.length, 1);
  // A genuinely stuck computation: no main-thread timer inside the host can help.
  void hosts[0].executeJavaScript("while (true) {} ").catch(() => undefined);
  const stuck = service.render(ui.webContents.id, { id: "stuck", source, config });
  const before = await ui.webContents.executeJavaScript("window.ticks");
  await new Promise((resolve) => setTimeout(resolve, 180));
  const after = await ui.webContents.executeJavaScript("window.ticks");
  assert(after - before >= 5, "UI event loop stalled with the diagram process");
  const stopStartedAt = performance.now();
  await service.cancel(ui.webContents.id, "stuck");
  assert.equal((await stuck).ok, false);
  assert(hosts[0].isDestroyed(), "Cancellation returned without host destruction");
  const cancelMs = performance.now() - stopStartedAt;
  const recovered = await service.render(ui.webContents.id, { id: "recovered", source: "graph TD; C-->D", config });
  assert(recovered.ok, recovered.error); assert.equal(hosts.length, 2);
  const syntax = await service.render(ui.webContents.id, { id: "syntax", source: "this is not mermaid", config });
  assert.equal(syntax.ok, false);
  const afterError = await service.render(ui.webContents.id, { id: "after-error", source: "graph TD; E-->F", config });
  assert(afterError.ok, afterError.error); assert.equal(hosts.length, 2, "Syntax errors should retain the warm engine");
  console.log(JSON.stringify({ cold: cold.timings, warm: warm.timings, uiTicksDuringStall: after - before, cancelMs, separateProcess: true, recovery: true }, null, 2));
} catch (error) {
  console.error(error); process.exitCode = 1;
} finally {
  await service?.dispose();
  ui?.destroy();
  app.exit(process.exitCode || 0);
}
}
void app.whenReady().then(run);
