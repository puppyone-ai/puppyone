#!/usr/bin/env electron
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session, WebContentsView } from "electron";
import { createEditorSurfaceSessionManager } from "../../../../electron/main/editor-surfaces/session-manager.mjs";
import { registerWorkspaceFileIpcHandlers } from "../../../../electron/main/ipc/workspace-files-ipc.mjs";
import { createLocalFileCapabilityStore } from "../../../../electron/main/local-file-capabilities.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-editor-runtime-"));
const workspaceRoot = path.join(tempRoot, "workspace");
await fsp.mkdir(workspaceRoot);
await fsp.writeFile(path.join(workspaceRoot, "note.md"), Array.from({ length: 150 }, (_, index) => `Paragraph ${index}. A document retains its editing session.`).join("\n\n"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");
let window = null;
let vite = null;
let nativeSurfaces = null;

app.whenReady().then(async () => {
  let exitCode = 0;
  const deadline = setTimeout(() => { console.error("Editor runtime smoke exceeded 60 seconds"); app.exit(1); }, 60_000);
  try {
    const handlers = new Map();
    registerWorkspaceFileIpcHandlers({ app, fs, BrowserWindow, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {}, shell: {}, localFileCapabilities: createLocalFileCapabilityStore(),
      authorizeWorkspaceRoot: async (event, root) => {
        if (event.sender !== window.webContents || root !== workspaceRoot) throw new Error("Invalid smoke workspace owner");
        return workspaceRoot;
      },
    });
    ipcMain.handle("editor-runtime-smoke:read", (event, resource) => handlers.get("workspace:read-file")(event, { rootPath: workspaceRoot, path: resource }));
    ipcMain.handle("editor-runtime-smoke:persist", (event, request) => handlers.get("workspace:write-file")(event,
      { rootPath: workspaceRoot, path: request.path, content: request.content, expectedVersion: request.baseVersion }));
    ipcMain.handle("editor-runtime-smoke:rename", (event, resource, name) => handlers.get("workspace:rename-entry")(event,
      { rootPath: workspaceRoot, path: resource, nextName: name }));
    ipcMain.handle("editor-runtime-smoke:agent-write", async (event, resource, content) => {
      if (event.sender !== window.webContents || resource !== "note.md") throw new Error("Invalid smoke Agent target");
      await fsp.writeFile(path.join(workspaceRoot, resource), content);
      event.sender.send("editor-runtime-smoke:changed", resource);
    });
    const { createServer } = await import("vite");
    vite = await createServer({ root: repoRoot, cacheDir: path.join(tempRoot, "vite-cache"), logLevel: "error",
      optimizeDeps: { entries: ["tests/fixtures/editor/runtime/editor-runtime-lifecycle.html"], include: ["jszip", "xlsx"] },
      server: { host: "127.0.0.1", port: 5198, hmr: false, watch: null } });
    await vite.listen();
    window = new BrowserWindow({ show: false, width: 1000, height: 700,
      webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true,
        preload: path.join(repoRoot, "tests/fixtures/editor/runtime/editor-runtime-lifecycle-preload.cjs") } });
    window.webContents.on("console-message", (details) => { if (details.level === "error") console.error(details.message); });
    await window.loadURL(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/editor/runtime/editor-runtime-lifecycle.html`);
    const result = await window.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 200 && !window.editorRuntimeLifecycleFixture; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (!window.editorRuntimeLifecycleFixture) throw new Error("Fixture did not initialize");
      return window.editorRuntimeLifecycleFixture.run();
    })()`);
    if (await fsp.readFile(path.join(workspaceRoot, "renamed.md"), "utf8") !== "# Agent version 9") throw new Error("Final disk content differs from the accepted Agent baseline");
    nativeSurfaces = createEditorSurfaceSessionManager({ WebContentsView, browserSession: session.defaultSession,
      getOwnerWindow: (owner) => owner === window.webContents.id ? window : null,
      admitResource: async () => ({ byteLength: 1024, navigationUrl: pathToFileURL(path.join(repoRoot, "tests/fixtures/editor/formats/samples/sample_document.pdf")).href }),
    });
    const pdf = await nativeSurfaces.activate({ ownerWebContentsId: window.webContents.id, viewerId: "pdf-preview",
      documentPath: "sample_document.pdf", documentRevision: "smoke", resourceUrl: "puppyone-local://file/smoke/file-preview/sample_document.pdf",
      title: "Lifecycle PDF", bounds: { x: 0, y: 0, width: 800, height: 600 }, geometryRevision: 1, visible: true,
      appearance: { dark: false, direction: "ltr", attributes: {}, variables: {} },
    });
    const pdfContents = nativeSurfaces.values()[0].view.webContents;
    await nativeSurfaces.destroy(pdf.sessionId, window.webContents.id);
    if (!pdfContents.isDestroyed() || nativeSurfaces.values().length !== 0) throw new Error("Native PDF WebContents remained alive after its close acknowledgement");
    result.checks.push("real Chromium PDF WebContents confirmed destruction before releasing its session");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { exitCode = 1; console.error(error?.stack ?? error); }
  finally {
    clearTimeout(deadline);
    try { await nativeSurfaces?.destroyAll(); }
    catch (error) { exitCode = 1; console.error(error); }
    window?.destroy();
    await vite?.close();
    await fsp.rm(tempRoot, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
