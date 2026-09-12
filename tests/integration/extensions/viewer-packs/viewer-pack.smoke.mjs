#!/usr/bin/env electron

import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session as electronSession,
  WebContentsView,
} from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createViewerPackHost,
  registerViewerPackPluginIpcHandlers,
} from "../../../../electron/main/viewer-packs/index.mjs";
import { PLUGIN_PROTOCOL_SCHEME } from "../../../../electron/main/viewer-packs/plugin-protocol.mjs";
import { RESOURCE_PROTOCOL_SCHEME } from "../../../../electron/main/viewer-packs/resource-protocol.mjs";
import { getMimeType } from "../../../../local-api/workspace.mjs";

protocol.registerSchemesAsPrivileged([
  {
    scheme: PLUGIN_PROTOCOL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: RESOURCE_PROTOCOL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureBase = path.join(
  repoRoot,
  "tests/fixtures/extensions/viewer-packs/ai.puppyone.viewer.glb-1.0.0.puppyplugin",
);
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-viewer-pack-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const workspacePath = path.join(tempRoot, "workspace");
await fsp.mkdir(userDataPath, { recursive: true });
await fsp.mkdir(workspacePath, { recursive: true });
await fsp.writeFile(path.join(workspacePath, "scene.glb"), Buffer.from("glTF\x02\x00\x00\x00smoke"));
app.setPath("userData", userDataPath);

let ownerWindow = null;
let host = null;

async function runSmoke() {
  console.log("viewer-pack smoke: Electron ready");
  ownerWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await ownerWindow.loadURL("data:text/html,<title>Viewer Pack smoke owner</title>");
  console.log("viewer-pack smoke: owner loaded");

  const publicKeyPem = await fsp.readFile(`${fixtureBase}.test-public-key.txt`, "utf8");
  host = createViewerPackHost({
    WebContentsView,
    sessionFromPartition: (partition, options) => electronSession.fromPartition(partition, options),
    getOwnerWindow: (id) => id === ownerWindow.webContents.id ? ownerWindow : null,
    userDataPath,
    appVersion: "0.1.2",
    isPackaged: false,
    getMimeType,
    trustedSigners: [{
      keyId: "puppyone-fixture-2026",
      publisher: "puppyone",
      publicKeyPem,
    }],
  });
  registerViewerPackPluginIpcHandlers({ ipcMain, host });
  console.log("viewer-pack smoke: host registered");
  await host.installLocalPackageFromFiles({
    archivePath: fixtureBase,
    signaturePath: `${fixtureBase}.sig`,
  });
  console.log("viewer-pack smoke: fixture installed");
  const activated = await host.activateDocumentSession({
    pluginId: "ai.puppyone.viewer.glb",
    rootPath: workspacePath,
    relativePath: "scene.glb",
    ownerWebContentsId: ownerWindow.webContents.id,
    bounds: { x: 0, y: 0, width: 640, height: 480 },
  });
  console.log("viewer-pack smoke: session activated");
  const activeSession = host.sessions.get(activated.sessionId);
  if (!activeSession) throw new Error("Viewer Pack session was not retained after activation.");

  let status = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    status = await activeSession.view.webContents.executeJavaScript(
      "document.getElementById('status')?.textContent || ''",
      true,
    );
    if (status.includes("GLB header verified")) break;
    if (status && !status.includes("Loading")) {
      const detail = await activeSession.view.webContents.executeJavaScript(
        "document.getElementById('out')?.textContent || ''",
        true,
      );
      throw new Error(`Viewer Pack smoke failed: ${status}\n${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!status.includes("GLB header verified")) {
    throw new Error(`Viewer Pack smoke timed out with status: ${status || "(empty)"}`);
  }
  console.log(JSON.stringify({ ok: true, pluginId: activated.pluginId, status }, null, 2));
}

async function run() {
  try {
    await runSmoke();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    host?.destroyAllSessions();
    ownerWindow?.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    app.quit();
  }
}

// Register the readiness continuation and let the ESM entry module finish
// evaluating. Top-level-awaiting app.whenReady() can deadlock Electron startup.
app.whenReady().then(run).catch((error) => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
