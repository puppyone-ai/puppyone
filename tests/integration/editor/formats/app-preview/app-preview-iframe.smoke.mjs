#!/usr/bin/env electron

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { createAppPreviewRuntime } from "../../../../../electron/app-preview-runtime.mjs";
import { createAppPreviewService } from "../../../../../electron/main/app-preview-service.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "puppyone-app-preview-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const workspacePath = path.join(tempRoot, "workspace");
const manifestPath = "smoke.puppyoneapp";
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(workspacePath, { recursive: true });
fs.writeFileSync(path.join(workspacePath, "server.mjs"), `
  import http from "node:http";
  const portIndex = process.argv.indexOf("--port");
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Preview smoke</title><main id='app'>ready</main>");
  });
  server.listen(port, process.env.HOST);
`, "utf8");
fs.writeFileSync(path.join(workspacePath, manifestPath), JSON.stringify({
  type: "puppyone.app",
  version: 1,
  name: "App Preview smoke",
  launch: {
    kind: "local-server",
    command: ["node", "server.mjs", "--port", "${port}"],
    cwd: ".",
    env: {},
    url: "http://127.0.0.1:${port}/",
    health: { path: "/", expectStatus: 200 },
  },
  permissions: { workspace: ["read"] },
}, null, 2), "utf8");
app.setPath("userData", userDataPath);

let ownerWindow = null;
let runtime = null;

async function runSmoke() {
  ownerWindow = new BrowserWindow({
    show: true,
    opacity: 0,
    width: 800,
    height: 600,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const processRuntime = createAppPreviewRuntime({
    app,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    shell,
    readWorkspaceTextFile: async (rootPath, relativePath) => ({
      content: await fs.promises.readFile(path.join(rootPath, relativePath), "utf8"),
    }),
    resolveWorkspacePath: (rootPath, relativePath) => path.join(rootPath, relativePath),
  });
  runtime = createAppPreviewService({ runtime: processRuntime });

  const result = await runtime.start(ownerWindow.webContents, {
    rootPath: workspacePath,
    path: manifestPath,
  });
  assert.equal(result.status, "running");
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  await ownerWindow.loadURL(`data:text/html,${encodeURIComponent(`
    <!doctype html>
    <style>
      html, body, #editor { margin: 0; width: 100%; height: 100%; }
      #editor { display: grid; grid-template-columns: 220px minmax(0, 1fr); }
      iframe { width: 100%; height: 100%; border: 0; }
    </style>
    <div id="editor"><aside></aside><iframe id="preview" sandbox="allow-scripts allow-same-origin"></iframe></div>
    <script>
      const preview = document.getElementById("preview");
      preview.addEventListener("load", () => { preview.dataset.loaded = "true"; });
      preview.src = ${JSON.stringify(result.url)};
    </script>
  `)}`);
  await waitFor(
    async () => ownerWindow.webContents.executeJavaScript(
      `document.getElementById("preview").dataset.loaded === "true"`,
    ),
    4_000,
  );

  const before = await readFrameRect();
  assert.equal(before.left, 220);
  await ownerWindow.webContents.executeJavaScript(
    `document.getElementById("editor").style.gridTemplateColumns = "360px minmax(0, 1fr)"`,
  );
  const after = await readFrameRect();
  assert.equal(after.left, 360);
  assert.equal(after.right, before.right);
  console.log("App Preview DOM iframe resize smoke passed.");
}

async function readFrameRect() {
  return ownerWindow.webContents.executeJavaScript(`(() => {
    const rect = document.getElementById("preview").getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  })()`);
}

async function run() {
  try {
    await runSmoke();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await runtime?.closeAll();
    if (ownerWindow && !ownerWindow.isDestroyed()) ownerWindow.destroy();
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    app.quit();
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!await predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (!await predicate()) throw new Error("Timed out waiting for embedded App Preview.");
}
