#!/usr/bin/env electron
/** Real HTTP/PG/S3/Pi integration. The owner supplies an isolated JWT identity;
 * this runner never reads a user's account, repository, or stored credentials. */
import assert from "node:assert/strict";
import { app, BrowserWindow, ipcMain } from "electron";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { createCloudAuthService } from "../../../../electron/cloud-auth-service.mjs";
import { requestCloudApi } from "../../../../electron/main/cloud-api-client.mjs";
import { registerCloudIpcHandlers } from "../../../../electron/main/ipc/cloud-ipc.mjs";

async function main() {
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const api = new URL(config.api);
assert.ok(["127.0.0.1", "localhost"].includes(api.hostname) && api.protocol === "http:", "Only an owned loopback backend is permitted");
const profile = await mkdtemp(path.join(os.tmpdir(), "agent-runtime-electron-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
let window, vite, auth;
const report = { passed: false, kind: "real-backend-component-integration", model: config.model, turns: [], errors: [] };
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function waitFor(expression) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const error = await evaluate("window.agentIntegration?.state().error?.message");
    if (error) throw new Error(error);
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out: " + expression);
}
try {
  await app.whenReady();
  auth = createCloudAuthService({ app, getWindows: () => window ? [window] : [], revealWindow: () => {},
    externalNavigation: { open: async () => { throw new Error("No external navigation in owned test"); } },
    credentialStore: { read: async () => ({ version: 2, user_id: config.user, user_email: "agent-fixture@example.test",
      api_origin: config.api, refresh_token: "owned-fixture", updated_at: new Date().toISOString() }),
      write: async value => value, clear: async () => {} },
    // Identity bootstrap is the fixture seam. All Agent requests and SSE go
    // through the production authenticated requester to the real backend.
    requestCloudApi: async (base, route, init) => route === "/auth/refresh"
      ? { access_token: config.token, refresh_token: "owned-fixture", expires_in: 3600, user_email: "agent-fixture@example.test" }
      : route === "/auth/initialize" ? { ok: true } : requestCloudApi(base, route, init),
  });
  await auth.restoreSession(config.api);
  registerCloudIpcHandlers({ ipcMain, cloudAuthService: auth });
  ipcMain.handle("agent-acceptance:configuration", () => ({ api: config.api, project: config.project }));
  vite = await createServer({ root: repo, server: { host: "127.0.0.1", port: 0, strictPort: false }, logLevel: "error" });
  await vite.listen();
  const port = vite.httpServer.address().port;
  window = new BrowserWindow({ width: 720, height: 980, show: false,
    webPreferences: { preload: path.join(repo, "tests/support/cloud/agentRuntimePreload.cjs"), contextIsolation: true, nodeIntegration: false } });
  window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) report.errors.push(message); });
  await window.loadURL(`http://127.0.0.1:${port}/tests/support/cloud/agent-runtime.html`);
  await waitFor("!!window.agentIntegration");
  await evaluate("document.querySelector('[data-test-open-agent]').click()");
  let session;
  for (let turn = 0; turn < 3; turn++) {
    if (turn) {
      await evaluate("document.querySelector('[data-test-location=local]').click()");
      await waitFor("!window.agentIntegration.state().open && !document.querySelector('.desktop-cloud-agent-sidebar')");
      await evaluate("document.querySelector('[data-test-location=cloud]').click()");
      await waitFor("window.agentIntegration.state().active && !window.agentIntegration.state().open");
      await evaluate("document.querySelector('[data-test-open-agent]').click()");
    }
    await waitFor("!!document.querySelector('.cm-content') && !window.agentIntegration.state().loading");
    const started = performance.now();
    await evaluate("document.querySelector('.cm-content').focus()");
    window.webContents.insertText(config.prompts[turn]);
    await waitFor("window.agentIntegration.state().draft.length > 0");
    await evaluate("document.querySelector('.desktop-agent-composer-action').click()");
    await waitFor(`window.agentIntegration.state().runs.length===${turn+1}`);
    const admissionMs = performance.now() - started;
    await waitFor("!!window.agentIntegration.state().runs.at(-1)?.snapshot.text");
    const firstTextObservedMs = performance.now() - started;
    await waitFor(`window.agentIntegration.state().runs.length===${turn+1} && window.agentIntegration.state().runs.at(-1).state==='succeeded'`);
    const run = await evaluate("window.agentIntegration.state().runs.at(-1)");
    assert.equal(run.snapshot.text, config.expected[turn]);
    session ??= run.session_id;
    assert.equal(run.session_id, session);
    await waitFor(`Array.from(document.querySelectorAll('.desktop-agent-message.is-assistant')).some(x=>x.textContent.includes(${JSON.stringify(config.expected[turn])}))`);
    report.turns.push({ id: run.id, session_id: run.session_id, admission_ms: admissionMs,
      first_text_observed_ms: firstTextObservedMs, elapsed_ms: performance.now()-started, text: run.snapshot.text });
  }
  await mkdir(config.output, { recursive: true });
  await writeFile(path.join(config.output, "reply.png"), (await window.webContents.capturePage()).toPNG());
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await mkdir(config.output, { recursive: true });
  await writeFile(path.join(config.output, "desktop-result.json"), JSON.stringify(report, null, 2));
  window?.destroy();
  auth?.dispose();
  await vite?.close();
  await rm(profile, { recursive: true, force: true });
  app.exit(report.passed ? 0 : 1);
}

}
void main().catch(error => { console.error(error); app.exit(1); });
